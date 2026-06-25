// Pure path helpers — no DOM or Tauri dependencies, so they are unit-testable.

export const SUPPORTED = ['md', 'markdown', 'txt'];

/** Whether a path looks like a Markdown file we can open. */
export function isSupported(path: string): boolean {
  return SUPPORTED.includes((path.split('.').pop() || '').toLowerCase());
}

/** Final path component, handling both POSIX and Windows separators. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Directory portion of a path (everything before the final separator). */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i <= 0 ? '' : path.slice(0, i);
}

/**
 * Turn arbitrary heading text into a safe file name (no path separators or
 * characters Windows forbids), collapsed and length-capped. Falls back to
 * `untitled` when nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'untitled';
}

/** Abbreviate the home-directory prefix to `~` (home should have no trailing slash). */
export function tildify(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * Resolve a Markdown image `src` against the document's file path.
 *
 * Returns an absolute filesystem path to feed through `convertFileSrc`, or
 * `null` when the src is remote/data/already-resolved and should be left as-is.
 */
export function resolveImagePath(filePath: string, src: string): string | null {
  if (!src || /^(https?:|data:|blob:|asset:|tauri:)/i.test(src)) return null;
  const sep = filePath.includes('\\') ? '\\' : '/';
  const dir = filePath.slice(0, filePath.lastIndexOf(sep));
  const rel = src.replace(/^\.\//, '');
  const isAbsolute =
    rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
  return isAbsolute ? rel : `${dir}${sep}${rel.split('/').join(sep)}`;
}
