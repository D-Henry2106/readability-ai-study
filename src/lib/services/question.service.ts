import { ObjectId } from 'mongodb';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { questionSetDraftSchema, questionSetSchema } from '@/lib/validation/schemas';
import type { QuestionItem, StudyPhase } from '@/types/research';

export class QuestionService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async createDraft(input: { label: string; phase: StudyPhase; questions: QuestionItem[] }) {
    // A draft may be incomplete (0-15 questions); `publish` enforces the full 15-question contract.
    questionSetDraftSchema.parse(input);
    const revision = await this.repo.nextQuestionRevision(input.phase);
    return this.repo.insertQuestionSet({
      revision,
      label: input.label,
      questions: input.questions,
      status: 'DRAFT',
      locked: false,
      phase: input.phase,
      createdAt: new Date(),
      publishedAt: null
    });
  }

  async updateDraft(id: string, input: { label: string; phase: StudyPhase; questions: QuestionItem[] }) {
    questionSetDraftSchema.parse(input);
    const updated = await this.repo.updateDraftQuestionSet(new ObjectId(id), { label: input.label, questions: input.questions });
    if (updated) return updated;
    // Fallback: if already published or locked, allow update directly
    return this.repo.updateQuestionSet(new ObjectId(id), { label: input.label, questions: input.questions });
  }

  /**
   * Updates question set directly without locking restrictions.
   * If existing participant attempts exist, requires explicit confirmation or warns.
   */
  async update(id: string, input: { label: string; phase: StudyPhase; questions: QuestionItem[] }, options?: { force?: boolean }) {
    questionSetDraftSchema.parse(input);
    const objId = new ObjectId(id);
    const hasAttempts = await this.repo.hasTestAttemptsForQuestionSet(objId);
    if (hasAttempts && !options?.force) {
      const err = new Error('QUESTION_SET_HAS_ATTEMPTS');
      (err as unknown as { code: string }).code = 'QUESTION_SET_HAS_ATTEMPTS';
      throw err;
    }
    return this.repo.updateQuestionSet(objId, { label: input.label, questions: input.questions });
  }

  async hasAttempts(id: string): Promise<boolean> {
    return this.repo.hasTestAttemptsForQuestionSet(new ObjectId(id));
  }

  async deleteOrArchive(id: string, actorUsername: string) {
    return this.repo.deleteOrArchiveQuestionSet(new ObjectId(id), actorUsername, new Date());
  }

  /** Hides the set from new selections. Nothing is edited or deleted; existing data that uses it is unaffected. */
  async archive(id: string, actorUsername: string) {
    return this.repo.archiveQuestionSet(new ObjectId(id), actorUsername, new Date());
  }

  async publish(id: string) {
    const set = await this.repo.getQuestionSetById(new ObjectId(id));
    if (!set) throw new Error('QUESTION_SET_NOT_FOUND');
    questionSetSchema.parse({ label: set.label, phase: set.phase, questions: set.questions });
    return this.repo.publishQuestionSet(new ObjectId(id));
  }
}
