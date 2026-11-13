import { describe, expect, it } from 'vitest';
import { handlePasteContent, isHtml, sanitizeHtml, splitHtmlIntoBlocks } from '@/lib/sanitize-html';

describe('Rich text sanitization and clipboard handling (Issue C)', () => {
  it('strips dangerous content and unauthorized tags/attributes', () => {
    // Strips script tags and inner contents
    expect(sanitizeHtml('<script>alert("xss")</script><p>Safe paragraph</p>')).toBe('<p>Safe paragraph</p>');

    // Strips style, iframe, object, embed, noscript
    expect(
      sanitizeHtml(
        '<style>body{display:none}</style><iframe></iframe><object></object><embed></embed><p>Content</p>'
      )
    ).toBe('<p>Content</p>');

    // Strips event handlers (onclick, onerror, onload, etc.)
    expect(sanitizeHtml('<p onclick="alert(1)" onmouseover="steal()">Hello</p>')).toBe('<p>Hello</p>');

    // Strips style attributes and class attributes from allowed tags
    expect(sanitizeHtml('<strong style="color:red" class="highlight">Bold text</strong>')).toBe(
      '<strong>Bold text</strong>'
    );

    // Strips javascript: in href
    expect(sanitizeHtml('<a href="javascript:alert(1)">Click here</a>')).toBe('<a>Click here</a>');

    // Strips data: in href
    expect(sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Click</a>')).toBe(
      '<a>Click</a>'
    );

    // Strips nested malicious patterns
    expect(sanitizeHtml('<scr<script>ipt>alert(1)</script>text')).toBe('text');
  });

  it('preserves all allowed safe HTML tags', () => {
    const input = [
      '<h1>Heading 1</h1>',
      '<h2>Heading 2</h2>',
      '<h3>Heading 3</h3>',
      '<h4>Heading 4</h4>',
      '<h5>Heading 5</h5>',
      '<h6>Heading 6</h6>',
      '<p>Paragraph with <strong>bold</strong>, <b>b</b>, <em>emphasis</em>, <i>i</i>, and <u>underline</u>.</p>',
      '<blockquote>A wise quote</blockquote>',
      '<ol><li>Item 1</li><li>Item 2</li></ol>',
      '<ul><li>Bullet A</li><li>Bullet B</li></ul>',
      '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
      '<a href="https://example.com/study">Link to study</a>',
      '<div><span>Inline span in div</span></div>',
      '<br />'
    ].join('\n');

    const sanitized = sanitizeHtml(input);

    expect(sanitized).toContain('<h1>Heading 1</h1>');
    expect(sanitized).toContain('<h2>Heading 2</h2>');
    expect(sanitized).toContain('<h3>Heading 3</h3>');
    expect(sanitized).toContain('<strong>bold</strong>');
    expect(sanitized).toContain('<blockquote>A wise quote</blockquote>');
    expect(sanitized).toContain('<ol><li>Item 1</li><li>Item 2</li></ol>');
    expect(sanitized).toContain('<ul><li>Bullet A</li><li>Bullet B</li></ul>');
    expect(sanitized).toContain('<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>');
    expect(sanitized).toContain('<a href="https://example.com/study">Link to study</a>');
    expect(sanitized).toContain('<br />');
  });

  it('preserves formatting when pasting HTML', () => {
    const pastedHtml = '<p>Formatted text with <strong>bold</strong> and <em>italic</em>.</p>';
    const result = handlePasteContent({
      html: pastedHtml,
      text: 'Formatted text with bold and italic.'
    });

    expect(result.type).toBe('html');
    expect(result.content).toBe('<p>Formatted text with <strong>bold</strong> and <em>italic</em>.</p>');
  });

  it('falls back to plain text when pasting without HTML', () => {
    const result = handlePasteContent({
      html: '',
      text: 'Just plain unformatted text from a text editor.'
    });

    expect(result.type).toBe('text');
    expect(result.content).toBe('Just plain unformatted text from a text editor.');
  });

  it('performs stable round-trip: save HTML → reload → same HTML', () => {
    const originalHtml = '<h2>Title</h2><p>Paragraph with <strong>bold</strong> and <a href="https://example.com">link</a>.</p>';
    const saved = sanitizeHtml(originalHtml);
    const reloaded = sanitizeHtml(saved);
    expect(reloaded).toBe(saved);
    expect(reloaded).toBe(originalHtml);
  });

  it('correctly splits HTML into top-level accessible blocks for V2', () => {
    const html = '<h2>Title</h2><p>First paragraph.</p><p>Second paragraph.</p>';
    const blocks = splitHtmlIntoBlocks(html);
    expect(blocks).toEqual(['<h2>Title</h2>', '<p>First paragraph.</p>', '<p>Second paragraph.</p>']);
  });

  it('identifies HTML vs plain text with isHtml', () => {
    expect(isHtml('<p>This is HTML</p>')).toBe(true);
    expect(isHtml('<strong>Bold</strong>')).toBe(true);
    expect(isHtml('This is plain text with no tags')).toBe(false);
    expect(isHtml('1 < 2 & 3 > 1')).toBe(false);
  });
});
