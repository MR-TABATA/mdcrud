import { describe, it, expect } from 'vitest';
import { slugify, firstHeadingTitle } from './markdown';

describe('slugify', () => {
  it('lowercases and hyphenates whitespace', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Trim  Me  ')).toBe('trim-me');
  });
  it('drops punctuation but keeps unicode letters/numbers', () => {
    expect(slugify('Section B!')).toBe('section-b');
    expect(slugify('日本語 見出し 2')).toBe('日本語-見出し-2');
  });
});

describe('firstHeadingTitle', () => {
  it('returns the first heading text, ignoring leading body', () => {
    expect(firstHeadingTitle('intro line\n\n## My Notes\n\n# Later')).toBe('My Notes');
  });
  it('strips trailing closing hashes', () => {
    expect(firstHeadingTitle('# Title #')).toBe('Title');
  });
  it('returns null when there is no heading', () => {
    expect(firstHeadingTitle('just a paragraph\n- a list')).toBeNull();
  });
});
