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

function activate(context) {
  claudeKatex.register(context);
  checkOnSave.register(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.openChangeHere', openChangeHere)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.toggleProblems', toggleProblems)
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
