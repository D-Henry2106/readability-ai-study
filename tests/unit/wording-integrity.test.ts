import { describe, expect, it } from 'vitest';
import { plainTextOf, sameWording, sanitizeRichField } from '@/lib/html-text';
import { countWords } from '@/lib/experiment/content-integrity';

describe('V1/V2 wording integrity (formatting may differ, wording may not)', () => {
  it('treats plain text and formatted HTML with the same words as identical', () => {
    expect(sameWording('A first. B second.', '<p>A first.</p><p><strong>B</strong> second.</p>')).toBe(true);
    expect(sameWording('Tom & Jerry', '<p>Tom &amp; Jerry</p>')).toBe(true);
    expect(sameWording('a b', '<p>a&nbsp;b</p>')).toBe(true);
  });

  it('rejects any changed, added or removed word', () => {
    expect(sameWording('A first. B second.', '<p>A first.</p><p>B third.</p>')).toBe(false);
    expect(sameWording('A first.', '<p>A first. Extra.</p>')).toBe(false);
    expect(sameWording('A first. B second.', '<p>A first.</p>')).toBe(false);
  });

  it('never splits a word at an inline tag', () => {
    expect(plainTextOf('<p>wor<strong>ds</strong></p>').trim()).toBe('words');
    expect(countWords('<p>wor<strong>ds</strong> here</p>')).toBe(2);
  });

  it('counts block boundaries and entities correctly', () => {
    expect(countWords('<p>one</p><p>two</p>')).toBe(2);
    expect(countWords('<p>one&nbsp;two</p>')).toBe(2);
  });

  it('leaves plain text untouched, including a literal less-than sign', () => {
    expect(plainTextOf('a < b and c > d')).toBe('a < b and c > d');
    expect(countWords('a < b')).toBe(3);
  });

  it('sanitizes rich fields on the server side helper but not plain text', () => {
    expect(sanitizeRichField('<script>x()</script><p onclick="x()">Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitizeRichField('plain text')).toBe('plain text');
  });
});
