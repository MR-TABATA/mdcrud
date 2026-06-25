import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { homeDir } from '@tauri-apps/api/path';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SUPPORTED, isSupported, basename, tildify, resolveImagePath, sanitizeFilename } from './paths';
import { slugify, firstHeadingTitle } from './markdown';
import {
  toggleWrap,
  toggleLinePrefix,
  insertLink,
  insertImage,
  insertFence,
  insertTable,
  insertHr,
  type Sel,
} from './editor-ops';

const sidebarBtn = document.getElementById('sidebar-btn')!;
const openBtn = document.getElementById('open-btn')!;
const newBtn = document.getElementById('new-btn')!;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const editBtn = document.getElementById('edit-btn') as HTMLButtonElement;
const editLabel = document.getElementById('edit-label')!;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const formatBar = document.getElementById('format-bar')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLElement;
const settingsClose = document.getElementById('settings-close')!;
const toolbarOptions = document.getElementById('toolbar-options')!;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const recentBox = document.getElementById('recent')!;
const filepath = document.getElementById('filepath')!;
const divider = document.getElementById('divider')!;
const appWindow = getCurrentWindow();

// Home directory, used to abbreviate paths to ~ (resolved once on startup).
let home = '';
homeDir()
  .then((h) => {
    home = h.replace(/[\\/]$/, '');
    updateStatus();
  })
  .catch(() => {});
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
  appWindow.setTitle('mdcrud').catch(() => {});
  invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
}

// Reflect the active document + dirty state in the toolbar.
function updateStatus() {
  const dirty = active ? isDirty(active) : false;
  saveBtn.disabled = !dirty;
  saveBtn.classList.toggle('dirty', dirty);
  filepath.textContent = '';
  // Window title shows the file name; the toolbar shows the full (~) path.
  appWindow.setTitle(active ? active.name : 'mdcrud').catch(() => {});
  if (!active) return;
  if (dirty) {
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.textContent = '●';
    filepath.appendChild(dot);
  }
  filepath.append(active.path ? tildify(active.path, home) : active.name);
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
    // Suggest a file name from the document's first heading, falling back to
    // the untitled buffer name.
    const title = firstHeadingTitle(active.workingText);
    const base = title ? sanitizeFilename(title) : active.name;
    const chosen = await saveDialog({
      defaultPath: `${base}.md`,
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

// Replace the editor's text through execCommand so the change lands on the
// WebView's native undo stack — assigning `editor.value` directly would wipe
// it, breaking ⌘Z and Edit ▸ Undo. Only the differing middle span is replaced
// (common prefix/suffix preserved). Falls back to a plain assignment if the
// command is unavailable.
function replaceEditorText(newText: string, selStart: number, selEnd: number) {
  const old = editor.value;
  let p = 0;
  while (p < old.length && p < newText.length && old[p] === newText[p]) p++;
  let s = 0;
  while (
    s < old.length - p &&
    s < newText.length - p &&
    old[old.length - 1 - s] === newText[newText.length - 1 - s]
  ) {
    s++;
  }
  editor.focus();
  editor.setSelectionRange(p, old.length - s);
  if (!document.execCommand('insertText', false, newText.slice(p, newText.length - s))) {
    editor.value = newText;
  }
  editor.setSelectionRange(selStart, selEnd);
}

// All Markdown formatting actions the toolbar can offer. `group` drives the
// visual separators (inline vs. block) and the grouping in Settings; `run`
// transforms the current selection. Registry order is the display order.
interface FmtAction {
  id: string;
  title: string;
  group: 'inline' | 'block';
  svg: string;
  run: (s: Sel) => Sel;
}

const ICON =
  (paths: string, attrs = 'fill="none" stroke="currentColor" stroke-width="2"') =>
    `<svg viewBox="0 0 24 24" ${attrs}>${paths}</svg>`;

const FMT_ACTIONS: FmtAction[] = [
  { id: 'bold', title: '太字', group: 'inline',
    svg: ICON('<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>'),
    run: (s) => toggleWrap(s, '**') },
  { id: 'italic', title: '斜体', group: 'inline',
    svg: ICON('<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>'),
    run: (s) => toggleWrap(s, '*') },
  { id: 'strike', title: '取り消し線', group: 'inline',
    svg: ICON('<path d="M16 5H9a3 3 0 0 0-2.8 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>'),
    run: (s) => toggleWrap(s, '~~') },
  { id: 'code', title: 'コード', group: 'inline',
    svg: ICON('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    run: (s) => toggleWrap(s, '`') },
  { id: 'link', title: 'リンク', group: 'inline',
    svg: ICON('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    run: (s) => insertLink(s) },
  { id: 'image', title: '画像', group: 'inline',
    svg: ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
    run: (s) => insertImage(s) },
  { id: 'heading', title: '見出し', group: 'block',
    svg: ICON('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
    run: (s) => toggleLinePrefix(s, '# ', /^#{1,6} /) },
  { id: 'list', title: 'リスト', group: 'block',
    svg: ICON('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    run: (s) => toggleLinePrefix(s, '- ', /^[-*+] /) },
  { id: 'ordered', title: '番号付きリスト', group: 'block',
    svg: ICON('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18v-1a1 1 0 0 0-2 0M4 18h2"/>'),
    run: (s) => toggleLinePrefix(s, '1. ', /^\d+\. /) },
  { id: 'checklist', title: 'チェックリスト', group: 'block',
    svg: ICON('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    run: (s) => toggleLinePrefix(s, '- [ ] ', /^[-*+] \[[ xX]\] /) },
  { id: 'quote', title: '引用', group: 'block',
    svg: ICON('<path d="M7 17h3l2-4V7H6v6h3zm8 0h3l2-4V7h-6v6h3z"/>', 'fill="currentColor" stroke="none"'),
    run: (s) => toggleLinePrefix(s, '> ', /^> /) },
  { id: 'codeblock', title: 'コードブロック', group: 'block',
    svg: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9 9 7 12 9 15"/><polyline points="15 9 17 12 15 15"/>'),
    run: (s) => insertFence(s) },
  { id: 'table', title: '表', group: 'block',
    svg: ICON('<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'),
    run: (s) => insertTable(s) },
  { id: 'hr', title: '水平線', group: 'block',
    svg: ICON('<line x1="3" y1="12" x2="21" y2="12"/>'),
    run: (s) => insertHr(s) },
];
const FMT_BY_ID = new Map(FMT_ACTIONS.map((a) => [a.id, a]));
const FMT_DEFAULT = ['heading', 'bold', 'italic', 'code', 'list', 'quote', 'link'];
const GROUP_LABEL: Record<FmtAction['group'], string> = { inline: 'インライン', block: 'ブロック' };

// Which buttons the user has chosen to show, persisted across sessions and
// always kept in registry order.
const TOOLBAR_KEY = 'mdcrud.toolbar';
function enabledIds(): string[] {
  const raw = localStorage.getItem(TOOLBAR_KEY);
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return FMT_ACTIONS.filter((a) => ids.includes(a.id)).map((a) => a.id);
    } catch {
      // fall through to default
    }
  }
  return FMT_DEFAULT;
}

function renderFormatBar() {
  const enabled = new Set(enabledIds());
  formatBar.innerHTML = '';
  let prevGroup: string | null = null;
  for (const a of FMT_ACTIONS) {
    if (!enabled.has(a.id)) continue;
    if (prevGroup && a.group !== prevGroup) {
      const sep = document.createElement('span');
      sep.className = 'format-sep';
      formatBar.appendChild(sep);
    }
    prevGroup = a.group;
    const btn = document.createElement('button');
    btn.dataset.fmt = a.id;
    const key = a.id === 'bold' ? ' (⌘B)' : a.id === 'italic' ? ' (⌘I)' : '';
    btn.title = a.title + key;
    btn.innerHTML = a.svg;
    formatBar.appendChild(btn);
  }
}

// Apply a Markdown formatting action to the editor's current selection, then
// re-sync the model and preview as if the text had been typed.
function applyFmt(id: string) {
  if (!active) return;
  const action = FMT_BY_ID.get(id);
  if (!action) return;
  if (!isEditing) setEditing(true);
  const before: Sel = { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  const after = action.run(before);
  replaceEditorText(after.text, after.start, after.end);
  active.workingText = editor.value;
  updateStatus();
  if (isDirty(active) !== lastActiveDirty) {
    lastActiveDirty = isDirty(active);
    renderSidebar();
  }
  renderSource(active.workingText, active.path ?? '');
}

formatBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const kind = btn?.dataset.fmt;
  if (kind) applyFmt(kind);
});

// --- Settings (⌘,): customise which formatting buttons show ---

function buildToolbarOptions() {
  const enabled = new Set(enabledIds());
  toolbarOptions.innerHTML = '';
  let prevGroup: string | null = null;
  for (const a of FMT_ACTIONS) {
    if (a.group !== prevGroup) {
      const head = document.createElement('div');
      head.className = 'opt-group-title';
      head.textContent = GROUP_LABEL[a.group];
      toolbarOptions.appendChild(head);
      prevGroup = a.group;
    }
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled.has(a.id);
    cb.addEventListener('change', () => {
      const next = FMT_ACTIONS.filter((x) =>
        x.id === a.id ? cb.checked : enabled.has(x.id)
      ).map((x) => x.id);
      enabled.clear();
      next.forEach((id) => enabled.add(id));
      localStorage.setItem(TOOLBAR_KEY, JSON.stringify(next));
      renderFormatBar();
    });
    const icon = document.createElement('span');
    icon.className = 'opt-icon';
    icon.innerHTML = a.svg;
    const name = document.createElement('span');
    name.textContent = a.title;
    label.append(cb, icon, name);
    toolbarOptions.appendChild(label);
  }
}

function openSettings() {
  buildToolbarOptions();
  settingsOverlay.hidden = false;
}
function closeSettings() {
  settingsOverlay.hidden = true;
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

renderFormatBar();

// --- Sidebar visibility (default shown, persisted when hidden) ---
const SIDEBAR_KEY = 'mdcrud.sidebar';
document.body.classList.toggle('sidebar-hidden', localStorage.getItem(SIDEBAR_KEY) === 'hidden');
sidebarBtn.addEventListener('click', () => {
  const hidden = !document.body.classList.contains('sidebar-hidden');
  document.body.classList.toggle('sidebar-hidden', hidden);
  localStorage.setItem(SIDEBAR_KEY, hidden ? 'hidden' : 'shown');
});

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' && !settingsOverlay.hidden) {
    closeSettings();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === ',') {
    e.preventDefault();
    settingsOverlay.hidden ? openSettings() : closeSettings();
    return;
  }
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
  } else if (e.key === 'b' && active && isEditing) {
    e.preventDefault();
    applyFmt('bold');
  } else if (e.key === 'i' && active && isEditing) {
    e.preventDefault();
    applyFmt('italic');
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
