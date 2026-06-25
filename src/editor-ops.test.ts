import { describe, it, expect } from 'vitest';
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

const sel = (text: string, start: number, end: number): Sel => ({ text, start, end });

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const r = toggleWrap(sel('a bold c', 2, 6), '**');
    expect(r.text).toBe('a **bold** c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers sit just outside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 4, 8), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers are inside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 2, 10), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('inserts empty markers with the caret between them', () => {
    const r = toggleWrap(sel('ab', 1, 1), '*');
    expect(r.text).toBe('a**b');
    expect(r.start).toBe(2);
    expect(r.end).toBe(2);
  });
});

describe('toggleLinePrefix', () => {
  it('adds a heading prefix to the current line', () => {
    const r = toggleLinePrefix(sel('hello', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('# hello');
  });
  it('removes the prefix when every line already has one', () => {
    const r = toggleLinePrefix(sel('- a\n- b', 0, 7), '- ', /^[-*+] /);
    expect(r.text).toBe('a\nb');
  });
  it('strips any heading level', () => {
    const r = toggleLinePrefix(sel('### deep', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('deep');
  });
  it('prefixes a multi-line block, skipping blank lines', () => {
    const r = toggleLinePrefix(sel('a\n\nb', 0, 4), '> ', /^> /);
    expect(r.text).toBe('> a\n\n> b');
    expect(r.text.slice(r.start, r.end)).toBe('> a\n\n> b');
  });
});

describe('insertLink', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const r = insertLink(sel('see here now', 4, 8));
    expect(r.text).toBe('see [here](url) now');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('insertImage', () => {
  it('uses the selection as alt text and selects the url', () => {
    const r = insertImage(sel('logo', 0, 4));
    expect(r.text).toBe('![logo](url)');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('block inserts', () => {
  it('pads a horizontal rule onto its own line', () => {
    const r = insertHr(sel('a', 1, 1));
    expect(r.text).toBe('a\n---');
    expect(r.start).toBe(5);
  });
  it('does not double blank lines that already exist', () => {
    const r = insertHr(sel('a\n', 2, 2));
    expect(r.text).toBe('a\n---');
  });
  it('wraps a selection in a fenced code block with caret in the lang slot', () => {
    const r = insertFence(sel('x()', 0, 3));
    expect(r.text).toBe('```\nx()\n```');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });
  it('inserts a table skeleton with the first header selected', () => {
    const r = insertTable(sel('', 0, 0));
    expect(r.text).toBe('| 見出し | 見出し |\n| --- | --- |\n| セル | セル |');
    expect(r.text.slice(r.start, r.end)).toBe('見出し');
  });
});
