// Tiny i18n for the window UI — a ja/en dictionary plus a `t()` lookup, no
// dependency. Language defaults to the OS locale and can be overridden (and
// persisted) from Settings; clearing the override falls back to the OS again.

export type Lang = 'ja' | 'en';

const DICT = {
  ja: {
    // toolbar
    btnSidebar: '文書一覧 (⌘1)',
    btnOpen: 'ファイルを開く',
    btnNew: '新規作成 (⌘N)',
    btnNewLabel: '新規',
    btnReload: '再読み込み (⌘R)',
    btnSave: '保存',
    btnDelete: 'ゴミ箱に移動 (⌘⌫)',
    btnSettings: '設定 (⌘,)',
    edit: '編集',
    preview: 'プレビュー',
    // sidebar
    sidebarHeader: '開いている文書',
    close: '閉じる',
    // empty state
    emptyTitle: 'Markdownファイルを開いてください',
    emptyHint: '⌘O ・ボタン ・ドラッグ&ドロップ',
    recentTitle: '最近のファイル',
    // settings
    settingsTitle: '設定',
    toolbarSection: 'ツールバーに表示するボタン',
    langSection: '言語',
    langSystem: 'システムに従う',
    groupInline: 'インライン',
    groupBlock: 'ブロック',
    // format actions
    fmtBold: '太字',
    fmtItalic: '斜体',
    fmtStrike: '取り消し線',
    fmtCode: 'コード',
    fmtLink: 'リンク',
    fmtImage: '画像',
    fmtHeading: '見出し',
    fmtList: 'リスト',
    fmtOrdered: '番号付きリスト',
    fmtChecklist: 'チェックリスト',
    fmtQuote: '引用',
    fmtCodeblock: 'コードブロック',
    fmtTable: '表',
    fmtHr: '水平線',
    // dialogs / messages
    openFailed: '開けませんでした: {e}',
    saveFailed: '保存できませんでした: {e}',
    deleteFailed: '削除できませんでした: {e}',
    deleteConfirm: '「{name}」をゴミ箱に移動します。',
    deleteTitle: 'ファイルを削除',
    deleteOk: 'ゴミ箱に入れる',
    cancel: 'キャンセル',
    closeConfirm: '「{name}」は未保存です。閉じますか？',
  },
  en: {
    btnSidebar: 'Documents (⌘1)',
    btnOpen: 'Open File',
    btnNew: 'New (⌘N)',
    btnNewLabel: 'New',
    btnReload: 'Reload (⌘R)',
    btnSave: 'Save',
    btnDelete: 'Move to Trash (⌘⌫)',
    btnSettings: 'Settings (⌘,)',
    edit: 'Edit',
    preview: 'Preview',
    sidebarHeader: 'Open Documents',
    close: 'Close',
    emptyTitle: 'Open a Markdown file',
    emptyHint: '⌘O · button · drag & drop',
    recentTitle: 'Recent Files',
    settingsTitle: 'Settings',
    toolbarSection: 'Toolbar buttons',
    langSection: 'Language',
    langSystem: 'Use system language',
    groupInline: 'Inline',
    groupBlock: 'Block',
    fmtBold: 'Bold',
    fmtItalic: 'Italic',
    fmtStrike: 'Strikethrough',
    fmtCode: 'Code',
    fmtLink: 'Link',
    fmtImage: 'Image',
    fmtHeading: 'Heading',
    fmtList: 'List',
    fmtOrdered: 'Numbered list',
    fmtChecklist: 'Checklist',
    fmtQuote: 'Quote',
    fmtCodeblock: 'Code block',
    fmtTable: 'Table',
    fmtHr: 'Horizontal rule',
    openFailed: "Couldn't open: {e}",
    saveFailed: "Couldn't save: {e}",
    deleteFailed: "Couldn't delete: {e}",
    deleteConfirm: 'Move “{name}” to the Trash.',
    deleteTitle: 'Delete file',
    deleteOk: 'Move to Trash',
    cancel: 'Cancel',
    closeConfirm: '“{name}” has unsaved changes. Close it?',
  },
} as const;

export type Key = keyof (typeof DICT)['ja'];

const LANG_KEY = 'mdcrud.lang';

/** OS-derived language when there's no explicit override. */
function systemLang(): Lang {
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function resolve(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'ja' || stored === 'en' ? stored : systemLang();
}

let lang: Lang = resolve();

export function getLang(): Lang {
  return lang;
}

/** True when following the OS language (no explicit override stored). */
export function isSystemLang(): boolean {
  const stored = localStorage.getItem(LANG_KEY);
  return stored !== 'ja' && stored !== 'en';
}

/** Set an explicit language, or pass 'system' to follow the OS again. */
export function setLang(value: Lang | 'system') {
  if (value === 'system') localStorage.removeItem(LANG_KEY);
  else localStorage.setItem(LANG_KEY, value);
  lang = resolve();
}

export function t(key: Key, params?: Record<string, string>): string {
  let s: string = DICT[lang][key] ?? DICT.ja[key];
  if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]);
  return s;
}
