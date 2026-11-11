import { ObjectId } from 'mongodb';
import { contentHash, countWords } from '@/lib/experiment/content-integrity';
import type { StudyRunAdminUpdate, StudyRunStore } from '@/lib/repositories/study-run.repository';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { StudyRunService, type StudyRunServiceDeps } from '@/lib/services/study-run.service';
import type { StudyRunCapabilities } from '@/lib/study-run/capabilities';
import type { PresentationEmphasisSpan, PresentationProfileDoc } from '@/types/presentation-profile';
import type { ContentPackageDoc, ContentRevisionDoc, ExperimentConfigDoc } from '@/types/research';
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

/** In-memory StudyRunStore with the same compare-and-set semantics as the MongoDB repository. */
export class FakeStudyRunStore implements StudyRunStore {
  readonly docs = new Map<string, StudyRunDoc>();
  /** Every update key ever applied; lets tests prove which fields were (not) written. */
  readonly writtenKeys: string[] = [];

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
  /** Test-only: simulate the P4 quota service (not part of the store port). */
  setArmsForTest(id: ObjectId, arms: StudyRunDoc['arms']): void {
    const doc = this.docs.get(id.toHexString())!;
    this.docs.set(id.toHexString(), { ...doc, arms });
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
    problems: options.packageProblems ?? ([] as string[])
  };
  const audits: Array<{ username: string; role: string; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }> = [];
  const store = new FakeStudyRunStore();
  const profiles = new FakePresentationProfileStore();
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
    getQuestionSetById: async () => ({ status: state.questionsPublished ? 'PUBLISHED' : 'DRAFT', locked: state.questionsPublished }) as never,
    addAudit: async () => undefined
  };
  const audit = { record: async (input: (typeof audits)[number]) => { audits.push(input); } };
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
  return { service: new StudyRunService(deps), profileService, store, profiles, audits, state, packageId, contentId, deps, confirmDefaultProfile };
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
