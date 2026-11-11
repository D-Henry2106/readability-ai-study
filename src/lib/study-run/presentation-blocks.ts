import { accessibleVisualBlocks } from '@/lib/experiment/presentation';
import { StudyRunError } from './errors';
import type { PresentationEmphasisSpan } from '@/types/presentation-profile';

export interface V2InlineSegment {
  start: number;
  end: number;
  text: string;
  emphasized: boolean;
}

export interface V2VisualBlock {
  index: number;
  start: number;
  end: number;
  text: string;
  segments: V2InlineSegment[];
}

export interface RenderedPresentationV1 {
  variant: 'V1';
  className: 'experimental-text reader-v1';
  textContent: string;
  boldSegments: string[];
  html: string;
}

export interface RenderedPresentationV2 {
  variant: 'V2';
  className: 'experimental-text reader-v2';
  blocks: V2VisualBlock[];
  textContent: string;
  boldSegments: string[];
  html: string;
}

export type EmphasisValidationResult =
  | { ok: true; spans: PresentationEmphasisSpan[] }
  | { ok: false; code: string; details: string[] };

function isSurrogateSplit(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const prev = text.charCodeAt(offset - 1);
  const curr = text.charCodeAt(offset);
  return prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff;
}

/**
 * Validates manual emphasis spans against `rawContent` (architecture §5, §6.6, AC-12, AC-13).
 * Never selects or suggests spans automatically. Empty array is valid (V2 without bold text).
 */
export function validateEmphasisSpans(
  rawContent: string,
  spans: readonly PresentationEmphasisSpan[]
): EmphasisValidationResult {
  if (!Array.isArray(spans)) {
    return { ok: false, code: 'PRESENTATION_EMPHASIS_INVALID', details: ['emphasis must be an array'] };
  }
  for (let i = 0; i < spans.length; i += 1) {
    const s = spans[i];
    if (
      !s ||
      typeof s.start !== 'number' ||
      typeof s.end !== 'number' ||
      !Number.isInteger(s.start) ||
      !Number.isInteger(s.end) ||
      s.start < 0 ||
      s.end <= s.start ||
      s.end > rawContent.length ||
      isSurrogateSplit(rawContent, s.start) ||
      isSurrogateSplit(rawContent, s.end)
    ) {
      return {
        ok: false,
        code: 'PRESENTATION_EMPHASIS_OFFSET_OUT_OF_RANGE',
        details: [`span[${i}]: [${s?.start},${s?.end}) outside [0,${rawContent.length}]`]
      };
    }
    const expected = rawContent.slice(s.start, s.end);
    if (typeof s.text !== 'string' || s.text !== expected) {
      return {
        ok: false,
        code: 'PRESENTATION_EMPHASIS_TEXT_MISMATCH',
        details: [`span[${i}]: [${s.start},${s.end}) does not match rawContent slice`]
      };
    }
    if (expected.trim().length === 0) {
      return {
        ok: false,
        code: 'PRESENTATION_EMPHASIS_BLANK_SPAN',
        details: [`span[${i}]: [${s.start},${s.end}) is whitespace only`]
      };
    }
  }

  const sorted = spans
    .map((s) => ({ start: s.start, end: s.end, text: s.text }))
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.start < prev.end) {
      return {
        ok: false,
        code: 'PRESENTATION_EMPHASIS_OVERLAP',
        details: [`overlap:[${prev.start},${prev.end})&[${curr.start},${curr.end})`]
      };
    }
  }

  return { ok: true, spans: sorted };
}

/**
 * Partitions `rawContent` into visual blocks and inline segments for V2.
 * Joining all segment texts across all blocks reproduces `rawContent` character-for-character.
 */
export function buildV2VisualBlocks(
  rawContent: string,
  options: { emphasis?: readonly PresentationEmphasisSpan[]; sentencesPerBlock?: number } = {}
): V2VisualBlock[] {
  const check = validateEmphasisSpans(rawContent, options.emphasis ?? []);
  if (!check.ok) throw new StudyRunError(check.code, 400, check.details);

  const rawBlocks = accessibleVisualBlocks(rawContent, options.sentencesPerBlock ?? 2);
  const spans = check.spans;
  const blocks: V2VisualBlock[] = [];
  let cursor = 0;

  for (let index = 0; index < rawBlocks.length; index += 1) {
    const text = rawBlocks[index];
    const blockStart = cursor;
    const blockEnd = blockStart + text.length;
    cursor = blockEnd;

    const segments: V2InlineSegment[] = [];
    let pos = blockStart;

    for (const span of spans) {
      if (span.end <= blockStart) continue;
      if (span.start >= blockEnd) break;
      const segStart = Math.max(span.start, blockStart);
      const segEnd = Math.min(span.end, blockEnd);
      if (segStart > pos) {
        segments.push({ start: pos, end: segStart, text: rawContent.slice(pos, segStart), emphasized: false });
      }
      segments.push({ start: segStart, end: segEnd, text: rawContent.slice(segStart, segEnd), emphasized: true });
      pos = segEnd;
    }

    if (pos < blockEnd || segments.length === 0) {
      segments.push({ start: pos, end: blockEnd, text: rawContent.slice(pos, blockEnd), emphasized: false });
    }

    blocks.push({ index, start: blockStart, end: blockEnd, text, segments });
  }

  return blocks;
}
