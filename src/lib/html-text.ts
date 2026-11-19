import { isHtml, sanitizeHtml } from './sanitize-html';

const BLOCK_TAGS = /<\/?(?:p|div|h[1-6]|li|ul|ol|tr|td|th|table|thead|tbody|blockquote|br)\b[^>]*>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** Sanitizes a rich-text field on the server; plain text is returned unchanged. */
export function sanitizeRichField(value: string): string {
  return isHtml(value) ? sanitizeHtml(value) : value;
}

/**
 * Visible wording of a field. Plain text is returned as-is. For HTML, tags are removed:
 * block boundaries become a space, inline tags (bold, italic, span, link) vanish so a word is never split.
 */
export function plainTextOf(value: string): string {
  if (!isHtml(value)) return value;
  return decodeEntities(value.replace(BLOCK_TAGS, ' ').replace(/<[^>]+>/g, ''));
}

/**
 * Text of a field with formatting removed: tags, line breaks and runs of whitespace (including non-breaking spaces)
 * do not count. Punctuation, case and every other character are kept.
 */
export function normalizeWording(value: string): string {
  return plainTextOf(value).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** The words of a field: letters and digits only, lower-case. Punctuation, spacing, case and formatting do not count. */
export function wordsOf(value: string): string[] {
  return plainTextOf(value).normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/**
 * The publishing gate: true when both fields contain exactly the same words in the same order. A different, added,
 * removed or split word (or number) is a difference; punctuation, case and formatting are not.
 */
export function sameWording(a: string, b: string): boolean {
  const x = wordsOf(a);
  const y = wordsOf(b);
  return x.length === y.length && x.every((word, i) => word === y[i]);
}

export interface WordingDifference {
  /** Position (0-based) of the first differing character in the normalized wording. */
  index: number;
  /** Short excerpt of V1 around the difference, invisible characters shown as [U+XXXX]. */
  v1: string;
  /** Short excerpt of V2 around the same place. */
  v2: string;
}

const INVISIBLE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function show(value: string): string {
  return value.replace(INVISIBLE, (c) => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
}

/** Null when the wording is identical; otherwise where and how the two fields first differ. */
export function findWordingDifference(a: string, b: string): WordingDifference | null {
  const x = normalizeWording(a);
  const y = normalizeWording(b);
  if (x === y) return null;
  const limit = Math.min(x.length, y.length);
  let index = 0;
  while (index < limit && x[index] === y[index]) index += 1;
  const from = Math.max(0, index - 30);
  const to = index + 30;
  const excerpt = (value: string) => `${from > 0 ? '…' : ''}${show(value.slice(from, to))}${to < value.length ? '…' : ''}`;
  return { index, v1: excerpt(x), v2: excerpt(y) };
}

export type WordingLevel = 'same' | 'punctuation' | 'words';

export interface WordingComparison {
  /**
   * same: identical text (formatting aside).
   * punctuation: same words, but punctuation, case or spacing differ: a warning the admin may ignore.
   * words: the words differ: blocks saving and publishing.
   */
  level: WordingLevel;
  difference: WordingDifference | null;
}

export function compareWording(a: string, b: string): WordingComparison {
  const difference = findWordingDifference(a, b);
  if (!difference) return { level: 'same', difference: null };
  return { level: sameWording(a, b) ? 'punctuation' : 'words', difference };
}
