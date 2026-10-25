// Webview half of the cell numbers (extension half: registerCellNumbers in
// extension.js). Rendered markdown cells hide the cell status bar, so the
// number goes into the rendered markdown itself: a markdown-it rule puts an
// empty span, keyed by a hash of the cell's source, at the top of each one.
// The renderer is never told which cell it renders, so the extension sends
// [{index, key}] for the notebook's markdown cells and relabel() fills each
// span by matching keys. Cells with the same source share a key; those are
// told apart by order on screen.

// djb2 over the source, line endings and outer whitespace normalized.
// The same function is in extension.js; they must stay in step.
function key(text) {
  const s = text.replace(/\r\n/g, '\n').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

let cells = [];

// Every span, in every rendered cell (each one sits in its own shadow root,
// which may itself be inside another).
function spans(root = document, found = []) {
  found.push(...root.querySelectorAll('.rgsk-cell-n'));
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) {
      spans(host.shadowRoot, found);
    }
  }
  return found;
}

function relabel() {
  const byKey = new Map();
  for (const span of spans()) {
    const k = span.dataset.key;
    if (!byKey.has(k)) {
      byKey.set(k, []);
    }
    byKey.get(k).push(span);
  }
  for (const [k, group] of byKey) {
    group.sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
    );
    const indices = cells.filter((c) => c.key === k).map((c) => c.index);
    group.forEach((span, i) => {
      span.textContent = i < indices.length ? `cell ${indices[i] + 1}` : '';
    });
  }
}

export async function activate(ctx) {
  let answered = false;
  ctx.onDidReceiveMessage?.((message) => {
    answered = true;
    cells = message.cells;
    relabel();
  });
  // The first ready can land before the extension is listening (this
  // renderer is what activates it), so ask again until it answers.
  let tries = 0;
  const ask = () => {
    if (answered || tries++ >= 20) {
      return;
    }
    ctx.postMessage?.({ type: 'ready' });
    setTimeout(ask, 500);
  };
  ask();
  // An extending renderer hooks itself in: it fetches the markdown-it
  // renderer and hands it the plugin (as VSCode's own markdown-math does).
  const markdownIt = await ctx.getRenderer('vscode.markdown-it-renderer');
  markdownIt?.extendMarkdownIt((md) => {
    md.core.ruler.push('rgsk_cell_number', (state) => {
      const span = new state.Token('html_block', '', 0);
      // bottom-left in the status bar's font, like a code cell's label, in
      // the markdown's own text colour
      span.content =
        `<span class="rgsk-cell-n" data-key="${key(state.src)}" ` +
        'style="display: block; margin-top: 8px; ' +
        'font-size: 12px; font-family: var(--vscode-font-family);"></span>\n';
      state.tokens.push(span);
      // the span reaches the DOM only after render returns
      setTimeout(relabel, 0);
    });
  });
}
