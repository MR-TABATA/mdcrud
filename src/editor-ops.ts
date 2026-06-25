// Pure text-selection transforms for the editor toolbar — no DOM or Tauri
// dependencies, so the markdown-formatting logic is unit-testable. Each takes
// and returns a `Sel` (the textarea value plus selection range) so the caller
// only has to push the result back into the element.

export interface Sel {
  text: string;
  start: number;
  end: number;
}

/**
 * Wrap the selection with an inline marker (e.g. `**`, `*`, `` ` ``), or strip
 * it when it is already wrapped — whether the markers sit just outside the
 * selection or inside it. With an empty selection, inserts the markers and
 * places the caret between them.
 */
export function toggleWrap(s: Sel, marker: string): Sel {
  const { text, start, end } = s;
  const m = marker.length;

  // Markers already just outside the selection → unwrap them.
  if (text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return {
      text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m),
      start: start - m,
      end: end - m,
    };
  }

  const selected = text.slice(start, end);

  // Markers captured inside the selection → unwrap them.
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }

  // Otherwise wrap, keeping the original text selected.
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + m,
    end: end + m,
  };
}

/**
 * Toggle a line prefix (e.g. `# `, `- `, `> `) on every non-blank line touched
 * by the selection. `detect` matches an existing prefix to strip; when every
 * non-blank line already matches it the block is un-prefixed, otherwise the
 * prefix is added. The whole affected block ends up selected.
 */
export function toggleLinePrefix(s: Sel, prefix: string, detect: RegExp): Sel {
  const { text } = s;
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let lineEnd = text.indexOf('\n', s.end);
  if (lineEnd === -1) lineEnd = text.length;

  const lines = text.slice(lineStart, lineEnd).split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const allPrefixed = nonBlank.length > 0 && nonBlank.every((l) => detect.test(l));

  const block = lines
    .map((l) => {
      if (l.trim() === '') return l;
      return allPrefixed ? l.replace(detect, '') : prefix + l;
    })
    .join('\n');

  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  };
}

/**
 * Wrap the selection as a Markdown link, leaving the `url` placeholder selected
 * so the user can type the destination immediately.
 */
export function insertLink(s: Sel): Sel {
  const { text, start, end } = s;
  const label = text.slice(start, end);
  const urlStart = start + label.length + 3; // '[' + label + ']('
  return {
    text: `${text.slice(0, start)}[${label}](url)${text.slice(end)}`,
    start: urlStart,
    end: urlStart + 3,
  };
}

/** Like {@link insertLink} but for an image (`![alt](url)`). */
export function insertImage(s: Sel): Sel {
  const { text, start, end } = s;
  const alt = text.slice(start, end);
  const urlStart = start + alt.length + 4; // '![' + alt + ']('
  return {
    text: `${text.slice(0, start)}![${alt}](url)${text.slice(end)}`,
    start: urlStart,
    end: urlStart + 3,
  };
}

/**
 * Insert `block` as its own paragraph, adding surrounding blank-line padding
 * only where the neighbouring text doesn't already provide it. Returns the new
 * text and where the block's own content begins.
 */
function asBlock(s: Sel, block: string): { text: string; bodyStart: number } {
  const before = s.text.slice(0, s.start);
  const after = s.text.slice(s.end);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const trail = after === '' || after.startsWith('\n') ? '' : '\n';
  return { text: before + lead + block + trail + after, bodyStart: s.start + lead.length };
}

/** Wrap the selection in a fenced code block, caret left in the language slot. */
export function insertFence(s: Sel): Sel {
  const body = s.text.slice(s.start, s.end);
  const { text, bodyStart } = asBlock(s, '```\n' + body + '\n```');
  const lang = bodyStart + 3; // just after the opening ```
  return { text, start: lang, end: lang };
}

/** Insert a 2×2 table skeleton with the first header cell selected. */
export function insertTable(s: Sel): Sel {
  const { text, bodyStart } = asBlock(s, '| 見出し | 見出し |\n| --- | --- |\n| セル | セル |');
  const cell = bodyStart + 2; // after the leading '| '
  return { text, start: cell, end: cell + 3 }; // '見出し'
}

/** Insert a horizontal rule (`---`) on its own line. */
export function insertHr(s: Sel): Sel {
  const { text, bodyStart } = asBlock(s, '---');
  const caret = bodyStart + 3;
  return { text, start: caret, end: caret };
}
