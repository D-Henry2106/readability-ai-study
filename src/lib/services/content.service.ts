import { ObjectId } from 'mongodb';
import { contentHash, countWords, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
import { accessibleVisualBlocks, hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { StudyPhase } from '@/types/research';

export class ContentService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async createDraft(input: { topicLabel: string; rawContent: string; phase: StudyPhase }) {
    const revision = await this.repo.nextContentRevision(input.phase);
    return this.repo.insertContent({
      revision,
      topicLabel: input.topicLabel,
      rawContent: input.rawContent,
      contentHash: contentHash(input.rawContent),
      wordCount: countWords(input.rawContent),
      status: 'DRAFT',
      locked: false,
      phase: input.phase,
      createdAt: new Date(),
      publishedAt: null
    });
  }

  async updateDraft(id: string, input: { topicLabel: string; rawContent: string }) {
    return this.repo.updateDraftContent(new ObjectId(id), {
      topicLabel: input.topicLabel,
      rawContent: input.rawContent,
      contentHash: contentHash(input.rawContent),
      wordCount: countWords(input.rawContent)
    });
  }

  async publish(id: string) {
    const content = await this.repo.getContentById(new ObjectId(id));
    if (!content) throw new Error('CONTENT_NOT_FOUND');
    const v2Text = accessibleVisualBlocks(content.rawContent).join('');
    if (!hasExactAccessiblePresentationIntegrity(content.rawContent) || !verifyLexicalIntegrity(content.rawContent, v2Text)) {
      throw new Error('LEXICAL_INTEGRITY_FAILED');
    }
    return this.repo.publishContent(new ObjectId(id));
  }
}
