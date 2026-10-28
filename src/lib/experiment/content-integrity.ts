import { createHash } from 'node:crypto';

export function normalizeExperimentalText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function contentHash(value: string): string {
  return createHash('sha256').update(normalizeExperimentalText(value), 'utf8').digest('hex');
}

export function countWords(value: string): number {
  const normalized = normalizeExperimentalText(value);
  return normalized ? normalized.split(' ').length : 0;
}

export function verifyLexicalIntegrity(v1Text: string, v2Text: string): boolean {
  return normalizeExperimentalText(v1Text) === normalizeExperimentalText(v2Text);
}
