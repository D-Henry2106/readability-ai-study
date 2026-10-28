import type { GroupCode, Presentation } from '@/types/research';

export function presentationForRound(group: GroupCode, roundNo: 1 | 2): Presentation {
  if (group === 'A') return roundNo === 1 ? 'V1' : 'V2';
  return roundNo === 1 ? 'V2' : 'V1';
}

/**
 * Partitions the exact source string into visual blocks for V2.
 * No characters are added, removed or substituted. Joining the blocks must
 * reproduce the original JavaScript string character-for-character.
 */
export function accessibleVisualBlocks(value: string, sentencesPerBlock = 2): string[] {
  if (!value) return [''];
  const blocks: string[] = [];
  let start = 0;
  let sentenceCount = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '.' && char !== '!' && char !== '?') continue;
    const next = value[index + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    sentenceCount += 1;
    if (sentenceCount < sentencesPerBlock) continue;

    let end = index + 1;
    while (end < value.length && /\s/.test(value[end])) end += 1;
    blocks.push(value.slice(start, end));
    start = end;
    sentenceCount = 0;
    index = Math.max(index, end - 1);
  }

  if (start < value.length) blocks.push(value.slice(start));
  return blocks.length > 0 ? blocks : [value];
}

export function hasExactAccessiblePresentationIntegrity(value: string): boolean {
  return accessibleVisualBlocks(value).join('') === value;
}
