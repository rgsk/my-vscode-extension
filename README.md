# my-vscode-extension

Personal VSCode commands, plain JS, no build step.

| command | what it does |
| --- | --- |
| `rgsk.copyFileName` | Copies the bare file name (`task.py`). VSCode ships `copyFilePath` and `copyRelativeFilePath` but nothing for the basename. Bound to `ctrl+alt+x`. |
| `rgsk.openChangeHere` | `git.openChange`, but the diff opens scrolled to where the file was, cursor included. Bound to `alt+d`; `git.openFile` goes back. |
| `rgsk.toggleProblems` | Flips `problems.visibility`: every squiggle hidden or shown. VSCode ships no toggle for it. Bound to `alt+q` (quiet). |
| `rgsk.revertWithConfirm` | Asks first, then drops unsaved edits and reloads from disk, tab kept open. Covers notebooks too, where `files.revert` does nothing (close + reopen there, which may shut down the kernel). Bound to `alt+x`. |

## Check on save

[check-on-save.js](check-on-save.js) runs the command in the `rgsk.checkOnSave.command` setting on each saved `.py`, `.pyn` or `.ipynb` (path appended, in the workspace folder) and shows its `path:line:col - message` lines as warning squiggles; a notebook's `path:cell N:line:col - message` lands on that cell. A project turns it on in its `.vscode/settings.json`:

```json
"rgsk.checkOnSave.command": "uv run annotation-check"
```

Between saves a squiggle on an edited line goes (the edit may be its fix) and the ones below follow added or removed lines; new ones only come with the next save. A redundant annotation (`name: T is inferred anyway`) gets two quick fixes: remove `: T`, or keep it with `# any:explicit`. Removing is the preferred one, so Shift+Alt+. (Auto Fix) applies it with no menu. Failures go to the *rgsk check on save* output channel. A run that annotation-check says lost its probe to byname's sync (`probe removed mid-run`) is retried once.

## LaTeX in Claude Code chat

[claude-katex.js](claude-katex.js) patches Claude Code's webview bundle on disk so `$...$`, `$$...$$`, `\(...\)` and `\[...\]` render with KaTeX. It runs at startup and again when Claude Code updates, then reloads the webview. Originals are kept as `index.js.rgsk-bak` / `index.css.rgsk-bak`. `rgsk.unpatchClaudeLatex` restores them, until the next window reload patches again.

Based on [nuriyev.claude-code-katex](https://github.com/MahammadNuriyev62/claude-code-katex) (MIT, see [vendor/katex/LICENSE.txt](vendor/katex/LICENSE.txt)). If a Claude Code update reshapes the react-markdown call, a warning says no pattern matched and nothing is written.

## Install

Symlinked into the extensions folder, so edits here are live on the next reload:

```sh
ln -s "$PWD" ~/.vscode/extensions/my-vscode-extension
```

Then **Developer: Reload Window**. Same reload after any change to `extension.js`.
