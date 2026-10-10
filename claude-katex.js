// LaTeX in the Claude Code chat. Claude Code renders messages with
// react-markdown inside a webview, and the webview cannot be reached at
// runtime, so this edits its built bundle on disk: KaTeX and a remark-math +
// rehype-katex bundle are prepended to webview/index.js, the math plugins are
// spliced into the one react-markdown call, and KaTeX's css and fonts go next
// to index.css. Idea and vendor/katex files from nuriyev.claude-code-katex
// (MIT), which stopped matching once Claude Code moved the plugins into a
// helper.
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const MARKER = '/* rgsk claude-katex */';
const BACKUP_SUFFIX = '.rgsk-bak';

const MATH_REMARK = 'window.__remarkBracketMath,window.__remarkMath';
const MATH_REHYPE = 'window.__rehypeKatex';

// Identifier runs are bounded because the bundle is megabytes of minified
// code, and an open-ended run backtracks quadratically on it.
const ID = '[A-Za-z_$][\\w$]{0,40}';

// 2.1.296 builds the props in a helper and spreads them in:
//   function ul0($,J){return ...{remarkPlugins:pl0,urlTransform:void 0}}
//   F(XJ1,{...ul0(Y,X),components:...})
// Spreading a call into props is common in the bundle (3 sites in 2.1.296),
// so the helper is found by its remarkPlugins return first, and only a spread
// of that name is matched. Its result is wrapped so its own plugins are kept.
const HELPER_RE = new RegExp(`function (${ID})\\([\\w$,]{0,40}\\)\\{return [^{}]{0,200}\\{remarkPlugins:`);
const spreadRe = (helper) =>
  new RegExp(`(${ID})\\((${ID}),\\{\\.\\.\\.${helper.replace(/\$/g, '\\$')}\\(([\\w$,]{0,40})\\),`);
const spreadTo = (helper) =>
  '$1($2,{...(p=>window.__KATEX_V2_LOADED' +
  `?{...p,remarkPlugins:(p.remarkPlugins||[]).concat([${MATH_REMARK}]),rehypePlugins:(p.rehypePlugins||[]).concat([${MATH_REHYPE}])}` +
  `:p)(${helper.replace(/\$/g, '$$$$')}($3)),`;

// Older builds wrote the plugins at the call site:
//   F(XJ1,{remarkPlugins:[Fk],components:...})
const INLINE_RE = new RegExp(`(${ID})\\((${ID}),\\{remarkPlugins:\\[([A-Za-z_$][\\w$,]{0,200})\\]`);
const INLINE_TO =
  `$1($2,{rehypePlugins:window.__KATEX_V2_LOADED?[${MATH_REHYPE}]:[],` +
  `remarkPlugins:[$3].concat(window.__KATEX_V2_LOADED?[${MATH_REMARK}]:[])`;

// The plugin references are guarded on __KATEX_V2_LOADED, which the bundle
// sets last, so if the bundle throws, chat still renders, without math.
function injectPlugins(body) {
  const helper = body.match(HELPER_RE)?.[1];
  if (helper && spreadRe(helper).test(body)) {
    return body.replace(spreadRe(helper), spreadTo(helper));
  }
  if (INLINE_RE.test(body)) {
    return body.replace(INLINE_RE, INLINE_TO);
  }
  return null;
}

function webviewPaths() {
  const claude = vscode.extensions.getExtension('anthropic.claude-code');
  if (!claude) {
    return null;
  }
  const dir = path.join(claude.extensionPath, 'webview');
  return {
    dir,
    js: path.join(dir, 'index.js'),
    css: path.join(dir, 'index.css'),
  };
}

// Returns 'patched', 'current' (already carries this patch), 'unsupported'
// (no react-markdown call matched, nothing written) or 'missing' (no Claude
// Code). A Claude Code update installs into a new folder, so every version
// starts unpatched and gets its own backups.
function patch(vendorDir) {
  const web = webviewPaths();
  if (!web) {
    return 'missing';
  }
  const body = fs.readFileSync(web.js, 'utf8');
  if (body.includes(MARKER)) {
    return 'current';
  }
  const injected = injectPlugins(body);
  if (injected === null) {
    return 'unsupported';
  }

  for (const file of [web.js, web.css]) {
    if (!fs.existsSync(file + BACKUP_SUFFIX)) {
      fs.copyFileSync(file, file + BACKUP_SUFFIX);
    }
  }

  const fontsFrom = path.join(vendorDir, 'fonts');
  const fontsTo = path.join(web.dir, 'fonts');
  fs.mkdirSync(fontsTo, { recursive: true });
  for (const font of fs.readdirSync(fontsFrom)) {
    fs.copyFileSync(path.join(fontsFrom, font), path.join(fontsTo, font));
  }

  // Prepended, because the React app mounts at the end of the bundle and the
  // window.__* plugins must exist by then. katex first, since copy-tex and
  // the math bundle read window.katex.
  const vendor = (name) => fs.readFileSync(path.join(vendorDir, name), 'utf8');
  fs.writeFileSync(
    web.js,
    [
      MARKER,
      vendor('katex.min.js'),
      vendor('copy-tex.min.js'),
      vendor('remark-math-bundle.js'),
      injected,
    ].join('\n')
  );
  // .katex-display scrolls sideways, so a wide equation does not widen the chat.
  fs.appendFileSync(
    web.css,
    `\n${MARKER}\n${vendor('katex.min.css')}\n` +
      '.katex-display{margin:.5em 0;overflow-x:auto;overflow-y:hidden;padding:.25em 0}\n'
  );
  return 'patched';
}

function unpatch() {
  const web = webviewPaths();
  if (!web) {
    return false;
  }
  let restored = false;
  for (const file of [web.js, web.css]) {
    if (fs.existsSync(file + BACKUP_SUFFIX)) {
      fs.renameSync(file + BACKUP_SUFFIX, file);
      restored = true;
    }
  }
  fs.rmSync(path.join(web.dir, 'fonts'), { recursive: true, force: true });
  return restored;
}

// The webview loaded the bundle before this extension activated, so a fresh
// patch only shows after the webview reloads.
function reloadWebview() {
  vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
}

function patchAndReport(vendorDir) {
  let result;
  try {
    result = patch(vendorDir);
  } catch (e) {
    vscode.window.showErrorMessage(`Claude LaTeX patch failed: ${e.message}`);
    return;
  }
  if (result === 'patched') {
    reloadWebview();
    vscode.window.setStatusBarMessage('Claude LaTeX patched', 3000);
  } else if (result === 'unsupported') {
    vscode.window.showWarningMessage(
      'Claude LaTeX: no react-markdown call matched in this Claude Code build; claude-katex.js needs a new pattern.'
    );
  }
}

function register(context) {
  const vendorDir = path.join(context.extensionPath, 'vendor', 'katex');
  patchAndReport(vendorDir);
  // fires when Claude Code updates, which installs an unpatched webview
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => patchAndReport(vendorDir))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('rgsk.unpatchClaudeLatex', () => {
      if (unpatch()) {
        reloadWebview();
        vscode.window.setStatusBarMessage('Claude LaTeX removed', 3000);
      }
    })
  );
}

module.exports = { register, injectPlugins };
