import type { Collection } from 'mongodb';
import { getDb } from './mongodb';
import type {
  AdminAuditDoc,
  AdminDoc,
  BreakDoc,
  ConsentDoc,
  ContentRevisionDoc,
  ContentPackageDoc,
  DemographicsDoc,
  ExperimentConfigDoc,
  ExperimentEventDoc,
  QuestionSetDoc,
  ReadingSessionDoc,
  SessionDoc,
  TestAttemptDoc
} from '@/types/research';

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
  experimentConfig: Collection<ExperimentConfigDoc>;
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
    experimentConfig: db.collection<ExperimentConfigDoc>('experiment_config')
  };
}
