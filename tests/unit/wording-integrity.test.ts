import { describe, expect, it } from 'vitest';
import { compareWording, plainTextOf, sameWording, sanitizeRichField } from '@/lib/html-text';
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

describe('wording gate: words must match; punctuation and case only warn', () => {
  const v1 = 'Mèo ăn cá, rồi ngủ. Chó chạy nhanh!';

  it('passes when only the formatting differs', () => {
    expect(compareWording(v1, '<h2>Mèo ăn cá, rồi ngủ.</h2>\n<p>Chó   chạy&nbsp;nhanh!</p>').level).toBe('same');
    expect(compareWording(v1, 'Mèo ăn cá,\nrồi ngủ.\n\nChó chạy nhanh!').level).toBe('same');
    expect(compareWording(v1, '<p>Mèo ăn cá, <em>rồi</em> ngủ.<br>Chó chạy nhanh!</p>').level).toBe('same');
  });

  it('only warns (never blocks) when punctuation, case, spacing or invisible characters differ', () => {
    for (const v2 of [
      '<p>Mèo ăn cá rồi ngủ. Chó chạy nhanh!</p>',
      '<p>Mèo ăn cá, rồi ngủ, Chó chạy nhanh.</p>',
      '<p>Mèo ăn cá , rồi ngủ. Chó chạy nhanh!</p>',
      '<p>MÈO ăn cá, rồi ngủ. Chó chạy nhanh!</p>',
      '<p>Mèo ăn cá, rồi ngủ.\u200B Chó chạy nhanh!</p>'
    ]) {
      expect(sameWording(v1, v2)).toBe(true);
      expect(compareWording(v1, v2).level).toBe('punctuation');
    }
    expect(compareWording('It\'s fine - ok', '<p>It\u2019s fine \u2013 ok</p>').level).toBe('punctuation');
  });

  it('blocks when a word or a number is added, removed, changed or split', () => {
    for (const v2 of [
      '<p>Mèo ăn cá, rồi ngủ. Chó chạy chậm!</p>',
      '<p>Mèo ăn cá, rồi ngủ.</p>',
      '<p>Mèo ăn cá, rồi ngủ. Chó chạy rất nhanh!</p>',
      '<p>Mèo ăn cá, rồi ngủ. Chó cha</p><p>y nhanh!</p>'
    ]) {
      expect(sameWording(v1, v2)).toBe(false);
      expect(compareWording(v1, v2).level).toBe('words');
    }
    expect(sameWording('Có 12 con', '<p>Có 13 con</p>')).toBe(false);
  });

  it('treats composed and decomposed Vietnamese letters as the same', () => {
    expect(compareWording('\u00EA', 'e\u0302').level).toBe('same');
    expect(compareWording('Việt Nam', '<p>Vie\u0323\u0302t Nam</p>').level).toBe('same');
  });

  it('does not split a word at an inline tag, but does at a block boundary', () => {
    expect(sameWording('words here', '<p>wor<strong>ds</strong> here</p>')).toBe(true);
    expect(sameWording('words here', '<p>wor</p><p>ds here</p>')).toBe(false);
    expect(sameWording('words here', '<p>words</p><p>here</p>')).toBe(true);
  });

  it('shows where the first difference is, with invisible characters spelled out', () => {
    expect(compareWording(v1, v1).difference).toBeNull();
    const comma = compareWording(v1, '<p>Mèo ăn cá rồi ngủ. Chó chạy nhanh!</p>').difference;
    expect(comma!.index).toBe('Mèo ăn cá'.length);
    expect(comma!.v1).toContain('cá, rồi');
    expect(comma!.v2).toContain('cá rồi');
    const hidden = compareWording('Chó chạy nhanh', '<p>Chó chạy\u200B nhanh</p>').difference;
    expect(`${hidden!.v1} ${hidden!.v2}`).toContain('[U+200B]');
  });
});
