# my-vscode-extension

Personal VSCode commands, plain JS, no build step.

| command | what it does |
| --- | --- |
| `rgsk.copyFileName` | Copies the bare file name (`task.py`). VSCode ships `copyFilePath` and `copyRelativeFilePath` but nothing for the basename. Bound to `ctrl+alt+x`. |
| `rgsk.openChangeHere` | `git.openChange`, but the diff opens scrolled to where the file was, cursor included. Bound to `alt+d`; `git.openFile` goes back. |
| `rgsk.toggleProblems` | Flips `problems.visibility`: every squiggle hidden or shown. VSCode ships no toggle for it. Bound to `alt+q` (quiet). |

## Install

Symlinked into the extensions folder, so edits here are live on the next reload:

```sh
ln -s "$PWD" ~/.vscode/extensions/my-vscode-extension
```

Then **Developer: Reload Window**. Same reload after any change to `extension.js`.
