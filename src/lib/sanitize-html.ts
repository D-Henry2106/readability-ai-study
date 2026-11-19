/**
 * Allowlist-based HTML sanitizer for research study rich text.
 * Strips script tags, style tags, iframes, event handlers, and unauthorized markup.
 */

export const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ol',
  'ul',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'br',
  'span',
  'div'
]);

const VOID_TAGS = new Set(['br']);

const DANGEROUS_CONTENT_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'form'
];

function decodeEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '')
    .replace(/&newline;/gi, '');
}

function extractSafeHref(rawAttrs: string): string | null {
  const match = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawAttrs);
  if (!match) return null;
  const rawHref = match[1] ?? match[2] ?? match[3] ?? '';
  const decoded = decodeEntities(rawHref);
  const cleaned = decoded.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, '');
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return null;
  }
  return rawHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitizes an HTML string against the safe tag allowlist.
 * Removes dangerous tags along with their inner contents, strips any unallowed attributes,
 * and ensures only safe href attributes on <a> tags are kept.
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let sanitized = html;

  // Remove comments
  sanitized = sanitized.replace(/<!--[\s\S]*?(-->|$)/g, '');

  // Strip broken nested opening tags like <scr<script>
  sanitized = sanitized.replace(/<[a-zA-Z0-9]+(?=<)/g, '');

  // Strip dangerous tags and their content repeatedly to defeat nested bypasses
  let prev: string;
  do {
    prev = sanitized;
    for (const tag of DANGEROUS_CONTENT_TAGS) {
      const regex = new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}>|$)`, 'gi');
      sanitized = sanitized.replace(regex, '');
    }
  } while (sanitized !== prev);

  // Process all remaining HTML tags
  const tagRegex = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  sanitized = sanitized.replace(tagRegex, (match, rawTagName: string, rawAttrs: string) => {
    const tagName = rawTagName.toLowerCase();
    const isClosing = match.startsWith('</');

    if (!ALLOWED_TAGS.has(tagName)) {
      return '';
    }

    if (isClosing) {
      if (VOID_TAGS.has(tagName)) return '';
      return `</${tagName}>`;
    }

    if (VOID_TAGS.has(tagName)) {
      return `<${tagName} />`;
    }

    if (tagName === 'a') {
      const href = extractSafeHref(rawAttrs);
      if (href) {
        return `<a href="${href}">`;
      }
      return '<a>';
    }

    // For all other allowed tags, strip all attributes (including on*, style, class, id, etc.)
    return `<${tagName}>`;
  });

  return sanitized.trim();
}

/**
 * Checks whether a string contains any recognized HTML tags from the allowlist.
 */
export function isHtml(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  return /<(?:p|h[1-6]|strong|b|em|i|u|ol|ul|li|blockquote|table|thead|tbody|tr|th|td|a|br|span|div)(?:[\s/>]|$)/i.test(
    value
  );
}

/**
 * Splits sanitized HTML into top-level visual blocks for accessible presentation.
 */
export function splitHtmlIntoBlocks(html: string): string[] {
  if (!html || !html.trim()) return [''];
  const blockRegex = /<(p|h[1-6]|blockquote|div|ul|ol|table)[\s\S]*?<\/\1>|<(hr|br)\s*\/?>/gi;
  const blocks: string[] = [];
  let lastIndex = 0;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const text = html.slice(lastIndex, match.index).trim();
      if (text) blocks.push(text);
    }
    blocks.push(match[0]);
    lastIndex = blockRegex.lastIndex;
  }
  if (lastIndex < html.length) {
    const text = html.slice(lastIndex).trim();
    if (text) blocks.push(text);
  }
  return blocks.length > 0 ? blocks : [html];
}

/**
 * Handles clipboard paste data, returning sanitized HTML if available, or plain text fallback.
 */
export function handlePasteContent(clipboard: {
  html?: string | null;
  text?: string | null;
}): { type: 'html' | 'text'; content: string } {
  if (clipboard.html && clipboard.html.trim()) {
    const sanitized = sanitizeHtml(clipboard.html);
    if (sanitized) {
      return { type: 'html', content: sanitized };
    }
  }
  return {
    type: 'text',
    content: clipboard.text ?? ''
  };
}
