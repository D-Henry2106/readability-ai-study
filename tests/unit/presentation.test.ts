import { describe, expect, it } from 'vitest';
import { accessibleVisualBlocks, hasExactAccessiblePresentationIntegrity, presentationForRound } from '@/lib/experiment/presentation';

describe('counterbalanced presentation order', () => {
  it('Group A is V1 then V2', () => {
    expect(presentationForRound('A', 1)).toBe('V1');
    expect(presentationForRound('A', 2)).toBe('V2');
  });

  it('Group B is V2 then V1', () => {
    expect(presentationForRound('B', 1)).toBe('V2');
    expect(presentationForRound('B', 2)).toBe('V1');
  });
});

describe('accessible V2 visual grouping', () => {
  it('partitions long text without changing any source characters', () => {
    const source = 'Sentence one. Sentence two. Sentence three! Sentence four? Final sentence.';
    const blocks = accessibleVisualBlocks(source);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join('')).toBe(source);
    expect(hasExactAccessiblePresentationIntegrity(source)).toBe(true);
  });

  it('preserves whitespace exactly across visual block boundaries', () => {
    const source = 'One. Two.  Three.\nFour.';
    expect(accessibleVisualBlocks(source).join('')).toBe(source);
  });
});
