// Pure Markdown-rendering helpers — no DOM or Tauri dependencies.

/**
 * Build a URL-friendly id from heading text. Keeps unicode letters/numbers
 * (so Japanese headings survive) and collapses whitespace to hyphens.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/**
 * Text of the first ATX heading (`# ...` through `###### ...`) in a document,
 * with any trailing `#` closers stripped. Returns null when there is none —
 * used to suggest a file name when saving an untitled buffer.
 */
export function firstHeadingTitle(source: string): string | null {
  for (const line of source.split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}
