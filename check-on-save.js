const path = require('path');
const cp = require('child_process');
const vscode = require('vscode');

// Runs a checker on each saved .py, .pyn or .ipynb and shows its reports as
// squiggles. The command comes from the `rgsk.checkOnSave.command` setting
// (a project sets it, e.g. `uv run annotation-check`), gets the file's path
// as its last argument and runs in the workspace folder. A report is a line
// `path:line:col - message`, or `path:cell 3:line:col - message` for a
// notebook's cell (counting every cell, markdown too, as VSCode's cellAt
// does). A file's squiggles are replaced on each of its saves.

const REPORT = /^(.+?):(?:cell (\d+):)?(\d+):(\d+) - (.*)$/;
const KINDS = new Set(['.py', '.pyn', '.ipynb']);
// annotation-check's probe sits in byname's mirror, which byname's own sync
// on save may clear mid-run; a second run then sees a settled mirror
const RETRY = 'probe removed mid-run';
const RETRY_MS = 1000;

function register(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('checkOnSave');
  const log = vscode.window.createOutputChannel('rgsk check on save');
  const published = new Map(); // file path -> the uris its last run put squiggles on
  const running = new Set(); // file paths with a run in flight
  const queued = new Set(); // ... saved again meanwhile, so run once more after

  function check(uri, attempt = 0) {
    const file = uri.fsPath;
    const command = vscode.workspace
      .getConfiguration('rgsk.checkOnSave', uri)
      .get('command', '');
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!command || !folder || !KINDS.has(path.extname(file))) {
      return;
    }
    if (running.has(file)) {
      queued.add(file);
      return;
    }
    running.add(file);
    const [cmd, ...args] = command.split(/\s+/);
    // the workspace's own venv, not one VSCode inherited from its shell
    const env = { ...process.env };
    delete env.VIRTUAL_ENV;
    cp.execFile(
      cmd,
      [...args, file],
      { cwd: folder.uri.fsPath, env, maxBuffer: 16 << 20 },
      async (error, stdout, stderr) => {
        running.delete(file);
        if (stdout.includes(RETRY) && attempt === 0) {
          setTimeout(() => check(uri, 1), RETRY_MS);
          return;
        }
        // exit 1 is "reported something"; anything else is the checker failing
        if (error && error.code !== 1) {
          log.appendLine(`${command} ${file}\n${stderr || error.message}`);
          vscode.window.setStatusBarMessage(
            `$(warning) check on save failed, see "rgsk check on save"`,
            5000
          );
        } else {
          // the command's last word names it in the Problems panel (annotation-check)
          await publish(file, folder, [cmd, ...args].pop(), stdout);
        }
        if (queued.delete(file)) {
          check(uri);
        }
      }
    );
  }

  async function publish(file, folder, source, stdout) {
    for (const uri of published.get(file) ?? []) {
      diagnostics.delete(uri);
    }
    const byUri = new Map(); // uri string -> [uri, diagnostics]
    for (const line of stdout.split('\n')) {
      const hit = REPORT.exec(line.trim());
      if (!hit || path.resolve(folder.uri.fsPath, hit[1]) !== file) {
        continue;
      }
      const [, , cell, row, col, message] = hit;
      const doc = await reportDocument(file, cell);
      if (!doc) {
        continue;
      }
      const at = new vscode.Position(Number(row) - 1, Number(col) - 1);
      const range =
        doc.getWordRangeAtPosition(at) ?? new vscode.Range(at, at.translate(0, 1));
      const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
      d.source = source;
      const key = doc.uri.toString();
      if (!byUri.has(key)) {
        byUri.set(key, [doc.uri, []]);
      }
      byUri.get(key)[1].push(d);
    }
    for (const [uri, list] of byUri.values()) {
      diagnostics.set(uri, list);
    }
    published.set(file, [...byUri.values()].map(([uri]) => uri));
  }

  // the document a report lands in: the file itself, or the notebook's cell
  async function reportDocument(file, cell) {
    if (cell === undefined) {
      return vscode.workspace.openTextDocument(vscode.Uri.file(file));
    }
    const notebook = vscode.workspace.notebookDocuments.find(
      (n) => n.uri.fsPath === file
    );
    const index = Number(cell) - 1;
    if (!notebook || index >= notebook.cellCount) {
      return undefined;
    }
    return notebook.cellAt(index).document;
  }

  // an edit until the next save: a squiggle on an edited line is stale (the
  // fix may be what was typed), so it goes; one below moves with the lines
  // added or removed above it. Changes are taken bottom-up, so each one's
  // range, given against the document before the edit, still holds
  function followEdit(event) {
    const uri = event.document.uri;
    const old = diagnostics.get(uri);
    if (!old || old.length === 0 || event.contentChanges.length === 0) {
      return;
    }
    let list = [...old];
    const changes = [...event.contentChanges].sort(
      (a, b) => b.range.start.line - a.range.start.line
    );
    for (const { range, text } of changes) {
      const delta = text.split('\n').length - 1 - (range.end.line - range.start.line);
      list = list.flatMap((d) => {
        if (d.range.end.line < range.start.line) {
          return [d];
        }
        if (d.range.start.line > range.end.line) {
          return [moved(d, delta)];
        }
        return [];
      });
    }
    diagnostics.set(uri, list);
  }

  // quick fixes for annotation-check's `name: T is inferred anyway`: drop the
  // annotation, or keep it for the reader with `# any:explicit`. Dropping is the
  // preferred one, so Shift+Alt+. (Auto Fix) applies it with no menu
  const fixes = {
    provideCodeActions(document, _range, ctx) {
      // the context's diagnostics are copies of ours, so matched by message and place
      const ours = diagnostics.get(document.uri) ?? [];
      const isOurs = (d) =>
        ours.some((o) => o.message === d.message && o.range.isEqual(d.range));
      return ctx.diagnostics
        .filter((d) => REDUNDANT.test(d.message) && isOurs(d))
        .flatMap((d) => [...removeAnnotation(document, d), keepAnnotation(document, d)]);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }, { scheme: 'vscode-notebook-cell' }],
      fixes,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    diagnostics,
    log,
    vscode.workspace.onDidChangeTextDocument(followEdit),
    // a notebook's cells save as vscode-notebook-cell documents; the notebook
    // save below covers them
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file') {
        check(doc.uri);
      }
    }),
    vscode.workspace.onDidSaveNotebookDocument((notebook) => check(notebook.uri)),
    vscode.window.onDidChangeVisibleTextEditors(checkShown),
    vscode.window.onDidChangeVisibleNotebookEditors(checkShown),
    vscode.workspace.onDidCloseTextDocument((doc) => shown.delete(doc.uri.fsPath)),
    vscode.workspace.onDidCloseNotebookDocument((n) => shown.delete(n.uri.fsPath))
  );

  // and on open: a file checked the first time it shows in an editor, not on
  // every tab switch back to it (a save does those). Visible editors, not
  // onDidOpenTextDocument, which also fires for files only opened in the
  // background -- by a language server, or publish's own openTextDocument.
  // A notebook's cells come as vscode-notebook-cell editors; the notebook
  // editor covers them
  const shown = new Set(); // file paths checked since they were opened
  function checkShown() {
    const uris = [
      ...vscode.window.visibleTextEditors.map((e) => e.document.uri),
      ...vscode.window.visibleNotebookEditors.map((e) => e.notebook.uri),
    ];
    for (const uri of uris) {
      if (uri.scheme === 'file' && !shown.has(uri.fsPath)) {
        shown.add(uri.fsPath);
        check(uri);
      }
    }
  }
  checkShown();
}

const REDUNDANT = /^\w+: .+ is inferred anyway$/;

// the fix for a redundant annotation, d's range being the name. The
// annotation runs from the name's end to the `=` at bracket depth 0 on the
// same line; none found (a multi-line annotation), so no fix
function removeAnnotation(document, d) {
  const line = document.lineAt(d.range.start.line);
  const text = line.text;
  const nameEnd = d.range.end.character;
  let depth = 0;
  let quote = null;
  for (let i = nameEnd; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      quote = c === quote ? null : quote;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if ('([{'.includes(c)) {
      depth++;
    } else if (')]}'.includes(c)) {
      depth--;
    } else if (c === '=' && depth === 0) {
      const end = text.slice(0, i).trimEnd().length;
      const remove = new vscode.CodeAction(
        `Remove annotation \`${text.slice(nameEnd, end)}\``,
        vscode.CodeActionKind.QuickFix
      );
      remove.edit = new vscode.WorkspaceEdit();
      remove.edit.delete(
        document.uri,
        new vscode.Range(line.lineNumber, nameEnd, line.lineNumber, end)
      );
      remove.diagnostics = [d];
      remove.isPreferred = true;
      return [remove];
    }
  }
  return [];
}

// the fix that keeps a redundant annotation: `# any:explicit` at the line's end. A fresh `#`
// even after a comment: a `#` in the line may be in a string, and annotation-check's marker
// is `#.*any:explicit`, so `# x  # any:explicit` counts
function keepAnnotation(document, d) {
  const line = document.lineAt(d.range.start.line);
  const keep = new vscode.CodeAction(
    'Keep annotation (# any:explicit)',
    vscode.CodeActionKind.QuickFix
  );
  keep.edit = new vscode.WorkspaceEdit();
  keep.edit.insert(document.uri, line.range.end, '  # any:explicit');
  keep.diagnostics = [d];
  return keep;
}

// d, `delta` lines further down (up when negative)
function moved(d, delta) {
  if (delta === 0) {
    return d;
  }
  const { start, end } = d.range;
  const copy = new vscode.Diagnostic(
    new vscode.Range(start.translate(delta), end.translate(delta)),
    d.message,
    d.severity
  );
  copy.source = d.source;
  return copy;
}

module.exports = { register };
