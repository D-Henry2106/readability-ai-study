import { ObjectId } from 'mongodb';
import type { InvitationAdminStore, InvitationRedemptionStore } from '@/lib/repositories/invitation.repository';
import { InvitationService } from '@/lib/services/invitation.service';
import { InvitationRedemptionService } from '@/lib/services/invitation-redemption.service';
import { RunSessionService } from '@/lib/services/run-session.service';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';
import type { InvitationDoc, InvitationRecovery } from '@/types/invitation';
import type { SessionDoc } from '@/types/research';
import { ALL_CAPABILITIES, makeHarness, RESEARCHER } from './study-run-fakes';

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

/** In-memory invitation store with the same CAS semantics as the MongoDB repositories. `writes` records every mutation kind. */
export class FakeInvitationStore implements InvitationAdminStore, InvitationRedemptionStore {
  readonly docs = new Map<string, InvitationDoc>();
  readonly writes: string[] = [];
  async insertMany(docs: InvitationDoc[]) {
    for (const d of docs) {
      for (const e of this.docs.values()) if (e.tokenHash === d.tokenHash) throw Object.assign(new Error('dup'), { code: 11000 });
      this.docs.set(d._id!.toHexString(), clone(d));
    }
    this.writes.push('insertMany');
  }
  async getById(id: ObjectId) { const d = this.docs.get(id.toHexString()); return d ? clone(d) : null; }
  async findById(id: ObjectId) { return this.getById(id); }
  async findByTokenHash(tokenHash: string) { for (const d of this.docs.values()) if (d.tokenHash === tokenHash) return clone(d); return null; }
  async listByRun(studyRunId: ObjectId) { return [...this.docs.values()].filter((d) => d.studyRunId.equals(studyRunId)).map(clone); }
  async revokeIfIssued(id: ObjectId, by: string, reason: string, at: Date) {
    const d = this.docs.get(id.toHexString());
    if (!d || d.status !== 'ISSUED') return null;
    Object.assign(d, { status: 'REVOKED', revokedAt: at, revokedBy: by, revokedReason: reason });
    this.writes.push('revokeIfIssued');
    return clone(d);
  }
  async claimIssued(id: ObjectId, sessionId: string, at: Date) {
    const d = this.docs.get(id.toHexString());
    if (!d || d.status !== 'ISSUED') return null;
    Object.assign(d, { status: 'REDEEMED', sessionId, redeemedAt: at });
    this.writes.push('claimIssued');
    return clone(d);
  }
  async authorizeRecovery(id: ObjectId, recovery: InvitationRecovery, now: Date) {
    const d = this.docs.get(id.toHexString());
    if (!d || d.status !== 'REDEEMED') return null;
    const r = d.recovery;
    const usable = r && !r.consumedAt && !r.cancelledAt && r.expiresAt.getTime() > now.getTime();
    if (usable) return null;
    d.recovery = clone(recovery);
    this.writes.push('authorizeRecovery');
    return clone(d);
  }
  async cancelRecovery(id: ObjectId, at: Date) {
    const d = this.docs.get(id.toHexString());
    if (!d || d.status !== 'REDEEMED' || !d.recovery || d.recovery.consumedAt || d.recovery.cancelledAt) return null;
    d.recovery.cancelledAt = at;
    this.writes.push('cancelRecovery');
    return clone(d);
  }
  async consumeRecovery(id: ObjectId, now: Date) {
    const d = this.docs.get(id.toHexString());
    const r = d?.recovery;
    if (!d || d.status !== 'REDEEMED' || !r || r.consumedAt || r.cancelledAt || r.expiresAt.getTime() <= now.getTime()) return null;
    r.consumedAt = now;
    this.writes.push('consumeRecovery');
    return clone(d);
  }
}

/** Run-aware research fake: sessions with the same unique-id behaviour as the real `sessions` collection. */
export function makeRedeemHarness(options: { failFirstSessionInsert?: boolean } = {}) {
  const base = makeHarness({ capabilities: ALL_CAPABILITIES });
  const sessions = new Map<string, SessionDoc>();
  const events: Array<{ sessionId: string; type: string }> = [];
  const clock = { now: new Date('2026-11-10T08:00:00Z') };
  const flags = { failNextInsert: options.failFirstSessionInsert ?? false, insertAttempts: 0 };
  const research = {
    ...base.deps.research!,
    getSession: async (id: string) => { const s = sessions.get(id); return s ? clone(s) : null; },
    createSession: async (s: SessionDoc) => {
      flags.insertAttempts += 1;
      if (flags.failNextInsert) { flags.failNextInsert = false; throw new Error('transient write failure'); }
      if (sessions.has(s.id)) throw Object.assign(new Error('dup'), { code: 11000 });
      sessions.set(s.id, clone(s));
    }
  };
  const invitations = new FakeInvitationStore();
  const now = () => new Date(clock.now.getTime());
  const runSessions = new RunSessionService({ research, events: { add: async (sessionId, type) => { events.push({ sessionId, type }); } }, now });
  const redemption = () => new InvitationRedemptionService({
    invitations, runs: base.store, research, runSessions, audit: base.deps.audit, now,
    routeFor: (s) => (s.status === 'ACTIVE' ? `/stage/${s.currentStage}` : '/ended')
  });
  const admin = new InvitationService({
    invitations,
    runs: base.store,
    profiles: base.profiles,
    research,
    audit: base.deps.audit,
    baseUrl: () => 'https://study.example',
    now
  });

  /** A run that is fully confirmed (including its V2 presentation profile) and OPEN, ready to be redeemed against. */
  async function openRun(): Promise<{ runId: string; runVersion: number; profileId: string }> {
    let run = (await base.service.create(RESEARCHER, { code: 'RUN-01', name: 'Run 01', phase: 'MAIN', packageId: base.packageId.toHexString(), targetSampleSize: 30 })).run;
    const id = run._id!.toHexString();
    run = (await base.service.confirmQuota(RESEARCHER, id, { expectedVersion: run.version, quotaPerArm: 15 })).run;
    run = (await base.service.confirmEntryPolicy(RESEARCHER, id, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
    run = (await base.service.confirmInfoConsentReview(RESEARCHER, id, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
    const profile = await base.confirmDefaultProfile();
    run = (await base.service.confirmPresentationProfile(RESEARCHER, id, { expectedVersion: run.version, profileId: profile._id!.toHexString() })).run;
    run = (await base.service.transition(RESEARCHER, id, { expectedVersion: run.version, to: 'OPEN' })).run;
    return { runId: id, runVersion: run.version, profileId: profile._id!.toHexString() };
  }
  async function setRunStatus(runId: string, to: 'PAUSED' | 'CLOSED' | 'OPEN') {
    const run = (await base.service.get(RESEARCHER, runId));
    return base.service.transition(RESEARCHER, runId, { expectedVersion: run.version, to, reason: 'test' });
  }
  async function issue(runId: string, variant: 'V1' | 'V2' = 'V1', count = 1) {
    return (await admin.create(RESEARCHER, { studyRunId: runId, variant, count })).issued;
  }
  return { ...base, sessions, events, clock, flags, research, invitations, runSessions, redemption, admin, openRun, setRunStatus, issue };
}

export async function expectCode(work: Promise<unknown>, code: string, status?: number): Promise<void> {
  try { await work; } catch (error) {
    const e = error as { code?: string; status?: number; message?: string };
    const got = e.code ?? e.message;
    if (got !== code || (status !== undefined && e.status !== status)) throw new Error(`Expected ${code}${status ? `/${status}` : ''} but got ${got}/${e.status}`);
    return;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}
export const DEVICE = 'desktop' as const;
