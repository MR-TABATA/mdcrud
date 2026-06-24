import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const openBtn = document.getElementById('open-btn')!;
const reloadBtn = document.getElementById('reload-btn')!;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const recentBox = document.getElementById('recent')!;
const filepath = document.getElementById('filepath')!;
const contentArea = document.querySelector('.content-area') as HTMLElement;

const SUPPORTED = ['md', 'markdown', 'txt'];
const isSupported = (p: string) => SUPPORTED.includes((p.split('.').pop() || '').toLowerCase());
const basename = (p: string) => p.split(/[\\/]/).pop() || p;

let currentFilePath: string | null = null;
let currentMtime = 0;

// Build a URL-friendly id from heading text (keeps unicode letters/numbers).
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

// Give headings ids so in-document anchor links (and a future TOC) work.
function addHeadingIds() {
  const used = new Set<string>();
  output.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((h) => {
    if (h.id) return;
    const base = slugify(h.textContent || '') || 'section';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    h.id = id;
  });
}

// Lazily load Mermaid only when a document actually contains a diagram, so the
// large dependency never slows down opening plain Markdown.
let mermaidLoader: Promise<typeof import('mermaid')['default']> | null = null;
function getMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        // Throw on invalid input instead of injecting Mermaid's "bomb" graphic,
        // so our own fallback handles errors.
        suppressErrorRendering: true,
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

// Turn ```mermaid code blocks into rendered diagrams (falling back to the
// source on error so a bad diagram never blanks the document).
async function renderMermaid() {
  const blocks = Array.from(output.querySelectorAll('code.language-mermaid'));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid();
  let i = 0;
  for (const block of blocks) {
    const host = block.closest('pre') ?? block;
    const source = block.textContent || '';
    try {
      // Validate first so invalid diagrams never reach render() (no DOM injection).
      if ((await mermaid.parse(source, { suppressErrors: true })) === false) {
        throw new Error('Invalid Mermaid syntax');
      }
      const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i++}`, source);
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.innerHTML = svg;
      host.replaceWith(diagram);
    } catch (e) {
      const fallback = document.createElement('div');
      fallback.className = 'mermaid-error';
      const msg = document.createElement('p');
      msg.textContent = `Mermaid render error: ${e instanceof Error ? e.message : e}`;
      fallback.append(msg, host.cloneNode(true));
      host.replaceWith(fallback);
    }
  }
}

// Resolve local (relative/absolute) image paths against the file's directory
// and route them through the asset protocol so they actually load.
function resolveLocalImages(filePath: string) {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const dir = filePath.slice(0, filePath.lastIndexOf(sep));
  output.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || /^(https?:|data:|blob:|asset:|tauri:)/i.test(src)) return;
    const rel = src.replace(/^\.\//, '');
    const isAbsolute = rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
    const abs = isAbsolute ? rel : `${dir}${sep}${rel.split('/').join(sep)}`;
    img.src = convertFileSrc(abs);
  });
}

async function renderFile(filePath: string, opts: { preserveScroll?: boolean } = {}) {
  let content: string;
  try {
    content = await invoke<string>('read_file', { path: filePath });
  } catch (e) {
    filepath.textContent = `開けませんでした: ${e}`;
    return;
  }
  const scrollTop = contentArea.scrollTop;
  const html = await marked.parse(content);
  output.innerHTML = DOMPurify.sanitize(html);
  addHeadingIds();
  resolveLocalImages(filePath);
  await renderMermaid();
  output.style.display = 'block';
  emptyState.style.display = 'none';
  (reloadBtn as HTMLButtonElement).disabled = false;
  currentFilePath = filePath;
  currentMtime = await invoke<number>('file_mtime', { path: filePath }).catch(() => 0);
  filepath.textContent = basename(filePath);
  contentArea.scrollTop = opts.preserveScroll ? scrollTop : 0;
  invoke<string[]>('add_recent_file', { path: filePath })
    .then(renderRecent)
    .catch(() => {});
}

// Recent files are shown in the empty state for quick reopening.
function renderRecent(list: string[]) {
  recentBox.innerHTML = '';
  if (!list || list.length === 0) return;
  const title = document.createElement('div');
  title.className = 'recent-title';
  title.textContent = '最近のファイル';
  recentBox.appendChild(title);
  const ul = document.createElement('ul');
  for (const p of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = basename(p);
    const path = document.createElement('span');
    path.className = 'recent-path';
    path.textContent = p;
    li.append(name, path);
    li.addEventListener('click', () => renderFile(p));
    ul.appendChild(li);
  }
  recentBox.appendChild(ul);
}

openBtn.addEventListener('click', async () => {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: SUPPORTED }]
  });
  if (selected) await renderFile(selected as string);
});

reloadBtn.addEventListener('click', async () => {
  if (currentFilePath) await renderFile(currentFilePath, { preserveScroll: true });
});

document.addEventListener('keydown', async (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault();
    openBtn.click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'r' && currentFilePath) {
    e.preventDefault();
    await renderFile(currentFilePath, { preserveScroll: true });
  }
});

// Keep clicks inside the document: external links open in the default browser,
// internal anchors scroll, so the webview never navigates away from the app.
output.addEventListener('click', async (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth' });
  } else {
    await openUrl(href);
  }
});

// Drag a Markdown file onto the window to open it.
getCurrentWebview().onDragDropEvent((event) => {
  const p = event.payload;
  if (p.type === 'enter' || p.type === 'over') {
    contentArea.classList.add('drag-over');
  } else if (p.type === 'drop') {
    contentArea.classList.remove('drag-over');
    const file = p.paths.find(isSupported);
    if (file) renderFile(file);
  } else {
    contentArea.classList.remove('drag-over');
  }
});

// Auto-reload: re-render when the open file changes on disk.
setInterval(async () => {
  if (!currentFilePath) return;
  try {
    const m = await invoke<number>('file_mtime', { path: currentFilePath });
    if (m > currentMtime) await renderFile(currentFilePath, { preserveScroll: true });
  } catch {
    // File may have been moved/removed; leave the last render in place.
  }
}, 1500);

// Open files passed by the OS via double-click / "Open With".
// Runtime opens (app already running) arrive as an event...
listen<string>('open-file', (e) => {
  if (e.payload) renderFile(e.payload);
});

// ...while a file the app was launched with is fetched once on startup.
invoke<string | null>('get_pending_file').then((path) => {
  if (path) renderFile(path);
});

// Populate the recent-files list shown in the empty state.
invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
