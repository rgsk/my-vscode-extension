const path = require('path');
const vscode = require('vscode');
const checkOnSave = require('./check-on-save');
const claudeKatex = require('./claude-katex');

// The uri of whatever the command was aimed at. An explorer or tab context
// menu passes it in; a keybinding passes nothing, so fall back to what is
// focused. activeTextEditor covers .py and a focused notebook CELL (a
// vscode-notebook-cell uri keeps the notebook's path, only the fragment
// differs), activeNotebookEditor covers a notebook with no cell focused,
// and the tab input covers editors with no text behind them -- pdfs,
// images, diffs.
function targetUri(arg) {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return editor.document.uri;
  }
  const notebook = vscode.window.activeNotebookEditor;
  if (notebook) {
    return notebook.notebook.uri;
  }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  // TabInputText/Custom/Notebook expose .uri, the diff inputs .modified.
  return input?.uri ?? input?.modified;
}

// git.openChange, but the diff opens scrolled to where the file was, cursor
// included. The diff's right side is the same working file, so the line
// numbers carry over as they are. (The reverse, git.openFile, already keeps
// the position.)
async function openChangeHere() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const uri = editor.document.uri.toString();
  const topLine = editor.visibleRanges[0]?.start.line ?? 0;
  const selections = editor.selections;
  await vscode.commands.executeCommand('git.openChange');
  // no changes: openChange opened no diff, and the file must be left alone;
  // revealing its partly visible top line would nudge the scroll
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputTextDiff)) {
    return;
  }
  // the file's own tab is hidden behind the diff now, so the visible editor
  // on this uri is the diff's right side
  const right = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri
  );
  if (!right) {
    return;
  }
  right.selections = selections;
  const top = new vscode.Range(topLine, 0, topLine, 0);
  right.revealRange(top, vscode.TextEditorRevealType.AtTop);
}

// q = quiet: flip problems.visibility, which hides every squiggle (it
// replaced editor.renderValidationDecorations). Global, so it never creates a
// .vscode/settings.json; but a project that sets it keeps its own switch,
// since its value would override the global one and the key would do nothing.
async function toggleProblems() {
  const config = vscode.workspace.getConfiguration('problems');
  const info = config.inspect('visibility');
  const shown = config.get('visibility', true);
  const target =
    info?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update('visibility', !shown, target);
  vscode.window.setStatusBarMessage(
    shown ? 'Problems hidden' : 'Problems shown',
    2000
  );
}

// files.revert behind a modal confirm: unsaved edits gone, the file reloaded
// from disk, tab kept open. Notebook first, since a focused cell is also an
// activeTextEditor. files.revert does nothing on a notebook, so there it is
// revert-and-close plus reopen -- which may shut down the kernel.
async function revertWithConfirm() {
  const notebook = vscode.window.activeNotebookEditor;
  const doc = notebook
    ? notebook.notebook
    : vscode.window.activeTextEditor?.document;
  if (!doc || !doc.isDirty) {
    return;
  }
  const name = path.basename(doc.uri.fsPath);
  const pick = await vscode.window.showWarningMessage(
    `Revert ${name}? Unsaved changes are lost.`,
    { modal: true },
    'Revert'
  );
  if (pick !== 'Revert') {
    return;
  }
  if (notebook) {
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor'
    );
    await vscode.commands.executeCommand('workbench.action.reopenClosedEditor');
  } else {
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
}

// djb2 over a markdown cell's source; the copy in cell-numbers-renderer.js
// must stay in step with this one.
function sourceKey(text) {
  const s = text.replace(/\r\n/g, '\n').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// "cell N" in each notebook cell's status bar, 1-based, markdown cells
// counted too -- the number to say when asking about a cell. Adding, deleting
// or moving a cell shifts the ones below, so every add/remove refreshes them.
// A rendered markdown cell hides its status bar, so for those the number is
// drawn into the markdown by cell-numbers-renderer.js, which gets the
// [{index, key}] of the notebook's markdown cells from here.
function registerCellNumbers(context) {
  const messaging = vscode.notebooks.createRendererMessaging(
    'rgsk.cell-numbers'
  );
  const markdownCells = (notebook) =>
    notebook
      .getCells()
      .filter((c) => c.kind === vscode.NotebookCellKind.Markup)
      .map((c) => ({ index: c.index, key: sourceKey(c.document.getText()) }));
  const send = (editor) =>
    messaging.postMessage({ cells: markdownCells(editor.notebook) }, editor);
  context.subscriptions.push(
    messaging.onDidReceiveMessage(({ editor }) => send(editor)),
    vscode.window.onDidChangeVisibleNotebookEditors((editors) =>
      editors.forEach(send)
    )
  );
  vscode.window.visibleNotebookEditors.forEach(send);
  const changed = new vscode.EventEmitter();
  const provider = {
    onDidChangeCellStatusBarItems: changed.event,
    provideCellStatusBarItems(cell) {
      const item = new vscode.NotebookCellStatusBarItem(
        `cell ${cell.index + 1}`,
        vscode.NotebookCellStatusBarAlignment.Left
      );
      item.priority = 1000; // leftmost
      return [item];
    },
  };
  context.subscriptions.push(
    changed,
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(
      'jupyter-notebook',
      provider
    ),
    vscode.workspace.onDidChangeNotebookDocument((e) => {
      if (e.contentChanges.length > 0) {
        changed.fire();
      }
      // any edit: a markdown cell's text is its key
      for (const editor of vscode.window.visibleNotebookEditors) {
        if (editor.notebook === e.notebook) {
          send(editor);
        }
      }
    })
  );
}

function activate(context) {
  claudeKatex.register(context);
  registerCellNumbers(context);
  checkOnSave.register(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.openChangeHere', openChangeHere)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.toggleProblems', toggleProblems)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.revertWithConfirm', revertWithConfirm)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.copyFileName', async (arg) => {
      const uri = targetUri(arg);
      if (!uri) {
        return;
      }
      const name = path.basename(uri.fsPath);
      await vscode.env.clipboard.writeText(name);
      vscode.window.setStatusBarMessage(`Copied ${name}`, 2000);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
