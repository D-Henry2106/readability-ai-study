import { ObjectId } from 'mongodb';
import { randomInt } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ContentService } from './content.service';
import { QuestionService } from './question.service';
import { contentHash, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
import { accessibleVisualBlocks, hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import { packageInputSchema, questionSetSchema } from '@/lib/validation/schemas';
import type { AssignmentMode, ContentPackageDoc, ExperimentConfigDoc, StudyPhase } from '@/types/research';

export function validatePresentation(raw: string): boolean {
  return hasExactAccessiblePresentationIntegrity(raw) && verifyLexicalIntegrity(raw, accessibleVisualBlocks(raw).join(''));
}

export function selectPackage<T extends { _id?: ObjectId }>(eligible: T[], mode: AssignmentMode, fixedId: string | null | undefined): T {
  if (!eligible.length) throw new Error('NO_ELIGIBLE_PACKAGE');
  if (mode === 'RANDOM') return eligible[randomInt(eligible.length)];
  const selected = fixedId ? eligible.find(p => p._id?.toHexString() === fixedId) : (eligible.length === 1 ? eligible[0] : undefined);
  if (!selected) throw new Error('FIXED_PACKAGE_REQUIRED');
  return selected;
}

export class PackageService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async checklist(pkg: ContentPackageDoc) {
    const [content, questions] = await Promise.all([this.repo.getContentById(pkg.contentRevisionId), this.repo.getQuestionSetById(pkg.questionSetId)]);
    const rules = [
      { code: 'METADATA', label: 'Mã, tiêu đề, chủ đề và phase', pass: !!pkg.code && !!pkg.title && !!pkg.topic && ['PILOT','MAIN'].includes(pkg.phase) },
      { code: 'RAW_CONTENT', label: 'Bài đọc và hash văn bản nguồn', pass: !!content && content.phase === pkg.phase && !!content.rawContent.trim() && content.contentHash === contentHash(content.rawContent) },
      { code: 'LEXICAL_INTEGRITY', label: 'Toàn vẹn ký tự V1/V2', pass: !!content && validatePresentation(content.rawContent) },
      { code: 'QUESTION_SET', label: 'Đủ 5 câu, 4 lựa chọn và 1 đáp án đúng', pass: !!questions && questions.phase === pkg.phase && questionSetSchema.safeParse({ phase: questions.phase, label: questions.label, questions: questions.questions }).success },
      { code: 'REVISION_LOCK', label: 'Các revision đã khóa khi xuất bản', pass: pkg.status === 'DRAFT' ? !!content && !!questions && !content.locked && !questions.locked : !!content?.locked && !!questions?.locked },
      { code: 'PUBLICATION', label: 'Trạng thái publication khớp', pass: pkg.status === 'DRAFT' ? !!content && !!questions && content.status === 'DRAFT' && questions.status === 'DRAFT' : !!content && !!questions && content.status === 'PUBLISHED' && questions.status === 'PUBLISHED' }
    ];
    return { saveDraft: pkg.status === 'DRAFT', publish: pkg.status === 'DRAFT' && rules.every(rule => rule.pass), startStudy: pkg.status === 'PUBLISHED' && pkg.enabled && rules.every(rule => rule.pass),
      checks: rules.map(({code,label,pass}) => ({code,label,status:pass ? 'PASS' : 'FAIL'})) };
  }

  async verifyPackage(pkg: ContentPackageDoc): Promise<string[]> {
    const problems: string[] = [];
    const [content, questions] = await Promise.all([this.repo.getContentById(pkg.contentRevisionId), this.repo.getQuestionSetById(pkg.questionSetId)]);
    if (!content || content.phase !== pkg.phase || !content.rawContent.trim() || content.contentHash !== contentHash(content.rawContent) || !validatePresentation(content.rawContent)) problems.push('INVALID_CONTENT');
    if (!questions || questions.phase !== pkg.phase || !questionSetSchema.safeParse({ phase: questions.phase, label: questions.label, questions: questions.questions }).success) problems.push('INVALID_QUESTIONS');
    if (!pkg.code || !pkg.title || !pkg.topic || !['PILOT', 'MAIN'].includes(pkg.phase)) problems.push('INVALID_METADATA');
    return problems;
  }

  async createDraft(payload: unknown): Promise<ObjectId> {
    const input = packageInputSchema.parse(payload);
    if (!validatePresentation(input.rawContent)) throw new Error('LEXICAL_INTEGRITY_FAILED');
    // Validate all fields BEFORE allocating revisions; a failed draft cannot publish.
    questionSetSchema.parse({ phase: input.phase, label: input.title, questions: input.questions });
    const code = input.code.toUpperCase();
    const revision = await this.repo.nextPackageRevision(code);
    const [contentId, questionSetId] = await Promise.all([
      new ContentService(this.repo).createDraft({ topicLabel: input.topic, rawContent: input.rawContent, phase: input.phase }),
      new QuestionService(this.repo).createDraft({ label: input.title, phase: input.phase, questions: input.questions })
    ]);
    const now = new Date();
    return this.repo.insertPackage({ code, title: input.title, topic: input.topic, description: input.description,
      phase: input.phase, contentRevisionId: contentId, questionSetId, revision, status: 'DRAFT', enabled: true,
      aiSource: input.aiSource ?? null, createdAt: now, updatedAt: now, publishedAt: null, archivedAt: null });
  }

  async updateDraft(id: string, payload: unknown): Promise<ContentPackageDoc> {
    const input = packageInputSchema.parse(payload);
    const pkg = await this.repo.getPackageById(new ObjectId(id));
    if (!pkg || pkg.status !== 'DRAFT') throw new Error('PACKAGE_NOT_EDITABLE');
    // Stable package code/phase guarantee no accidental cross-cohort relinking.
    if (input.code.toUpperCase() !== pkg.code || input.phase !== pkg.phase) throw new Error('PACKAGE_NOT_EDITABLE');
    if (!validatePresentation(input.rawContent)) throw new Error('LEXICAL_INTEGRITY_FAILED');
    questionSetSchema.parse({ phase: input.phase, label: input.title, questions: input.questions });
    const [content, questions] = await Promise.all([
      this.repo.getContentById(pkg.contentRevisionId), this.repo.getQuestionSetById(pkg.questionSetId)
    ]);
    if (content?.status !== 'DRAFT' || questions?.status !== 'DRAFT' || content.locked || questions.locked) throw new Error('PACKAGE_NOT_EDITABLE');
    const c = await new ContentService(this.repo).updateDraft(pkg.contentRevisionId.toHexString(), {topicLabel: input.topic, rawContent: input.rawContent});
    const q = await new QuestionService(this.repo).updateDraft(pkg.questionSetId.toHexString(), {label: input.title, phase: input.phase, questions: input.questions});
    if (!c || !q) throw new Error('PACKAGE_NOT_EDITABLE');
    const updated = await this.repo.updateDraftPackage(pkg._id!, {title: input.title, topic: input.topic,
      description: input.description, aiSource: input.aiSource ?? null});
    if (!updated) throw new Error('PACKAGE_NOT_EDITABLE');
    return updated;
  }

  async publish(id: string): Promise<ContentPackageDoc> {
    const pkg = await this.repo.getPackageById(new ObjectId(id));
    if (!pkg || pkg.status !== 'DRAFT') throw new Error('PACKAGE_NOT_EDITABLE');
    const issues = await this.verifyPackage(pkg);
    const config = await this.repo.getConfig();
    if (!config.informationText || !config.informationVersion || !config.consentText || !config.consentVersion ||
        !config.debriefText || !config.debriefVersion || !config.dataRightsText || !config.findingsText ||
        !config.minimumReadingSeconds) issues.push('PROTOCOL_NOT_READY');
    if (issues.length) throw new Error(`PACKAGE_INVALID:${issues.join(',')}`);
    // Each draft package owns its content and questions; published material is immutable.
    const content = await this.repo.getContentById(pkg.contentRevisionId);
    const questions = await this.repo.getQuestionSetById(pkg.questionSetId);
    if (!content || !questions) throw new Error('PACKAGE_INVALID');
    if (content.status !== 'PUBLISHED') await new ContentService(this.repo).publish(pkg.contentRevisionId.toHexString());
    if (questions.status !== 'PUBLISHED') await new QuestionService(this.repo).publish(pkg.questionSetId.toHexString());
    const published = await this.repo.publishPackage(new ObjectId(id));
    if (!published) throw new Error('PACKAGE_NOT_EDITABLE');
    return published;
  }

  async eligible(phase: StudyPhase) {
    const candidates = await this.repo.listEligiblePackages(phase);
    const checks = await Promise.all(candidates.map(async pkg => {
      const [content, q, errors] = await Promise.all([
        this.repo.getContentById(pkg.contentRevisionId),
        this.repo.getQuestionSetById(pkg.questionSetId),
        this.verifyPackage(pkg)
      ]);
      return errors.length === 0 && content?.status === 'PUBLISHED' && q?.status === 'PUBLISHED' ? pkg : null;
    }));
    return checks.filter((p): p is ContentPackageDoc => p !== null);
  }

  async choose(config: ExperimentConfigDoc) {
    if (config.phase === 'MAIN' && config.assignmentMode === 'RANDOM' && !config.mainRandomApproved) throw new Error('MAIN_RANDOM_NOT_APPROVED');
    const eligible = await this.eligible(config.phase);
    const mode = config.assignmentMode ?? 'FIXED';
    return { pkg: selectPackage(eligible, mode, config.fixedPackageId), mode };
  }
}
