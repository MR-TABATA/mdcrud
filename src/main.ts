import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SUPPORTED, isSupported, basename, resolveImagePath } from './paths';
import { slugify } from './markdown';

const sidebarBtn = document.getElementById('sidebar-btn')!;
const openBtn = document.getElementById('open-btn')!;
const newBtn = document.getElementById('new-btn')!;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const editBtn = document.getElementById('edit-btn') as HTMLButtonElement;
const editLabel = document.getElementById('edit-label')!;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const recentBox = document.getElementById('recent')!;
const filepath = document.getElementById('filepath')!;
const divider = document.getElementById('divider')!;
const docList = document.getElementById('doc-list')!;
const contentArea = document.querySelector('.content-area') as HTMLElement;

// A document open in the session. `workingText` is the editor buffer, which
// may differ from what's on disk (`savedSource`) until saved. `path` is null
// for a new, never-saved ("untitled") document.
interface Doc {
  path: string | null;
  name: string;
  savedSource: string;
  workingText: string;
  mtime: number;
}

let docs: Doc[] = [];
let active: Doc | null = null;
let isEditing = false;
let lastActiveDirty = false;
let untitledCount = 0;

const isDirty = (d: Doc) => d.workingText !== d.savedSource;

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
  output.querySelectorAll('img').forEach((img) => {
    const abs = resolveImagePath(filePath, img.getAttribute('src') || '');
    if (abs) img.src = convertFileSrc(abs);
  });
}

// Render Markdown source into the preview pane (no disk I/O).
async function renderSource(source: string, filePath: string) {
  const html = await marked.parse(source);
  output.innerHTML = DOMPurify.sanitize(html);
  addHeadingIds();
  resolveLocalImages(filePath);
  await renderMermaid();
}

// --- Session UI state ---

function showDocUI() {
  emptyState.style.display = 'none';
  output.style.display = 'block';
  reloadBtn.disabled = false;
  editBtn.disabled = false;
}

function showEmpty() {
  setEditing(false);
  output.style.display = 'none';
  output.innerHTML = '';
  editor.value = '';
  emptyState.style.display = '';
  reloadBtn.disabled = true;
  editBtn.disabled = true;
  saveBtn.disabled = true;
  filepath.textContent = '';
  invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
}

// Reflect the active document + dirty state in the toolbar.
function updateStatus() {
  const dirty = active ? isDirty(active) : false;
  saveBtn.disabled = !dirty;
  saveBtn.classList.toggle('dirty', dirty);
  filepath.textContent = '';
  if (!active) return;
  if (dirty) {
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.textContent = '●';
    filepath.appendChild(dot);
  }
  filepath.append(active.name);
}

function setEditing(on: boolean) {
  isEditing = on;
  contentArea.classList.toggle('editing', on);
  editLabel.textContent = on ? 'プレビュー' : '編集';
  if (on) editor.focus();
}

// --- Sidebar (open documents) ---

function renderSidebar() {
  docList.innerHTML = '';
  for (const doc of docs) {
    const li = document.createElement('li');
    if (doc === active) li.classList.add('active');
    if (isDirty(doc)) li.classList.add('dirty');
    li.title = doc.path ?? doc.name;

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.name;

    const close = document.createElement('span');
    close.className = 'doc-close';
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    close.title = '閉じる';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoc(doc);
    });

    li.append(name);
    if (isDirty(doc)) {
      const dot = document.createElement('span');
      dot.className = 'doc-dirty';
      dot.textContent = '●';
      li.append(dot);
    }
    li.append(close);
    li.addEventListener('click', () => setActive(doc));
    docList.appendChild(li);
  }
}

const SESSION_KEY = 'mdcrud.session';
function saveSession() {
  // Only on-disk documents can be restored; untitled buffers are not persisted.
  const paths = docs.map((d) => d.path).filter((p): p is string => p !== null);
  const data = { paths, active: active?.path ?? null };
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

async function setActive(doc: Doc) {
  if (active === doc) {
    if (isEditing) editor.focus();
    return;
  }
  active = doc;
  lastActiveDirty = isDirty(doc);
  editor.value = doc.workingText;
  await renderSource(doc.workingText, doc.path ?? '');
  showDocUI();
  updateStatus();
  renderSidebar();
  saveSession();
  contentArea.scrollTop = 0;
  if (isEditing) editor.focus();
}

async function openFile(path: string) {
  const existing = docs.find((d) => d.path === path);
  if (existing) {
    await setActive(existing);
    return;
  }
  let content: string;
  try {
    content = await invoke<string>('read_file', { path });
  } catch (e) {
    filepath.textContent = `開けませんでした: ${e}`;
    return;
  }
  const mtime = await invoke<number>('file_mtime', { path }).catch(() => 0);
  const doc: Doc = { path, name: basename(path), savedSource: content, workingText: content, mtime };
  docs.push(doc);
  active = doc;
  lastActiveDirty = false;
  editor.value = content;
  await renderSource(content, path);
  showDocUI();
  updateStatus();
  renderSidebar();
  saveSession();
  contentArea.scrollTop = 0;
  invoke<string[]>('add_recent_file', { path }).then(renderRecent).catch(() => {});
}

async function closeDoc(doc: Doc) {
  if (isDirty(doc) && !confirm(`「${doc.name}」は未保存です。閉じますか？`)) {
    return;
  }
  const idx = docs.indexOf(doc);
  if (idx === -1) return;
  docs.splice(idx, 1);
  if (active === doc) {
    const next = docs[idx] ?? docs[idx - 1] ?? null;
    active = null;
    if (next) await setActive(next);
    else showEmpty();
  }
  renderSidebar();
  saveSession();
}

// Create a new, empty "untitled" document and start editing it.
function newDoc() {
  untitledCount++;
  const name = untitledCount === 1 ? 'untitled' : `untitled ${untitledCount}`;
  const doc: Doc = { path: null, name, savedSource: '', workingText: '', mtime: 0 };
  docs.push(doc);
  active = doc;
  lastActiveDirty = false;
  editor.value = '';
  renderSource('', '');
  showDocUI();
  setEditing(true);
  updateStatus();
  renderSidebar();
  saveSession();
  contentArea.scrollTop = 0;
}

async function save() {
  if (!active) return;
  // Titled doc with no changes: nothing to do. Untitled always offers a save.
  if (active.path && !isDirty(active)) return;

  let path = active.path;
  if (!path) {
    const chosen = await saveDialog({
      defaultPath: `${active.name}.md`,
      filters: [{ name: 'Markdown', extensions: SUPPORTED }]
    });
    if (!chosen) return; // cancelled
    path = chosen;
  }

  try {
    await invoke('save_file', { path, content: active.workingText });
  } catch (e) {
    filepath.textContent = `保存できませんでした: ${e}`;
    return;
  }

  active.path = path;
  active.name = basename(path);
  active.savedSource = active.workingText;
  active.mtime = await invoke<number>('file_mtime', { path }).catch(() => 0);
  lastActiveDirty = false;
  updateStatus();
  renderSidebar();
  saveSession();
  invoke<string[]>('add_recent_file', { path }).then(renderRecent).catch(() => {});
}

// Re-read the active document from disk into the editor and preview.
async function refreshActiveFromDisk(preserveScroll: boolean) {
  if (!active || !active.path) return;
  const content = await invoke<string>('read_file', { path: active.path }).catch(() => null);
  if (content == null) return;
  const scrollTop = contentArea.scrollTop;
  active.savedSource = content;
  active.workingText = content;
  editor.value = content;
  active.mtime = await invoke<number>('file_mtime', { path: active.path }).catch(() => 0);
  lastActiveDirty = false;
  await renderSource(content, active.path);
  updateStatus();
  renderSidebar();
  if (preserveScroll) contentArea.scrollTop = scrollTop;
}

// Re-read from disk, but never silently discard unsaved edits.
async function reload() {
  if (!active || !active.path || isDirty(active)) return;
  await refreshActiveFromDisk(true);
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
    li.addEventListener('click', () => openFile(p));
    ul.appendChild(li);
  }
  recentBox.appendChild(ul);
}

openBtn.addEventListener('click', async () => {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: SUPPORTED }]
  });
  if (selected) await openFile(selected as string);
});

newBtn.addEventListener('click', newDoc);
reloadBtn.addEventListener('click', reload);
saveBtn.addEventListener('click', save);
editBtn.addEventListener('click', () => {
  if (active) setEditing(!isEditing);
});

// Live preview while typing, debounced so large documents stay responsive.
let previewTimer: number | undefined;
editor.addEventListener('input', () => {
  if (!active) return;
  active.workingText = editor.value;
  updateStatus();
  if (isDirty(active) !== lastActiveDirty) {
    lastActiveDirty = isDirty(active);
    renderSidebar();
  }
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (active) renderSource(active.workingText, active.path ?? '');
  }, 250);
});

// --- Sidebar visibility (default shown, persisted when hidden) ---
const SIDEBAR_KEY = 'mdcrud.sidebar';
document.body.classList.toggle('sidebar-hidden', localStorage.getItem(SIDEBAR_KEY) === 'hidden');
sidebarBtn.addEventListener('click', () => {
  const hidden = !document.body.classList.contains('sidebar-hidden');
  document.body.classList.toggle('sidebar-hidden', hidden);
  localStorage.setItem(SIDEBAR_KEY, hidden ? 'hidden' : 'shown');
});

document.addEventListener('keydown', async (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 'o') {
    e.preventDefault();
    openBtn.click();
  } else if (e.key === 'n') {
    e.preventDefault();
    newDoc();
  } else if (e.key === 's') {
    e.preventDefault();
    await save();
  } else if (e.key === 'e' && active) {
    e.preventDefault();
    setEditing(!isEditing);
  } else if (e.key === 'r') {
    e.preventDefault();
    await reload();
  } else if (e.key === '1') {
    e.preventDefault();
    sidebarBtn.click();
  } else if (e.key === 'w' && active) {
    e.preventDefault();
    closeDoc(active);
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

// Draggable split: drag the divider to resize the editor/preview panes,
// persisting the ratio across sessions.
const SPLIT_KEY = 'mdcrud.split';
const savedSplit = localStorage.getItem(SPLIT_KEY);
if (savedSplit) contentArea.style.setProperty('--split', savedSplit);

divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  contentArea.classList.add('resizing');
  const onMove = (ev: MouseEvent) => {
    const rect = contentArea.getBoundingClientRect();
    const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
    contentArea.style.setProperty('--split', `${pct}%`);
  };
  const onUp = () => {
    contentArea.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const value = contentArea.style.getPropertyValue('--split');
    if (value) localStorage.setItem(SPLIT_KEY, value);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Drag a Markdown file onto the window to open it.
getCurrentWebview().onDragDropEvent((event) => {
  const p = event.payload;
  if (p.type === 'enter' || p.type === 'over') {
    contentArea.classList.add('drag-over');
  } else if (p.type === 'drop') {
    contentArea.classList.remove('drag-over');
    for (const file of p.paths.filter(isSupported)) openFile(file);
  } else {
    contentArea.classList.remove('drag-over');
  }
});

// Auto-reload: re-render when the active file changes on disk. Paused while
// editing or with unsaved changes so it never clobbers the user's work.
setInterval(async () => {
  if (!active || !active.path || isEditing || isDirty(active)) return;
  try {
    const m = await invoke<number>('file_mtime', { path: active.path });
    if (m > active.mtime) await refreshActiveFromDisk(true);
  } catch {
    // File may have been moved/removed; leave the last render in place.
  }
}, 1500);

// Restore the previous session, then handle a file the app was launched with.
async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  let data: { paths?: string[]; active?: string | null };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  for (const p of data.paths ?? []) {
    try {
      const content = await invoke<string>('read_file', { path: p });
      const mtime = await invoke<number>('file_mtime', { path: p }).catch(() => 0);
      docs.push({ path: p, name: basename(p), savedSource: content, workingText: content, mtime });
    } catch {
      // Skip files that no longer exist.
    }
  }
  const target = docs.find((d) => d.path === data.active) ?? docs[0] ?? null;
  if (target) {
    active = target;
    lastActiveDirty = false;
    editor.value = target.workingText;
    await renderSource(target.workingText, target.path ?? '');
    showDocUI();
    updateStatus();
  }
  renderSidebar();
}

// Runtime opens (app already running) arrive as an event.
listen<string>('open-file', (e) => {
  if (e.payload) openFile(e.payload);
});

// Restore the previous session first, then open any file the app was launched
// with (added on top of / focused within the restored set).
restoreSession().then(() => {
  invoke<string | null>('get_pending_file').then((path) => {
    if (path) openFile(path);
  });
});

// Populate the recent-files list shown in the empty state.
invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
