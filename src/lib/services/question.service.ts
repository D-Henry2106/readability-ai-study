import { ObjectId } from 'mongodb';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { questionSetSchema } from '@/lib/validation/schemas';
import type { QuestionItem, StudyPhase } from '@/types/research';

export class QuestionService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async createDraft(input: { label: string; phase: StudyPhase; questions: QuestionItem[] }) {
    questionSetSchema.parse(input);
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
    questionSetSchema.parse(input);
    return this.repo.updateDraftQuestionSet(new ObjectId(id), { label: input.label, questions: input.questions });
  }

  async publish(id: string) {
    const set = await this.repo.getQuestionSetById(new ObjectId(id));
    if (!set) throw new Error('QUESTION_SET_NOT_FOUND');
    questionSetSchema.parse({ label: set.label, phase: set.phase, questions: set.questions });
    return this.repo.publishQuestionSet(new ObjectId(id));
  }
}
