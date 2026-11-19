import { makeQuestions } from './question-fixtures';
import { ObjectId } from 'mongodb';
import { contentHash, countWords } from '@/lib/experiment/content-integrity';
import type {
  ClaimRunSessionQuotaTransitionInput,
  ClaimSupplementalPromotionInput,
  FinalizeRunSessionQuotaStatusInput,
  QuotaSessionStore,
  RevertRunSessionValidityClaimInput,
  RevertSupplementalPromotionInput
} from '@/lib/repositories/research.repository';
import {
  outcomeForTransition,
  type StudyRunAdminUpdate,
  type StudyRunQuotaCounterOptions,
  type StudyRunQuotaCounterTransition,
  type StudyRunStore
} from '@/lib/repositories/study-run.repository';
import { hasSettlingRelease } from '@/lib/study-run/quota';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { StudyRunService, type StudyRunServiceDeps } from '@/lib/services/study-run.service';
import type { StudyRunCapabilities } from '@/lib/study-run/capabilities';
import type { PresentationEmphasisSpan, PresentationProfileDoc } from '@/types/presentation-profile';
import type { ContentPackageDoc, ContentRevisionDoc, ExperimentConfigDoc, Presentation, SessionDoc } from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';
import { FakePresentationProfileStore } from './presentation-profile-fakes';

export const ALL_CAPABILITIES: StudyRunCapabilities = {
  invitationRedemption: true, presentationProfile: true, singleRoundFlow: true, quotaRecording: true
};

export const FIXTURE_RAW_CONTENT =
  'First sentence of the fixture passage. Second sentence of the first block. Third sentence starts the second block. Fourth sentence completes the fixture text.';

/** Deep copy that keeps ObjectId (immutable) and Date intact; structuredClone would strip ObjectId's prototype. */
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

function lookup(doc: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), doc);
}

function sameDateOrNull(a: Date | undefined | null, b: Date | undefined | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/** In-memory StudyRunStore with the same compare-and-set semantics as the MongoDB repository. */
export class FakeStudyRunStore implements StudyRunStore {
  readonly docs = new Map<string, StudyRunDoc>();
  /** Every admin update key ever applied; lets tests prove which fields were (not) written by StudyRunService. */
  readonly writtenKeys: string[] = [];
  /** Every quota counter transition applied via `applyQuotaCounterTransition`. */
  readonly quotaTransitions: Array<{ id: string; variant: Presentation; transition: StudyRunQuotaCounterTransition; transitionId?: string }> = [];

  async insert(doc: StudyRunDoc): Promise<ObjectId> {
    for (const existing of this.docs.values()) if (existing.code === doc.code) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const _id = new ObjectId();
    this.docs.set(_id.toHexString(), clone({ ...doc, _id }));
    return _id;
  }
  async getById(id: ObjectId): Promise<StudyRunDoc | null> {
    const doc = this.docs.get(id.toHexString());
    return doc ? clone(doc) : null;
  }
  async list(filter: { status?: StudyRunDoc['status'] } = {}): Promise<StudyRunDoc[]> {
    return [...this.docs.values()].filter((d) => !filter.status || d.status === filter.status).map((d) => clone(d));
  }
  async updateIfVersion(id: ObjectId, expectedVersion: number, update: StudyRunAdminUpdate, guard: Record<string, unknown> = {}): Promise<StudyRunDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || doc.version !== expectedVersion) return null;
    for (const [path, condition] of Object.entries(guard)) {
      const actual = lookup(doc, path);
      if (typeof condition !== 'object' || condition === null) {
        if (actual !== condition) return null;
        continue;
      }
      const lte = (condition as { $lte?: number }).$lte;
      if (lte !== undefined && !(typeof actual === 'number' && actual <= lte)) return null;
    }
    this.writtenKeys.push(...Object.keys(update));
    const next = { ...doc, ...clone(update), version: doc.version + 1 } as StudyRunDoc;
    this.docs.set(id.toHexString(), next);
    return clone(next);
  }
  async lockIfUnlocked(id: ObjectId, expectedV2?: { profileId: ObjectId; version: number }): Promise<StudyRunDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || doc.locked) return null;
    if (expectedV2 && (!doc.presentation.V2.profileId?.equals(expectedV2.profileId) || doc.presentation.V2.version !== expectedV2.version)) return null;
    const next = { ...doc, locked: true, version: doc.version + 1 };
    this.docs.set(id.toHexString(), next);
    return clone(next);
  }
  async hasOpenRunBlockingLegacyEntry(): Promise<boolean> {
    return [...this.docs.values()].some((d) => d.status === 'OPEN' && d.entryPolicy?.legacyEntry === 'BLOCKED_WHILE_OPEN');
  }
  async applyQuotaCounterTransition(
    id: ObjectId,
    variant: Presentation,
    transition: StudyRunQuotaCounterTransition,
    transitionId?: string,
    options: StudyRunQuotaCounterOptions = {}
  ): Promise<StudyRunDoc | null> {
    if (variant !== 'V1' && variant !== 'V2') throw new Error('INVALID_PRESENTATION_VARIANT');
    if (transitionId !== undefined && (!transitionId || /[.$\0]/.test(transitionId))) {
      throw new Error('INVALID_QUOTA_TRANSITION_ID');
    }
    const doc = this.docs.get(id.toHexString());
    if (!doc) return null;
    if (transitionId && doc.quotaLedger?.[transitionId]) {
      const applied = doc.quotaLedger[transitionId];
      if (applied.transition === transition && applied.variant === variant) {
        return clone(doc);
      }
      return null;
    }
    if (options.compensates) {
      if (!options.sessionId) throw new Error('COMPENSATION_REQUIRES_SESSION');
      const target = doc.quotaLedger?.[options.compensates];
      // Same ownership guard the MongoDB repository evaluates atomically.
      if (!target || (target.claimedAt && hasSettlingRelease(doc.quotaLedger, options.sessionId, target.claimedAt))) return null;
    }
    const arm = doc.arms[variant];
    let nextArm = { ...arm };
    switch (transition) {
      case 'CLAIM_INCLUDED':
        if (doc.quotaPerArm === null || doc.quotaPerArm <= 0 || arm.validIncluded >= doc.quotaPerArm) return null;
        nextArm = { ...arm, validIncluded: arm.validIncluded + 1 };
        break;
      case 'INCREMENT_SUPPLEMENTAL':
        if (doc.quotaPerArm === null || doc.quotaPerArm <= 0) return null;
        nextArm = { ...arm, supplementalValid: arm.supplementalValid + 1 };
        break;
      case 'RELEASE_INCLUDED':
        if (arm.validIncluded < 1) return null;
        nextArm = { ...arm, validIncluded: arm.validIncluded - 1 };
        break;
      case 'RELEASE_SUPPLEMENTAL':
        if (arm.supplementalValid < 1) return null;
        nextArm = { ...arm, supplementalValid: arm.supplementalValid - 1 };
        break;
      case 'PROMOTE_SUPPLEMENTAL':
        if (doc.quotaPerArm === null || doc.quotaPerArm <= 0 || arm.supplementalValid < 1 || arm.validIncluded >= doc.quotaPerArm) return null;
        nextArm = { validIncluded: arm.validIncluded + 1, supplementalValid: arm.supplementalValid - 1 };
        break;
      case 'REVERT_PROMOTE_SUPPLEMENTAL':
        if (arm.validIncluded < 1) return null;
        nextArm = { validIncluded: arm.validIncluded - 1, supplementalValid: arm.supplementalValid + 1 };
        break;
    }
    const next: StudyRunDoc = {
      ...doc,
      arms: { ...doc.arms, [variant]: nextArm },
      ...(transitionId
        ? {
            quotaLedger: {
              ...(doc.quotaLedger ?? {}),
              [transitionId]: {
                transitionId,
                variant,
                transition,
                outcome: outcomeForTransition(transition),
                appliedAt: new Date(),
                ...(options.sessionId ? { sessionId: options.sessionId } : {}),
                ...(options.claimedAt ? { claimedAt: clone(options.claimedAt) } : {})
              }
            }
          }
        : {})
    };
    this.docs.set(id.toHexString(), next);
    this.quotaTransitions.push({ id: id.toHexString(), variant, transition, transitionId });
    return clone(next);
  }
  /** Test-only: simulate direct arm counter state (not part of the store port). */
  setArmsForTest(id: ObjectId, arms: StudyRunDoc['arms']): void {
    const doc = this.docs.get(id.toHexString())!;
    this.docs.set(id.toHexString(), { ...doc, arms });
  }
}

/** In-memory QuotaSessionStore with the exact same CAS semantics as ResearchRepository. */
export class FakeQuotaSessionStore implements QuotaSessionStore {
  readonly docs = new Map<string, SessionDoc>();
  readonly writes: string[] = [];

  put(session: SessionDoc): void {
    this.docs.set(session.id, clone(session));
  }

  async getSession(id: string): Promise<SessionDoc | null> {
    const s = this.docs.get(id);
    return s ? clone(s) : null;
  }

  async claimRunSessionQuotaTransition(input: ClaimRunSessionQuotaTransitionInput): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      s.currentStage !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.presentationVariant !== input.variant ||
      s.validityFlag !== input.expectedValidityFlag ||
      (s.quotaStatus ?? null) !== (input.expectedQuotaStatus ?? null)
    ) {
      return null;
    }
    if (input.expectedReviewedAt !== undefined && !sameDateOrNull(s.validityReviewedAt, input.expectedReviewedAt)) {
      return null;
    }
    if (input.expectedQuotaRecordedAt !== undefined && !sameDateOrNull(s.quotaRecordedAt, input.expectedQuotaRecordedAt)) {
      return null;
    }
    // Same guard as the MongoDB repository: never overwrite a settled transition whose audit entry is still owed.
    if (input.transition !== undefined && s.quotaTransition && s.quotaTransition.state !== 'PENDING' && s.quotaTransition.auditLogged === false) {
      return null;
    }
    const history = [...(s.validityHistory ?? []), {
      flag: input.nextValidityFlag,
      reason: input.reason,
      reviewedBy: input.reviewedBy,
      reviewedAt: clone(input.at)
    }];
    const next: SessionDoc = {
      ...s,
      validityFlag: input.nextValidityFlag,
      validityReason: input.reason,
      validityReviewedBy: input.reviewedBy,
      validityReviewedAt: clone(input.at),
      validityChecklistVersion: input.checklistVersion,
      ...(input.nextQuotaStatus !== null ? { quotaStatus: input.nextQuotaStatus } : {}),
      ...(input.recordQuotaMeta ? { quotaRecordedAt: clone(input.at), quotaRecordedBy: input.reviewedBy } : {}),
      ...(input.transition !== undefined ? { quotaTransition: clone(input.transition) } : {}),
      validityHistory: history,
      updatedAt: clone(input.at)
    };
    this.docs.set(input.sessionId, next);
    this.writes.push('claimRunSessionQuotaTransition');
    return clone(next);
  }

  async finalizeRunSessionQuotaStatus(input: FinalizeRunSessionQuotaStatusInput): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    const expectedFlag = input.expectedValidityFlag ?? 'VALID';
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      s.currentStage !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.presentationVariant !== input.variant ||
      s.validityFlag !== expectedFlag ||
      !sameDateOrNull(s.validityReviewedAt, input.expectedReviewedAt) ||
      (s.quotaStatus ?? null) !== (input.expectedQuotaStatus ?? null)
    ) {
      return null;
    }
    if (input.transitionId && (!s.quotaTransition || s.quotaTransition.id !== input.transitionId || s.quotaTransition.state !== 'PENDING')) {
      return null;
    }
    const nextTransition =
      input.transitionId && s.quotaTransition
        ? {
            ...clone(s.quotaTransition),
            state: input.transitionState ?? 'COMMITTED',
            committedQuotaStatus: input.quotaStatus,
            updatedAt: clone(input.at),
            ...(input.auditLogged !== undefined ? { auditLogged: input.auditLogged } : {})
          }
        : s.quotaTransition;
    const next: SessionDoc = {
      ...s,
      quotaStatus: input.quotaStatus,
      quotaRecordedAt: clone(input.at),
      quotaRecordedBy: input.recordedBy,
      ...(nextTransition !== undefined ? { quotaTransition: nextTransition } : {}),
      updatedAt: clone(input.at)
    };
    this.docs.set(input.sessionId, next);
    this.writes.push('finalizeRunSessionQuotaStatus');
    return clone(next);
  }

  async markRunSessionQuotaAuditLogged(sessionId: string, transitionId: string): Promise<void> {
    const s = this.docs.get(sessionId);
    if (!s?.quotaTransition || s.quotaTransition.id !== transitionId) return;
    this.docs.set(sessionId, { ...s, quotaTransition: { ...clone(s.quotaTransition), auditLogged: true } });
    this.writes.push('markRunSessionQuotaAuditLogged');
  }

  async revertRunSessionValidityClaim(input: RevertRunSessionValidityClaimInput): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    const expectedFlag = input.claimedValidityFlag ?? 'VALID';
    const expectedQuota = input.claimedQuotaStatus !== undefined ? input.claimedQuotaStatus : input.previousQuotaStatus;
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.validityFlag !== expectedFlag ||
      !sameDateOrNull(s.validityReviewedAt, input.expectedReviewedAt) ||
      (s.quotaStatus ?? null) !== (expectedQuota ?? null)
    ) {
      return null;
    }
    if (input.transitionId && s.quotaTransition?.id !== input.transitionId) {
      return null;
    }
    const history = [...(s.validityHistory ?? [])];
    if (history.length > 0) history.pop();
    const next: SessionDoc = {
      ...s,
      validityFlag: input.previousValidityFlag,
      validityReason: input.previousReason,
      validityReviewedBy: input.previousReviewedBy,
      validityReviewedAt: input.previousReviewedAt ? clone(input.previousReviewedAt) : undefined,
      validityChecklistVersion: input.previousChecklistVersion ?? null,
      quotaTransition: null,
      validityHistory: history,
      updatedAt: clone(input.previousUpdatedAt ?? input.expectedReviewedAt)
    };
    if (input.previousQuotaStatus !== null) {
      next.quotaStatus = input.previousQuotaStatus;
    } else {
      delete next.quotaStatus;
    }
    if (input.previousQuotaRecordedAt !== undefined && input.previousQuotaRecordedAt !== null) {
      next.quotaRecordedAt = clone(input.previousQuotaRecordedAt);
    } else {
      delete next.quotaRecordedAt;
    }
    if (input.previousQuotaRecordedBy !== undefined && input.previousQuotaRecordedBy !== null) {
      next.quotaRecordedBy = input.previousQuotaRecordedBy;
    } else {
      delete next.quotaRecordedBy;
    }
    this.docs.set(input.sessionId, next);
    this.writes.push('revertRunSessionValidityClaim');
    return clone(next);
  }

  async claimSupplementalQuotaPromotion(input: ClaimSupplementalPromotionInput): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      s.currentStage !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.presentationVariant !== input.variant ||
      s.validityFlag !== 'VALID' ||
      s.quotaStatus !== 'SUPPLEMENTAL' ||
      !sameDateOrNull(s.quotaRecordedAt, input.expectedRecordedAt) ||
      (s.quotaTransition && s.quotaTransition.state !== 'PENDING' && s.quotaTransition.auditLogged === false)
    ) {
      return null;
    }
    const next: SessionDoc = {
      ...s,
      quotaRecordedAt: clone(input.at),
      quotaRecordedBy: input.recordedBy,
      ...(input.transition !== undefined ? { quotaTransition: clone(input.transition) } : {}),
      updatedAt: clone(input.at)
    };
    this.docs.set(input.sessionId, next);
    this.writes.push('claimSupplementalQuotaPromotion');
    return clone(next);
  }

  async finalizeSupplementalQuotaPromotion(input: {
    sessionId: string;
    studyRunId: ObjectId;
    variant: Presentation;
    claimAt: Date;
    transitionId?: string;
    transitionState?: 'COMMITTED' | 'RECOVERED';
    auditLogged?: boolean;
  }): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      s.currentStage !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.presentationVariant !== input.variant ||
      s.validityFlag !== 'VALID' ||
      s.quotaStatus !== 'SUPPLEMENTAL' ||
      !sameDateOrNull(s.quotaRecordedAt, input.claimAt)
    ) {
      return null;
    }
    if (input.transitionId && (!s.quotaTransition || s.quotaTransition.id !== input.transitionId || s.quotaTransition.state !== 'PENDING')) {
      return null;
    }
    const nextTransition =
      input.transitionId && s.quotaTransition
        ? {
            ...clone(s.quotaTransition),
            state: input.transitionState ?? 'COMMITTED',
            committedQuotaStatus: 'INCLUDED' as const,
            updatedAt: clone(input.claimAt),
            ...(input.auditLogged !== undefined ? { auditLogged: input.auditLogged } : {})
          }
        : s.quotaTransition;
    const next: SessionDoc = {
      ...s,
      quotaStatus: 'INCLUDED',
      ...(nextTransition !== undefined ? { quotaTransition: nextTransition } : {}),
      updatedAt: clone(input.claimAt)
    };
    this.docs.set(input.sessionId, next);
    this.writes.push('finalizeSupplementalQuotaPromotion');
    return clone(next);
  }

  async revertSupplementalQuotaPromotion(input: RevertSupplementalPromotionInput): Promise<SessionDoc | null> {
    const s = this.docs.get(input.sessionId);
    if (
      !s ||
      s.status !== 'COMPLETED' ||
      !s.studyRunId?.equals(input.studyRunId) ||
      s.presentationVariant !== input.variant ||
      s.validityFlag !== 'VALID' ||
      s.quotaStatus !== 'SUPPLEMENTAL' ||
      !sameDateOrNull(s.quotaRecordedAt, input.claimAt)
    ) {
      return null;
    }
    if (input.transitionId && s.quotaTransition?.id !== input.transitionId) {
      return null;
    }
    const next: SessionDoc = {
      ...s,
      quotaRecordedAt: input.previousRecordedAt ? clone(input.previousRecordedAt) : null,
      quotaRecordedBy: input.previousRecordedBy,
      quotaTransition: null,
      updatedAt: clone(input.previousUpdatedAt ?? input.claimAt)
    };
    this.docs.set(input.sessionId, next);
    this.writes.push('revertSupplementalQuotaPromotion');
    return clone(next);
  }

  async countRunQuotaFromSessions(studyRunId: ObjectId): Promise<StudyRunDoc['arms']> {
    const counts: StudyRunDoc['arms'] = {
      V1: { validIncluded: 0, supplementalValid: 0 },
      V2: { validIncluded: 0, supplementalValid: 0 }
    };
    for (const s of this.docs.values()) {
      if (!s.studyRunId?.equals(studyRunId) || s.status !== 'COMPLETED' || s.validityFlag !== 'VALID') continue;
      if (s.presentationVariant !== 'V1' && s.presentationVariant !== 'V2') continue;
      if (s.quotaStatus === 'INCLUDED') counts[s.presentationVariant].validIncluded += 1;
      else if (s.quotaStatus === 'SUPPLEMENTAL') counts[s.presentationVariant].supplementalValid += 1;
    }
    return counts;
  }
}

export const RESEARCHER = { username: 'researcher', role: 'RESEARCHER' as const };
export const SUPERVISOR = { username: 'supervisor', role: 'SUPERVISOR' as const };

export const fixtureConfig = (over: Partial<ExperimentConfigDoc> = {}): ExperimentConfigDoc => ({
  key: 'active', phase: 'MAIN', informationText: 'Information text v1', informationVersion: 'info-v1',
  consentText: 'Consent text v1', consentVersion: 'consent-v1', debriefText: 'Debrief text v1', debriefVersion: 'debrief-v1',
  dataRightsText: 'x', findingsText: 'x', minimumReadingSeconds: 1, minimumValidTarget: 40, recruitmentTarget: 60, updatedAt: new Date(0), ...over
});

export function makeHarness(options: { capabilities?: StudyRunCapabilities; packageProblems?: string[] } = {}) {
  const contentId = new ObjectId(), questionSetId = new ObjectId(), packageId = new ObjectId();
  const pkg = { _id: packageId, code: 'FIXTURE_MAIN', title: 't', topic: 't', description: '', phase: 'MAIN', contentRevisionId: contentId,
    questionSetId, revision: 3, status: 'PUBLISHED', enabled: true, aiSource: null, createdAt: new Date(), updatedAt: new Date(),
    publishedAt: new Date(), archivedAt: null } as ContentPackageDoc;
  const state = {
    pkg,
    rawContent: FIXTURE_RAW_CONTENT,
    config: fixtureConfig(),
    contentPublished: true,
    questionsPublished: true,
    /** Extra question sets selectable for a run (P5): keyed by hex id. */
    extraQuestionSets: new Map<string, unknown>(),
    problems: options.packageProblems ?? ([] as string[])
  };
  const audits: Array<{ username: string; role: string; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown>; dedupeKey?: string }> = [];
  const store = new FakeStudyRunStore();
  const profiles = new FakePresentationProfileStore();
  const quotaSessions = new FakeQuotaSessionStore();
  const research: NonNullable<StudyRunServiceDeps['research']> = {
    getConfig: async () => state.config,
    getPackageById: async (id: ObjectId) => (state.pkg && state.pkg._id?.equals(id) ? state.pkg : null),
    getContentById: async (id: ObjectId) =>
      id.equals(contentId)
        ? ({
            _id: contentId,
            revision: 1,
            topicLabel: 'Fixture topic',
            rawContent: state.rawContent,
            contentHash: contentHash(state.rawContent),
            wordCount: countWords(state.rawContent),
            status: state.contentPublished ? 'PUBLISHED' : 'DRAFT',
            locked: state.contentPublished,
            phase: 'MAIN',
            createdAt: new Date(0),
            publishedAt: state.contentPublished ? new Date(0) : null
          } as ContentRevisionDoc)
        : null,
    getQuestionSetById: async (id: ObjectId) => (state.extraQuestionSets.get(id.toHexString()) ?? (id.equals(questionSetId)
      ? ({ _id: questionSetId, revision: 7, label: 'Fixture questions', phase: 'MAIN', questions: makeQuestions(), status: state.questionsPublished ? 'PUBLISHED' : 'DRAFT', locked: state.questionsPublished, createdAt: new Date(0), publishedAt: null })
      : null)) as never,
    addAudit: async () => undefined
  };
  const audit = {
    record: async (input: (typeof audits)[number]) => {
      // Mirrors the unique `dedupeKey` index: at most one entry per key.
      if (input.dedupeKey && audits.some((a) => a.dedupeKey === input.dedupeKey)) return;
      audits.push(input);
    }
  };
  const deps: StudyRunServiceDeps = {
    store,
    profiles,
    research,
    packages: { verifyPackage: async () => [...state.problems] },
    audit,
    capabilities: options.capabilities ?? ALL_CAPABILITIES
  };
  const profileService = new PresentationProfileService({ store: profiles, research, audit });
  async function confirmDefaultProfile(emphasis: PresentationEmphasisSpan[] = []): Promise<PresentationProfileDoc> {
    const existing = (await profiles.listByContent(contentId)).find((p) => p.status === 'CONFIRMED' || p.status === 'LOCKED');
    if (existing && emphasis.length === 0) return existing;
    const created = await profileService.create(RESEARCHER, { contentRevisionId: contentId.toHexString(), emphasis });
    await profileService.preview(RESEARCHER, created.profile._id!.toHexString());
    return (await profileService.confirm(RESEARCHER, created.profile._id!.toHexString())).profile;
  }
  return { service: new StudyRunService(deps), profileService, store, profiles, quotaSessions, audits, state, packageId, contentId, questionSetId, deps, confirmDefaultProfile };
}

export async function expectStudyRunError(work: Promise<unknown>, code: string, status?: number): Promise<string[]> {
  try { await work; } catch (error) {
    const e = error as { code?: string; status?: number; message?: string; details?: string[] };
    const got = e.code ?? e.message;
    if (got !== code || (status !== undefined && e.status !== status)) throw new Error(`Expected ${code}${status ? `/${status}` : ''} but got ${got}/${e.status}`);
    return e.details ?? [];
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}
