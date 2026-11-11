import { ObjectId } from 'mongodb';
import type { StudyRunAdminUpdate, StudyRunStore } from '@/lib/repositories/study-run.repository';
import { StudyRunService, type StudyRunServiceDeps } from '@/lib/services/study-run.service';
import type { StudyRunCapabilities } from '@/lib/study-run/capabilities';
import type { ContentPackageDoc, ExperimentConfigDoc } from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';

export const ALL_CAPABILITIES: StudyRunCapabilities = {
  invitationRedemption: true, presentationProfile: true, singleRoundFlow: true, quotaRecording: true
};

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
      const lte = (condition as { $lte?: number }).$lte;
      if (lte !== undefined && !(typeof actual === 'number' && actual <= lte)) return null;
    }
    this.writtenKeys.push(...Object.keys(update));
    const next = { ...doc, ...clone(update), version: doc.version + 1 } as StudyRunDoc;
    this.docs.set(id.toHexString(), next);
    return clone(next);
  }
  async lockIfUnlocked(id: ObjectId): Promise<StudyRunDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || doc.locked) return null;
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
  const state = { pkg, config: fixtureConfig(), contentPublished: true, questionsPublished: true, problems: options.packageProblems ?? [] as string[] };
  const audits: Array<{ username: string; role: string; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }> = [];
  const store = new FakeStudyRunStore();
  const deps: StudyRunServiceDeps = {
    store,
    research: {
      getConfig: async () => state.config,
      getPackageById: async (id: ObjectId) => (state.pkg && state.pkg._id?.equals(id) ? state.pkg : null),
      getContentById: async () => ({ status: state.contentPublished ? 'PUBLISHED' : 'DRAFT', locked: state.contentPublished }) as never,
      getQuestionSetById: async () => ({ status: state.questionsPublished ? 'PUBLISHED' : 'DRAFT', locked: state.questionsPublished }) as never,
      addAudit: async () => undefined
    },
    packages: { verifyPackage: async () => [...state.problems] },
    audit: { record: async (input) => { audits.push(input); } },
    capabilities: options.capabilities ?? ALL_CAPABILITIES
  };
  return { service: new StudyRunService(deps), store, audits, state, packageId, deps };
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
