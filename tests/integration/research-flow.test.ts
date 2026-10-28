import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ensureIndexes } from '@/lib/db/indexes';
import { SessionService } from '@/lib/services/session.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ContentService } from '@/lib/services/content.service';
import { ExportService } from '@/lib/services/export.service';

describe('MongoDB integration flow', () => {
  beforeEach(async () => { await resetAndSeedReady(); await ensureIndexes(); });

  it('creates one anonymous research session pinned to published revisions', async () => {
    const session = await new SessionService().create('desktop');
    expect(session.currentStage).toBe('INFORMATION');
    expect(session.groupCode).toBeNull();
    expect(session.contentRevisionId).toBeInstanceOf(ObjectId);
  });

  it('persists consent and demographics with unique session indexes', async () => {
    const repo = new ResearchRepository();
    const session = await new SessionService(repo).create('desktop');
    await repo.saveConsent({sessionId:session.id,informationVersion:session.informationVersion,consentVersion:session.consentVersion,decision:'ACCEPTED',decidedAt:new Date()});
    await repo.saveConsent({sessionId:session.id,informationVersion:session.informationVersion,consentVersion:session.consentVersion,decision:'ACCEPTED',decidedAt:new Date()});
    await repo.saveDemographics({sessionId:session.id,ageRange:'21–24',gender:null,fieldOfStudy:null,yearOfStudy:null,aiUsageFrequency:null,onlineReadingFrequency:null,submittedAt:new Date()});
    expect((await withTestDb(db=>db.collection('consents').countDocuments({sessionId:session.id})))).toBe(1);
    expect((await withTestDb(db=>db.collection('demographics').countDocuments({sessionId:session.id})))).toBe(1);
  });

  it('makes test submissions idempotent under duplicate inserts', async () => {
    const repo = new ResearchRepository();
    const session = await new SessionService(repo).create('desktop');
    const q = await repo.getQuestionSetById(session.questionSetId);
    expect(q?._id).toBeTruthy();
    const attempt = { sessionId:session.id, roundNo:1 as const, presentation:'V1' as const, questionSetId:q!._id!, answers:[], score:0, startedAt:new Date(), submittedAt:new Date() };
    expect(await repo.insertTestAttempt(attempt)).toBe(true);
    expect(await repo.insertTestAttempt(attempt)).toBe(false);
  });

  it('prevents mutation of published content revisions', async () => {
    const repo = new ResearchRepository();
    const published = await repo.getPublishedContent('MAIN');
    expect(published?._id).toBeTruthy();
    const updated = await new ContentService(repo).updateDraft(published!._id!.toHexString(), {topicLabel:'changed',rawContent:'changed'});
    expect(updated).toBeNull();
  });

  it('exports real rows and preserves missing values as blank', async () => {
    const repo = new ResearchRepository();
    await new SessionService(repo).create('desktop');
    const csv = await new ExportService(repo).wide('MAIN');
    expect(csv.split('\n').length).toBeGreaterThan(1);
    expect(csv).not.toContain('undefined');
  });
});
