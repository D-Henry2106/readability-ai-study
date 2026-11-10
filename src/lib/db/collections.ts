import type { Collection } from 'mongodb';
import { getDb } from './mongodb';
import type {
  AdminAuditDoc,
  AdminDoc,
  AdminSessionDoc,
  BreakDoc,
  ConsentDoc,
  ContentRevisionDoc,
  ContentPackageDoc,
  DemographicsDoc,
  ExperimentConfigDoc,
  ExperimentEventDoc,
  QuestionSetDoc,
  RateLimitDoc,
  ReadingSessionDoc,
  SessionDoc,
  TestAttemptDoc
} from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';

export async function collections(): Promise<{
  sessions: Collection<SessionDoc>;
  consents: Collection<ConsentDoc>;
  demographics: Collection<DemographicsDoc>;
  contentRevisions: Collection<ContentRevisionDoc>;
  contentPackages: Collection<ContentPackageDoc>;
  questionSets: Collection<QuestionSetDoc>;
  readingSessions: Collection<ReadingSessionDoc>;
  testAttempts: Collection<TestAttemptDoc>;
  breaks: Collection<BreakDoc>;
  experimentEvents: Collection<ExperimentEventDoc>;
  admins: Collection<AdminDoc>;
  adminAudit: Collection<AdminAuditDoc>;
  adminSessions: Collection<AdminSessionDoc>;
  rateLimits: Collection<RateLimitDoc>;
  experimentConfig: Collection<ExperimentConfigDoc>;
  studyRuns: Collection<StudyRunDoc>;
}> {
  const db = await getDb();
  return {
    sessions: db.collection<SessionDoc>('sessions'),
    consents: db.collection<ConsentDoc>('consents'),
    demographics: db.collection<DemographicsDoc>('demographics'),
    contentRevisions: db.collection<ContentRevisionDoc>('content_revisions'),
    contentPackages: db.collection<ContentPackageDoc>('content_packages'),
    questionSets: db.collection<QuestionSetDoc>('question_sets'),
    readingSessions: db.collection<ReadingSessionDoc>('reading_sessions'),
    testAttempts: db.collection<TestAttemptDoc>('test_attempts'),
    breaks: db.collection<BreakDoc>('breaks'),
    experimentEvents: db.collection<ExperimentEventDoc>('experiment_events'),
    admins: db.collection<AdminDoc>('admins'),
    adminAudit: db.collection<AdminAuditDoc>('admin_audit'),
    adminSessions: db.collection<AdminSessionDoc>('admin_sessions'),
    rateLimits: db.collection<RateLimitDoc>('rate_limits'),
    experimentConfig: db.collection<ExperimentConfigDoc>('experiment_config'),
    studyRuns: db.collection<StudyRunDoc>('study_runs')
  };
}
