# my-vscode-extension

Personal VSCode commands, plain JS, no build step.

| command | what it does |
| --- | --- |
| `rgsk.copyFileName` | Copies the bare file name (`task.py`). VSCode ships `copyFilePath` and `copyRelativeFilePath` but nothing for the basename. Bound to `ctrl+alt+x`. |
| `rgsk.openChangeHere` | `git.openChange`, but the diff opens scrolled to where the file was, cursor included. Bound to `alt+d`; `git.openFile` goes back. |
| `rgsk.toggleProblems` | Flips `problems.visibility`: every squiggle hidden or shown. VSCode ships no toggle for it. Bound to `alt+q` (quiet). |

## LaTeX in Claude Code chat

[claude-katex.js](claude-katex.js) patches Claude Code's webview bundle on disk so `$...$`, `$$...$$`, `\(...\)` and `\[...\]` render with KaTeX. It runs at startup and again when Claude Code updates, then reloads the webview. Originals are kept as `index.js.rgsk-bak` / `index.css.rgsk-bak`. `rgsk.unpatchClaudeLatex` restores them, until the next window reload patches again.

Based on [nuriyev.claude-code-katex](https://github.com/MahammadNuriyev62/claude-code-katex) (MIT, see [vendor/katex/LICENSE.txt](vendor/katex/LICENSE.txt)). If a Claude Code update reshapes the react-markdown call, a warning says no pattern matched and nothing is written.

## Install

Symlinked into the extensions folder, so edits here are live on the next reload:

```sh
ln -s "$PWD" ~/.vscode/extensions/my-vscode-extension
```

Then **Developer: Reload Window**. Same reload after any change to `extension.js`.
