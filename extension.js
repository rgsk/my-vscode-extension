const path = require('path');
const vscode = require('vscode');

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

function activate(context) {
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
