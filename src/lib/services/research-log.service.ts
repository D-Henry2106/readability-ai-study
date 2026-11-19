import { ObjectId, type Filter } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { ExportService } from './export.service';
import type { Presentation, SessionDoc, StudyPhase } from '@/types/research';

export interface LogFilters {
  phase: StudyPhase;
  participant?: string;
  session?: string;
  variant?: Presentation;
  /** Reading package code (the "task" a participant was given). */
  task?: string;
  run?: string;
  eventType?: string;
}

export const LOG_PAGE_SIZE = 50;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sessionQuery(f: LogFilters): Filter<SessionDoc> {
  const q: Filter<SessionDoc> = { phase: f.phase };
  if (f.participant) q.participantId = { $regex: `^${escapeRegex(f.participant)}`, $options: 'i' };
  if (f.session) q.id = { $regex: `^${escapeRegex(f.session)}`, $options: 'i' };
  if (f.variant) q.presentationVariant = f.variant;
  if (f.task) q.assignedPackageCode = f.task.trim().toUpperCase();
  if (f.run && /^[0-9a-fA-F]{24}$/.test(f.run)) q.studyRunId = new ObjectId(f.run);
  return q;
}

export interface EventLogRow {
  id: string;
  at: Date;
  sessionId: string;
  participantId: string | null;
  variant: string | null;
  task: string | null;
  type: string;
  stage: string | null;
}
export interface ResultLogRow {
  sessionId: string;
  participantId: string | null;
  variant: string | null;
  task: string | null;
  status: string;
  validity: string;
  readStart: Date | null;
  readEnd: Date | null;
  readingSeconds: number | null;
  testSubmittedAt: Date | null;
  score: number | null;
  scoreMax: number | null;
}

export interface Mismatch {
  sessionId: string;
  field: string;
  system: string;
  exported: string;
}
export interface ReconcileReport {
  scope: string;
  systemSessions: number;
  exportRows: number;
  completedSessions: number;
  mismatches: Mismatch[];
  scoreRecalcMismatches: string[];
  timeOrderIssues: string[];
  incompleteEventTrails: Array<{ sessionId: string; missing: string[] }>;
}

/** Quote-aware CSV reader, used only to read back what ExportService wrote. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const REQUIRED_EVENTS = ['SESSION_STARTED', 'READING_STARTED', 'READING_FINISHED', 'TEST_SUBMITTED', 'SESSION_COMPLETED'];
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : '');

/** Read-only views for the Research Logs page. Nothing here writes data. */
export class ResearchLogService {
  async events(f: LogFilters, page: number): Promise<{ rows: EventLogRow[]; total: number }> {
    const c = await collections();
    const sessions = await c.sessions.find(sessionQuery(f)).limit(5000).toArray();
    if (!sessions.length) return { rows: [], total: 0 };
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const filter = { sessionId: { $in: [...byId.keys()] }, ...(f.eventType ? { type: f.eventType as never } : {}) };
    const [docs, total] = await Promise.all([
      c.experimentEvents.find(filter).sort({ createdAt: -1 }).skip((page - 1) * LOG_PAGE_SIZE).limit(LOG_PAGE_SIZE).toArray(),
      c.experimentEvents.countDocuments(filter)
    ]);
    return {
      total,
      rows: docs.map((e) => {
        const s = byId.get(e.sessionId);
        return {
          id: String(e._id), at: e.createdAt, sessionId: e.sessionId, participantId: s?.participantId ?? null,
          variant: s?.presentationVariant ?? null, task: s?.assignedPackageCode ?? null, type: e.type, stage: e.stage ?? null
        };
      })
    };
  }

  async results(f: LogFilters, page: number): Promise<{ rows: ResultLogRow[]; total: number }> {
    const c = await collections();
    const query = sessionQuery(f);
    const [sessions, total] = await Promise.all([
      c.sessions.find(query).sort({ createdAt: -1 }).skip((page - 1) * LOG_PAGE_SIZE).limit(LOG_PAGE_SIZE).toArray(),
      c.sessions.countDocuments(query)
    ]);
    const ids = sessions.map((s) => s.id);
    const [readings, tests] = ids.length
      ? await Promise.all([c.readingSessions.find({ sessionId: { $in: ids } }).toArray(), c.testAttempts.find({ sessionId: { $in: ids } }).toArray()])
      : [[], []];
    return {
      total,
      rows: sessions.map((s) => {
        const r = readings.find((x) => x.sessionId === s.id && x.roundNo === 1) ?? readings.find((x) => x.sessionId === s.id);
        const t = tests.find((x) => x.sessionId === s.id && x.roundNo === 1) ?? tests.find((x) => x.sessionId === s.id);
        return {
          sessionId: s.id, participantId: s.participantId ?? null, variant: s.presentationVariant ?? null, task: s.assignedPackageCode ?? null,
          status: s.status, validity: s.validityFlag, readStart: r?.startedAt ?? null, readEnd: r?.finishedAt ?? null,
          readingSeconds: r?.readingSeconds ?? null, testSubmittedAt: t?.submittedAt ?? null, score: t?.score ?? null, scoreMax: t?.answers.length ?? null
        };
      })
    };
  }

  /**
   * Compares the run export file with the stored data, field by field, and checks the event trail.
   * Only participants of a Study Run are compared, because the run export only contains those.
   */
  async reconcile(f: LogFilters): Promise<ReconcileReport> {
    const c = await collections();
    const query = { ...sessionQuery({ phase: f.phase, variant: f.variant, task: f.task, run: f.run }), studyRunId: f.run && /^[0-9a-fA-F]{24}$/.test(f.run) ? new ObjectId(f.run) : { $exists: true } } as Filter<SessionDoc>;
    const sessions = await c.sessions.find(query).sort({ createdAt: 1 }).toArray();
    const ids = sessions.map((s) => s.id);
    const [readings, tests, events] = ids.length
      ? await Promise.all([
          c.readingSessions.find({ sessionId: { $in: ids } }).toArray(),
          c.testAttempts.find({ sessionId: { $in: ids } }).toArray(),
          c.experimentEvents.find({ sessionId: { $in: ids } }).toArray()
        ])
      : [[], [], []];

    const csv = await new ExportService().run(f.phase, { variant: f.variant, packageCode: f.task?.trim().toUpperCase(), studyRunId: f.run && /^[0-9a-fA-F]{24}$/.test(f.run) ? f.run : undefined });
    const table = parseCsv(csv);
    const header = table[0] ?? [];
    const col = (name: string) => header.indexOf(name);
    const exported = new Map(table.slice(1).map((r) => [r[col('session_id')], r]));

    const mismatches: Mismatch[] = [];
    const scoreRecalcMismatches: string[] = [];
    const timeOrderIssues: string[] = [];
    const incompleteEventTrails: ReconcileReport['incompleteEventTrails'] = [];
    const check = (sessionId: string, field: string, system: string, row: string[]) => {
      const idx = col(field);
      const value = idx < 0 ? '(không có cột)' : (row[idx] ?? '');
      if (value !== system) mismatches.push({ sessionId, field, system: system || '(trống)', exported: value || '(trống)' });
    };

    for (const s of sessions) {
      const row = exported.get(s.id);
      const r = readings.find((x) => x.sessionId === s.id && x.roundNo === 1);
      const t = tests.find((x) => x.sessionId === s.id && x.roundNo === 1);
      if (!row) { mismatches.push({ sessionId: s.id, field: 'session_id', system: 'có trong hệ thống', exported: 'thiếu trong file xuất' }); }
      else {
        check(s.id, 'variant', s.presentationVariant ?? '', row);
        check(s.id, 'status', s.status, row);
        check(s.id, 'validity', s.validityFlag, row);
        check(s.id, 'score', t ? String(t.score) : '', row);
        check(s.id, 'score_max', t ? String(t.answers.length) : '', row);
        check(s.id, 'read_start', iso(r?.startedAt), row);
        check(s.id, 'read_end', iso(r?.finishedAt), row);
        check(s.id, 'test_submitted_at', iso(t?.submittedAt), row);
      }
      if (t) {
        const recalculated = t.answers.filter((a) => a.isCorrect === true).length;
        if (recalculated !== t.score) scoreRecalcMismatches.push(`${s.id}: điểm lưu ${t.score}, tính lại từ câu trả lời ${recalculated}`);
      }
      if (s.status === 'COMPLETED' && r?.finishedAt && t?.submittedAt) {
        if (new Date(r.startedAt) > new Date(r.finishedAt)) timeOrderIssues.push(`${s.id}: bắt đầu đọc muộn hơn kết thúc đọc`);
        else if (new Date(r.finishedAt) > new Date(t.submittedAt)) timeOrderIssues.push(`${s.id}: kết thúc đọc muộn hơn lúc nộp bài`);
      } else if (s.status === 'COMPLETED') timeOrderIssues.push(`${s.id}: phiên đã hoàn thành nhưng thiếu mốc thời gian đọc hoặc nộp bài`);
      if (s.status === 'COMPLETED') {
        const have = new Set(events.filter((e) => e.sessionId === s.id).map((e) => e.type));
        const missing = REQUIRED_EVENTS.filter((e) => !have.has(e as never));
        if (missing.length) incompleteEventTrails.push({ sessionId: s.id, missing });
      }
    }
    const extra = [...exported.keys()].filter((id) => !ids.includes(id));
    for (const id of extra) mismatches.push({ sessionId: id, field: 'session_id', system: 'không có trong hệ thống', exported: 'có trong file xuất' });

    return {
      scope: `${f.phase}${f.variant ? ` · ${f.variant}` : ''}${f.task ? ` · ${f.task.toUpperCase()}` : ''}`,
      systemSessions: sessions.length,
      exportRows: Math.max(0, table.length - 1),
      completedSessions: sessions.filter((s) => s.status === 'COMPLETED').length,
      mismatches, scoreRecalcMismatches, timeOrderIssues, incompleteEventTrails
    };
  }
}
