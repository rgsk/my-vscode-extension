# my-vscode-extension

Personal VSCode commands, plain JS, no build step.

| command | what it does |
| --- | --- |
| `rgsk.copyFileName` | Copies the bare file name (`task.py`). VSCode ships `copyFilePath` and `copyRelativeFilePath` but nothing for the basename. Bound to `ctrl+alt+x`. |

## Install

Symlinked into the extensions folder, so edits here are live on the next reload:

```sh
ln -s "$PWD" ~/.vscode/extensions/my-vscode-extension
```

Then **Developer: Reload Window**. Same reload after any change to `extension.js`.
