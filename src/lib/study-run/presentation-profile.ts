import { contentHash, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
import { hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import {
  buildV2VisualBlocks,
  validateEmphasisSpans,
  type EmphasisValidationResult,
  type RenderedPresentationV1,
  type RenderedPresentationV2,
  type V2InlineSegment,
  type V2VisualBlock
} from './presentation-blocks';
import type { PresentationEmphasisSpan } from '@/types/presentation-profile';

export { buildV2VisualBlocks, validateEmphasisSpans };
export type { EmphasisValidationResult, RenderedPresentationV1, RenderedPresentationV2, V2InlineSegment, V2VisualBlock };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeHtml(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** Extracts the exact DOM `textContent` from rendered V1/V2 HTML markup. */
export function extractTextContentFromHtml(html: string): string {
  return unescapeHtml(html.replace(/<\/?[a-zA-Z0-9-]+(?:\s+[^>]*)?>/g, ''));
}

/** Deterministic V1 renderer: identical to the existing V1 reader (AC-11). */
export function renderPresentationV1(rawContent: string): RenderedPresentationV1 {
  const html = `<div class="experimental-text reader-v1">${escapeHtml(rawContent)}</div>`;
  return {
    variant: 'V1',
    className: 'experimental-text reader-v1',
    textContent: rawContent,
    boldSegments: [],
    html
  };
}

/**
 * Deterministic V2 renderer (architecture §6.6, AC-11..AC-13).
 * Wraps only the Admin-selected `[start, end)` ranges in `<strong>`; adds no headings, labels or characters.
 */
export function renderPresentationV2(
  rawContent: string,
  options: { emphasis?: readonly PresentationEmphasisSpan[]; sentencesPerBlock?: number } = {}
): RenderedPresentationV2 {
  const blocks = buildV2VisualBlocks(rawContent, options);
  const blockHtml = blocks
    .map((block) => {
      const inner = block.segments
        .map((seg) => (seg.emphasized ? `<strong>${escapeHtml(seg.text)}</strong>` : escapeHtml(seg.text)))
        .join('');
      return `<span class="accessible-block">${inner}</span>`;
    })
    .join('');
  const html = `<div class="experimental-text reader-v2">${blockHtml}</div>`;
  const textContent = blocks.map((b) => b.segments.map((s) => s.text).join('')).join('');
  const boldSegments = blocks.flatMap((b) => b.segments.filter((s) => s.emphasized).map((s) => s.text));
  return {
    variant: 'V2',
    className: 'experimental-text reader-v2',
    blocks,
    textContent,
    boldSegments,
    html
  };
}

/**
 * Checks that CSS rules targeting `.reader-v1`, `.reader-v2`, `.accessible-block` or `.experimental-text`
 * never inject characters via `content:` or `::before`/`::after` pseudo-elements (AC-12).
 */
export function hasForbiddenReaderCssContent(cssSource: string): boolean {
  const stripped = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(stripped)) !== null) {
    const selector = match[1];
    const body = match[2];
    if (!/\.(reader-v1|reader-v2|accessible-block|experimental-text)\b/.test(selector)) continue;
    if (/::?(before|after)\b/i.test(selector) || /\bcontent\s*:/i.test(body)) return true;
  }
  return false;
}

/** Full integrity verification for V1/V2 rendering (architecture §6.6, AC-11, AC-12, AC-13). */
export function verifyPresentationV2Integrity(
  rawContent: string,
  options: { emphasis?: readonly PresentationEmphasisSpan[]; sentencesPerBlock?: number } = {}
): {
  ok: boolean;
  v1: RenderedPresentationV1;
  v2: RenderedPresentationV2;
  contentHash: string;
  emphasisCount: number;
  problems: string[];
} {
  const problems: string[] = [];
  const v1 = renderPresentationV1(rawContent);
  const v2 = renderPresentationV2(rawContent, options);
  const emphasis = options.emphasis ?? [];

  if (!hasExactAccessiblePresentationIntegrity(rawContent)) problems.push('BLOCK_PARTITION_MISMATCH');
  if (v1.textContent !== rawContent || extractTextContentFromHtml(v1.html) !== rawContent) problems.push('V1_TEXT_CONTENT_MISMATCH');
  if (v2.textContent !== rawContent || extractTextContentFromHtml(v2.html) !== rawContent) problems.push('V2_TEXT_CONTENT_MISMATCH');
  if (!verifyLexicalIntegrity(rawContent, v2.textContent)) problems.push('LEXICAL_INTEGRITY_FAILED');

  // Only <div class="experimental-text reader-v2">, <span class="accessible-block">, and <strong> are permitted.
  const tags = [...v2.html.matchAll(/<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*)?>/g)].map((m) => m[1].toLowerCase());
  if (tags.some((t) => t !== 'div' && t !== 'span' && t !== 'strong')) problems.push('FORBIDDEN_HTML_TAG');
  if (emphasis.length === 0 && (v2.boldSegments.length > 0 || v2.html.includes('<strong'))) {
    problems.push('UNEXPECTED_EMPHASIS_WHEN_EMPTY');
  }

  return {
    ok: problems.length === 0,
    v1,
    v2,
    contentHash: contentHash(rawContent),
    emphasisCount: emphasis.length,
    problems
  };
}
