import { ObjectId } from 'mongodb';
import { randomInt } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ContentService } from './content.service';
import { contentHash, verifyLexicalIntegrity } from '@/lib/experiment/content-integrity';
import { accessibleVisualBlocks, hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import { packageInputSchema } from '@/lib/validation/schemas';
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
    const content = await this.repo.getContentById(pkg.contentRevisionId);
    const hasV2Custom = !!content?.v2Content || !!pkg.v2Content;
    const rules = [
      { code: 'METADATA', label: 'Mã, tiêu đề, chủ đề và phase', pass: !!pkg.code && !!pkg.title && !!pkg.topic && ['PILOT','MAIN'].includes(pkg.phase) },
      { code: 'RAW_CONTENT', label: 'Bài đọc và hash văn bản nguồn', pass: !!content && content.phase === pkg.phase && !!content.rawContent.trim() && content.contentHash === contentHash(content.rawContent) },
      { code: 'LEXICAL_INTEGRITY', label: 'Toàn vẹn ký tự V1/V2', pass: !!content && (hasV2Custom || validatePresentation(content.rawContent)) },
      { code: 'REVISION_LOCK', label: 'Các revision đã khóa khi xuất bản', pass: pkg.status === 'DRAFT' ? !!content && !content.locked : !!content?.locked },
      { code: 'PUBLICATION', label: 'Trạng thái publication khớp', pass: pkg.status === 'DRAFT' ? !!content && content.status === 'DRAFT' : !!content && content.status === 'PUBLISHED' }
    ];
    return { saveDraft: pkg.status === 'DRAFT', publish: pkg.status === 'DRAFT' && rules.every(rule => rule.pass), startStudy: pkg.status === 'PUBLISHED' && pkg.enabled && rules.every(rule => rule.pass),
      checks: rules.map(({code,label,pass}) => ({code,label,status:pass ? 'PASS' : 'FAIL'})) };
  }

  async verifyPackage(pkg: ContentPackageDoc): Promise<string[]> {
    const problems: string[] = [];
    const content = await this.repo.getContentById(pkg.contentRevisionId);
    const hasV2Custom = !!content?.v2Content || !!pkg.v2Content;
    if (!content || content.phase !== pkg.phase || !content.rawContent.trim() || content.contentHash !== contentHash(content.rawContent)) problems.push('INVALID_CONTENT');
    if (!hasV2Custom && content?.rawContent && !validatePresentation(content.rawContent)) problems.push('INVALID_CONTENT');
    if (!pkg.code || !pkg.title || !pkg.topic || !['PILOT', 'MAIN'].includes(pkg.phase)) problems.push('INVALID_METADATA');
    return problems;
  }

  async createDraft(payload: unknown): Promise<ObjectId> {
    const input = packageInputSchema.parse(payload);
    if (!input.v2Content && !validatePresentation(input.rawContent)) throw new Error('LEXICAL_INTEGRITY_FAILED');

    const code = input.code.toUpperCase();
    const revision = await this.repo.nextPackageRevision(code);
    const contentId = await new ContentService(this.repo).createDraft({
      topicLabel: input.topic,
      rawContent: input.rawContent,
      phase: input.phase,
      v2Content: input.v2Content ?? null
    });
    const now = new Date();
    return this.repo.insertPackage({
      code,
      title: input.title,
      topic: input.topic,
      description: input.description,
      phase: input.phase,
      contentRevisionId: contentId,
      questionSetId: null,
      revision,
      status: 'DRAFT',
      enabled: true,
      aiSource: input.aiSource ?? null,
      v2Content: input.v2Content ?? null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      archivedAt: null
    });
  }

  async updateDraft(id: string, payload: unknown): Promise<ContentPackageDoc> {
    const input = packageInputSchema.parse(payload);
    const pkg = await this.repo.getPackageById(new ObjectId(id));
    if (!pkg || pkg.status !== 'DRAFT') throw new Error('PACKAGE_NOT_EDITABLE');
    if (input.code.toUpperCase() !== pkg.code || input.phase !== pkg.phase) throw new Error('PACKAGE_NOT_EDITABLE');
    if (!input.v2Content && !validatePresentation(input.rawContent)) throw new Error('LEXICAL_INTEGRITY_FAILED');

    const content = await this.repo.getContentById(pkg.contentRevisionId);
    if (!content || content.status !== 'DRAFT' || content.locked) throw new Error('PACKAGE_NOT_EDITABLE');
    const c = await new ContentService(this.repo).updateDraft(pkg.contentRevisionId.toHexString(), {
      topicLabel: input.topic,
      rawContent: input.rawContent,
      v2Content: input.v2Content ?? null
    });
    if (!c) throw new Error('PACKAGE_NOT_EDITABLE');

    const updated = await this.repo.updateDraftPackage(pkg._id!, {
      title: input.title,
      topic: input.topic,
      description: input.description,
      aiSource: input.aiSource ?? null,
      v2Content: input.v2Content ?? null
    });
    if (!updated) throw new Error('PACKAGE_NOT_EDITABLE');
    return updated;
  }

  async publish(id: string): Promise<ContentPackageDoc> {
    const pkg = await this.repo.getPackageById(new ObjectId(id));
    if (!pkg || pkg.status !== 'DRAFT') throw new Error('PACKAGE_NOT_EDITABLE');
    const issues = await this.verifyPackage(pkg);
    if (issues.length) throw new Error(`PACKAGE_INVALID:${issues.join(',')}`);
    // Each draft package owns its content; published material is immutable.
    const content = await this.repo.getContentById(pkg.contentRevisionId);
    if (!content) throw new Error('PACKAGE_INVALID');
    if (content.status !== 'PUBLISHED') await new ContentService(this.repo).publish(pkg.contentRevisionId.toHexString());
    const published = await this.repo.publishPackage(new ObjectId(id));
    if (!published) throw new Error('PACKAGE_NOT_EDITABLE');
    return published;
  }

  async eligible(phase: StudyPhase) {
    const candidates = await this.repo.listEligiblePackages(phase);
    const checks = await Promise.all(candidates.map(async pkg => {
      const [content, errors] = await Promise.all([
        this.repo.getContentById(pkg.contentRevisionId),
        this.verifyPackage(pkg)
      ]);
      return errors.length === 0 && content?.status === 'PUBLISHED' ? pkg : null;
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
