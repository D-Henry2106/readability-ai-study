import { describe, expect, it } from 'vitest';
import { contentHash, countWords, normalizeExperimentalText, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
describe('content integrity', () => {
  it('normalizes whitespace without changing lexical tokens', () => expect(normalizeExperimentalText('Hello\n  world')).toBe('Hello world'));
  it('detects lexical mismatch', () => expect(verifyLexicalIntegrity('same words', 'same changed words')).toBe(false));
  it('returns a stable hash and word count', () => { expect(contentHash('a b')).toHaveLength(64); expect(countWords(' a  b ')).toBe(2); });
});
