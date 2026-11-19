import { ObjectId } from 'mongodb';
import { assertRole } from '@/lib/auth/roles';
import { contentHash } from '@/lib/experiment/content-integrity';
import { hasExactAccessiblePresentationIntegrity } from '@/lib/experiment/presentation';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import {
  PresentationProfileRepository,
  type PresentationProfileStore
} from '@/lib/repositories/presentation-profile.repository';
import { AuditService } from './audit.service';
import { StudyRunError } from '@/lib/study-run/errors';
import {
  validateEmphasisSpans,
  verifyPresentationV2Integrity,
  type RenderedPresentationV1,
  type RenderedPresentationV2
} from '@/lib/study-run/presentation-profile';
import {
  presentationProfileConfirmSchema,
  presentationProfileCreateSchema,
  presentationProfileUpdateSchema
} from '@/lib/validation/presentation-profile-schemas';
import type { AdminRole, ContentRevisionDoc } from '@/types/research';
import type { PresentationProfileDoc } from '@/types/presentation-profile';

export interface PresentationProfileActor {
  username: string;
  role: AdminRole;
}

export interface PresentationProfileServiceDeps {
  store?: PresentationProfileStore;
  research?: Pick<ResearchRepository, 'getContentById' | 'addAudit'>;
  audit?: Pick<AuditService, 'record'>;
  now?: () => Date;
}

export interface PresentationProfilePreviewResult {
  profile: PresentationProfileDoc;
  v1: RenderedPresentationV1;
  v2: RenderedPresentationV2;
  integrity: {
    exactTextMatch: boolean;
    lexicalMatch: boolean;
    contentHash: string;
    emphasisCount: number;
  };
  auditLogged: boolean;
}

/**
 * Presentation Profile V2 service (architecture §2.2, §2.4, §5, §6.5, §6.6, AC-11..AC-14).
 * - Only RESEARCHER may create, update or confirm a profile; SUPERVISOR may read and inspect previews.
 * - Emphasis is strictly manual: no automatic or AI bolding exists.
 * - A profile must be previewed before it can be confirmed; any edit resets it to DRAFT and requires a fresh preview + confirm.
 * - Once LOCKED (when the first invitation of a Study Run using it is issued), every write returns 409.
 */
export class PresentationProfileService {
  private readonly store: PresentationProfileStore;
  private readonly research: NonNullable<PresentationProfileServiceDeps['research']>;
  private readonly audit: NonNullable<PresentationProfileServiceDeps['audit']>;
  private readonly now: () => Date;

  constructor(deps: PresentationProfileServiceDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.store = deps.store ?? new PresentationProfileRepository();
    this.research = research;
    this.audit = deps.audit ?? new AuditService(research as ResearchRepository);
    this.now = deps.now ?? (() => new Date());
  }

  // ---- reads (RESEARCHER and SUPERVISOR) -------------------------------------------------------------------

  async get(actor: PresentationProfileActor, id: string): Promise<PresentationProfileDoc> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return this.load(id);
  }

  async listByContent(actor: PresentationProfileActor, contentRevisionId: string): Promise<PresentationProfileDoc[]> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return this.store.listByContent(this.objectId(contentRevisionId, 'CONTENT_NOT_FOUND'));
  }

  // ---- writes & preview ------------------------------------------------------------------------------------

  async create(
    actor: PresentationProfileActor,
    payload: unknown
  ): Promise<{ profile: PresentationProfileDoc; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = presentationProfileCreateSchema.parse(payload);
    const contentId = this.objectId(input.contentRevisionId, 'CONTENT_NOT_FOUND');
    const content = await this.loadEligibleContent(contentId);

    const validated = validateEmphasisSpans(content.rawContent, input.emphasis ?? []);
    if (!validated.ok) throw new StudyRunError(validated.code, 400, validated.details);

    const sentencesPerBlock = input.sentencesPerBlock ?? 2;
    const integrity = verifyPresentationV2Integrity(content.rawContent, {
      emphasis: validated.spans,
      sentencesPerBlock
    });
    if (!integrity.ok) throw new StudyRunError('PRESENTATION_PROFILE_INTEGRITY_FAILED', 409, integrity.problems);

    const version = await this.store.nextVersion(contentId);
    const now = this.now();
    const doc: PresentationProfileDoc = {
      contentRevisionId: contentId,
      contentHash: content.contentHash,
      variant: 'V2',
      version,
      status: 'DRAFT',
      segmentation: { mode: 'SENTENCE_BLOCKS', sentencesPerBlock },
      style: { preset: 'READER_V2_ACCESSIBLE' },
      emphasis: validated.spans,
      editRevision: 1,
      previewedBy: null,
      previewedAt: null,
      previewedRevision: null,
      confirmedBy: null,
      confirmedAt: null,
      lockedAt: null,
      createdBy: actor.username,
      createdAt: now,
      updatedAt: now
    };

    let insertedId: ObjectId;
    try {
      insertedId = await this.store.insert(doc);
    } catch (error) {
      if (isDuplicateKey(error)) throw new StudyRunError('PRESENTATION_PROFILE_VERSION_EXISTS', 409);
      throw error;
    }

    const profile: PresentationProfileDoc = { ...doc, _id: insertedId };
    const auditLogged = await this.record(actor, 'PRESENTATION_PROFILE_CREATED', profile, {
      contentRevisionId: contentId.toHexString(),
      version: profile.version,
      emphasisCount: profile.emphasis.length
    });
    return { profile, auditLogged };
  }

  /**
   * Updates manual emphasis (and optional block segmentation). Refused with 409 when LOCKED.
   * Editing a CONFIRMED profile resets its status to DRAFT and clears preview/confirmation timestamps.
   */
  async updateEmphasis(
    actor: PresentationProfileActor,
    id: string,
    payload: unknown
  ): Promise<{ profile: PresentationProfileDoc; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = presentationProfileUpdateSchema.parse(payload);
    const existing = await this.load(id);
    if (existing.status === 'LOCKED') throw new StudyRunError('PRESENTATION_PROFILE_LOCKED', 409);

    const content = await this.loadMatchingContent(existing);
    const validated = validateEmphasisSpans(content.rawContent, input.emphasis);
    if (!validated.ok) throw new StudyRunError(validated.code, 400, validated.details);

    const sentencesPerBlock = input.sentencesPerBlock ?? existing.segmentation.sentencesPerBlock;
    const integrity = verifyPresentationV2Integrity(content.rawContent, {
      emphasis: validated.spans,
      sentencesPerBlock
    });
    if (!integrity.ok) throw new StudyRunError('PRESENTATION_PROFILE_INTEGRITY_FAILED', 409, integrity.problems);

    const saved = await this.store.updateIfEditable(existing._id!, {
      emphasis: validated.spans,
      segmentation: { mode: 'SENTENCE_BLOCKS', sentencesPerBlock },
      style: existing.style,
      updatedAt: this.now()
    });
    if (!saved) throw new StudyRunError('PRESENTATION_PROFILE_LOCKED', 409);

    const auditLogged = await this.record(actor, 'PRESENTATION_PROFILE_UPDATED', saved, {
      version: saved.version,
      emphasisCount: saved.emphasis.length,
      previousStatus: existing.status
    });
    return { profile: saved, auditLogged };
  }

  /**
   * Renders V1 and V2 side-by-side and verifies exact character & lexical integrity (AC-11, AC-12, AC-14).
   * When called by a RESEARCHER on an editable profile, records `previewedBy`/`previewedAt` so the profile can be confirmed.
   */
  async preview(actor: PresentationProfileActor, id: string): Promise<PresentationProfilePreviewResult> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    const existing = await this.load(id);
    const content = await this.loadMatchingContent(existing);

    const check = verifyPresentationV2Integrity(content.rawContent, {
      emphasis: existing.emphasis,
      sentencesPerBlock: existing.segmentation.sentencesPerBlock
    });
    if (!check.ok) throw new StudyRunError('PRESENTATION_PROFILE_INTEGRITY_FAILED', 409, check.problems);

    let profile = existing;
    let auditLogged = true;
    if (actor.role === 'RESEARCHER' && existing.status !== 'LOCKED') {
      // CAS on the revision that was just rendered: a Preview can only vouch for the exact content it showed (AC-14).
      const marked = await this.store.markPreviewedIfEditable(existing._id!, existing.editRevision, actor.username, this.now());
      if (marked) {
        profile = marked;
        auditLogged = await this.record(actor, 'PRESENTATION_PROFILE_PREVIEWED', profile, {
          version: profile.version,
          emphasisCount: profile.emphasis.length,
          editRevision: profile.editRevision
        });
      } else {
        const current = await this.store.getById(existing._id!);
        if (current?.status === 'LOCKED') {
          profile = current; // locked in the meantime: the rendering is still valid, but nothing can be marked
        } else {
          throw new StudyRunError('PRESENTATION_PROFILE_REVISION_CONFLICT', 409);
        }
      }
    }

    return {
      profile,
      v1: check.v1,
      v2: check.v2,
      integrity: {
        exactTextMatch: check.v2.textContent === content.rawContent && check.v1.textContent === content.rawContent,
        lexicalMatch: true,
        contentHash: check.contentHash,
        emphasisCount: existing.emphasis.length
      },
      auditLogged
    };
  }

  /**
   * Confirms the profile after Preview (AC-14). Refused if not previewed (`PRESENTATION_PROFILE_PREVIEW_REQUIRED`, 409)
   * or already `LOCKED` (`PRESENTATION_PROFILE_LOCKED`, 409).
   */
  async confirm(
    actor: PresentationProfileActor,
    id: string,
    payload?: unknown
  ): Promise<{ profile: PresentationProfileDoc; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = presentationProfileConfirmSchema.parse(payload);
    const existing = await this.load(id);
    if (existing.status === 'LOCKED') throw new StudyRunError('PRESENTATION_PROFILE_LOCKED', 409);
    if (input?.expectedRevision !== undefined && input.expectedRevision !== existing.editRevision) {
      throw new StudyRunError('PRESENTATION_PROFILE_REVISION_CONFLICT', 409);
    }
    if (!existing.previewedAt || existing.previewedRevision !== existing.editRevision) {
      throw new StudyRunError('PRESENTATION_PROFILE_PREVIEW_REQUIRED', 409);
    }

    const content = await this.loadMatchingContent(existing);
    const check = verifyPresentationV2Integrity(content.rawContent, {
      emphasis: existing.emphasis,
      sentencesPerBlock: existing.segmentation.sentencesPerBlock
    });
    if (!check.ok) throw new StudyRunError('PRESENTATION_PROFILE_INTEGRITY_FAILED', 409, check.problems);

    const saved = await this.store.confirmIfPreviewed(existing._id!, existing.editRevision, actor.username, this.now());
    if (!saved) {
      const current = await this.store.getById(existing._id!);
      if (current?.status === 'LOCKED') throw new StudyRunError('PRESENTATION_PROFILE_LOCKED', 409);
      if (current && current.editRevision !== existing.editRevision) throw new StudyRunError('PRESENTATION_PROFILE_REVISION_CONFLICT', 409);
      throw new StudyRunError('PRESENTATION_PROFILE_PREVIEW_REQUIRED', 409);
    }

    const auditLogged = await this.record(actor, 'PRESENTATION_PROFILE_CONFIRMED', saved, {
      version: saved.version,
      emphasisCount: saved.emphasis.length,
      contentHash: saved.contentHash,
      editRevision: saved.editRevision
    });
    return { profile: saved, auditLogged };
  }

  // ---- internals -------------------------------------------------------------------------------------------

  private async load(id: string): Promise<PresentationProfileDoc> {
    const doc = await this.store.getById(this.objectId(id, 'PRESENTATION_PROFILE_NOT_FOUND'));
    if (!doc) throw new StudyRunError('PRESENTATION_PROFILE_NOT_FOUND', 404);
    return doc;
  }

  private async loadEligibleContent(id: ObjectId): Promise<ContentRevisionDoc> {
    const content = await this.research.getContentById(id);
    if (!content?._id) throw new StudyRunError('CONTENT_NOT_FOUND', 404);
    const problemas: string[] = [];
    if (content.status !== 'PUBLISHED' || !content.locked) problemas.push('CONTENT_NOT_PUBLISHED');
    if (!content.rawContent.trim() || content.contentHash !== contentHash(content.rawContent)) problemas.push('INVALID_CONTENT_HASH');
    if (!hasExactAccessiblePresentationIntegrity(content.rawContent)) problemas.push('INVALID_BLOCK_INTEGRITY');
    if (problemas.length) throw new StudyRunError('CONTENT_NOT_ELIGIBLE', 409, problemas);
    return content;
  }

  private async loadMatchingContent(profile: PresentationProfileDoc): Promise<ContentRevisionDoc> {
    const content = await this.research.getContentById(profile.contentRevisionId);
    if (!content) throw new StudyRunError('CONTENT_NOT_FOUND', 404);
    if (content.contentHash !== profile.contentHash || content.contentHash !== contentHash(content.rawContent)) {
      throw new StudyRunError('PRESENTATION_PROFILE_CONTENT_MISMATCH', 409);
    }
    return content;
  }

  private objectId(id: string, code: string): ObjectId {
    if (!/^[a-fA-F0-9]{24}$/.test(id)) throw new StudyRunError(code, 404);
    return new ObjectId(id);
  }

  private async record(
    actor: PresentationProfileActor,
    action: string,
    profile: PresentationProfileDoc,
    metadata: Record<string, string | number | boolean | null>
  ): Promise<boolean> {
    try {
      await this.audit.record({
        username: actor.username,
        role: actor.role,
        action,
        targetType: 'presentation_profile',
        targetId: profile._id!.toHexString(),
        metadata
      });
      return true;
    } catch {
      console.error('Presentation profile audit entry failed after a successful write.');
      return false;
    }
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}
