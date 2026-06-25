import { describe, it, expect } from 'vitest';
import { isSupported, basename, dirname, tildify, resolveImagePath, sanitizeFilename } from './paths';

describe('isSupported', () => {
  it('accepts markdown extensions case-insensitively', () => {
    expect(isSupported('a.md')).toBe(true);
    expect(isSupported('A.MARKDOWN')).toBe(true);
    expect(isSupported('notes.txt')).toBe(true);
  });
  it('rejects other extensions and extensionless paths', () => {
    expect(isSupported('image.png')).toBe(false);
    expect(isSupported('Makefile')).toBe(false);
    expect(isSupported('')).toBe(false);
  });
});

describe('basename', () => {
  it('handles posix and windows separators', () => {
    expect(basename('/home/u/a.md')).toBe('a.md');
    expect(basename('C:\\docs\\a.md')).toBe('a.md');
    expect(basename('a.md')).toBe('a.md');
  });
});

describe('dirname', () => {
  it('returns the directory portion', () => {
    expect(dirname('/home/u/a.md')).toBe('/home/u');
    expect(dirname('C:\\docs\\a.md')).toBe('C:\\docs');
  });
  it('returns empty when there is no directory', () => {
    expect(dirname('a.md')).toBe('');
    expect(dirname('/a.md')).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('replaces path separators and reserved characters', () => {
    expect(sanitizeFilename('a/b:c?')).toBe('a-b-c-');
    expect(sanitizeFilename('Plan: Q3 <draft>')).toBe('Plan- Q3 -draft-');
  });
  it('collapses whitespace and trims', () => {
    expect(sanitizeFilename('  My   Notes  ')).toBe('My Notes');
  });
  it('falls back to untitled when nothing usable remains', () => {
    expect(sanitizeFilename('   ')).toBe('untitled');
    expect(sanitizeFilename('...')).toBe('untitled');
  });
});

describe('tildify', () => {
  const home = '/Users/h';
  it('replaces the home prefix with ~', () => {
    expect(tildify('/Users/h/notes/a.md', home)).toBe('~/notes/a.md');
    expect(tildify('/Users/h', home)).toBe('~');
  });
  it('leaves paths outside home untouched', () => {
    expect(tildify('/tmp/a.md', home)).toBe('/tmp/a.md');
    expect(tildify('/Users/hannah/a.md', home)).toBe('/Users/hannah/a.md');
  });
});

describe('resolveImagePath', () => {
  const doc = '/home/u/notes/readme.md';

  it('leaves remote and data sources untouched', () => {
    expect(resolveImagePath(doc, 'https://x/y.png')).toBeNull();
    expect(resolveImagePath(doc, 'data:image/png;base64,AAAA')).toBeNull();
    expect(resolveImagePath(doc, '')).toBeNull();
  });
  it('resolves relative paths against the document directory', () => {
    expect(resolveImagePath(doc, './pic.png')).toBe('/home/u/notes/pic.png');
    expect(resolveImagePath(doc, 'img/pic.png')).toBe('/home/u/notes/img/pic.png');
  });
  it('keeps absolute paths as-is', () => {
    expect(resolveImagePath(doc, '/abs/pic.png')).toBe('/abs/pic.png');
  });
  it('uses backslash separators for windows documents', () => {
    expect(resolveImagePath('C:\\docs\\a.md', 'img/p.png')).toBe('C:\\docs\\img\\p.png');
    expect(resolveImagePath('C:\\docs\\a.md', 'D:\\x\\p.png')).toBe('D:\\x\\p.png');
  });
});
