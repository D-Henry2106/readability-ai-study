import { ObjectId } from 'mongodb';
import { contentHash, countWords, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
import { accessibleVisualBlocks, hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import { sanitizeRichField, sameWording } from '@/lib/html-text';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { StudyPhase } from '@/types/research';

export class ContentService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async createDraft(input: { topicLabel: string; rawContent: string; phase: StudyPhase; v2Content?: string | null }) {
    const revision = await this.repo.nextContentRevision(input.phase);
    const rawContent = sanitizeRichField(input.rawContent);
    const v2Content = input.v2Content ? sanitizeRichField(input.v2Content) : (input.v2Content ?? null);
    return this.repo.insertContent({
      revision,
      topicLabel: input.topicLabel,
      rawContent,
      v2Content,
      contentHash: contentHash(rawContent),
      wordCount: countWords(rawContent),
      status: 'DRAFT',
      locked: false,
      phase: input.phase,
      createdAt: new Date(),
      publishedAt: null
    });
  }

  async updateDraft(id: string, input: { topicLabel: string; rawContent: string; v2Content?: string | null }) {
    const rawContent = sanitizeRichField(input.rawContent);
    return this.repo.updateDraftContent(new ObjectId(id), {
      topicLabel: input.topicLabel,
      rawContent,
      ...(input.v2Content !== undefined ? { v2Content: input.v2Content ? sanitizeRichField(input.v2Content) : input.v2Content } : {}),
      contentHash: contentHash(rawContent),
      wordCount: countWords(rawContent)
    });
  }

  async publish(id: string) {
    const content = await this.repo.getContentById(new ObjectId(id));
    if (!content) throw new Error('CONTENT_NOT_FOUND');
    if (content.v2Content) {
      if (!content.v2Content.trim()) throw new Error('V2_CONTENT_EMPTY');
      if (!sameWording(content.rawContent, content.v2Content)) throw new Error('LEXICAL_INTEGRITY_FAILED');
    } else {
      const v2Text = accessibleVisualBlocks(content.rawContent).join('');
      if (!hasExactAccessiblePresentationIntegrity(content.rawContent) || !verifyLexicalIntegrity(content.rawContent, v2Text)) {
        throw new Error('LEXICAL_INTEGRITY_FAILED');
      }
    }
    return this.repo.publishContent(new ObjectId(id));
  }
}
