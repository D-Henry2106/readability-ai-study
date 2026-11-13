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

function normalize(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** True when two fields show exactly the same wording (formatting ignored). */
export function sameWording(a: string, b: string): boolean {
  return normalize(plainTextOf(a)) === normalize(plainTextOf(b));
}
