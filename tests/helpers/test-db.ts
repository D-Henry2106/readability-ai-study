import { afterAll } from 'vitest';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { requireTestMongoUri } from './test-mongo-env';
import { contentHash } from '@/lib/experiment/content-integrity';
import { ensureIndexes } from '@/lib/db/indexes';


// One pooled client per worker (a new connection per call made every test several seconds slower under load).
let sharedClient: Promise<MongoClient> | null = null;
function testClient(): Promise<MongoClient> {
  const { uri } = requireTestMongoUri();
  if (!sharedClient) {
    sharedClient = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 }).connect().catch((error) => { sharedClient = null; throw error; });
  }
  return sharedClient;
}
afterAll(async () => {
  const pending = sharedClient;
  sharedClient = null;
  await (await pending?.catch(() => null))?.close().catch(() => undefined);
});

export async function withTestDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return work((await testClient()).db());
}

/** Empties every collection but keeps the indexes: far cheaper than dropDatabase + rebuilding every index per test. */
async function clearDatabase(db: Db): Promise<void> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  await Promise.all(names.map((name) => db.collection(name).deleteMany({})));
}

export async function resetAndSeedReady(options?: { existingGroup?: 'A' | 'B' }) {
  const seeded = await withTestDb(async db => {
    await clearDatabase(db);
    const now = new Date();
    const contentId = new ObjectId();
    const questionSetId = new ObjectId();
    const packageId = new ObjectId();
    await db.collection('experiment_config').insertOne({ key:'active', phase:'MAIN', studyPublished:true, assignmentMode:'FIXED', fixedPackageId:packageId.toHexString(), mainRandomApproved:false, informationText:'Fixture participant information.', informationVersion:'test-info-v1', consentText:'Fixture consent text for automated testing.', consentVersion:'test-consent-v1', debriefText:'Fixture debrief text.', debriefVersion:'test-debrief-v1', dataRightsText:'Fixture data rights text.', findingsText:'Fixture findings information.', minimumReadingSeconds:1, minimumValidTarget:40, recruitmentTarget:60, updatedAt:now });
    await db.collection('content_revisions').insertOne({ _id:contentId, revision:1, topicLabel:'Test fixture', rawContent:'This is fixture experimental content used only in the isolated automated test database.', contentHash:contentHash('This is fixture experimental content used only in the isolated automated test database.'), wordCount:13, status:'PUBLISHED', locked:true, phase:'MAIN', createdAt:now, publishedAt:now });
    await db.collection('question_sets').insertOne({ _id:questionSetId, revision:1, label:'Test fixture', questions:Array.from({length:5},(_,i)=>({id:`q${i+1}`,prompt:`Fixture question ${i+1}?`,options:Array.from({length:4},(_,j)=>({id:`q${i+1}o${j+1}`,text:`Fixture option ${j+1}`,isCorrect:j===0}))})), status:'PUBLISHED', locked:true, phase:'MAIN', createdAt:now, publishedAt:now });
    await db.collection('content_packages').insertOne({_id:packageId,code:'FIXTURE_MAIN',title:'Automated fixture',topic:'AI comprehension',description:'',phase:'MAIN',contentRevisionId:contentId,questionSetId,revision:1,status:'PUBLISHED',enabled:true,aiSource:null,createdAt:now,updatedAt:now,publishedAt:now,archivedAt:null});
    if (options?.existingGroup) {
      await db.collection('sessions').insertOne({ id:`fixture-existing-${options.existingGroup}`, status:'COMPLETED', currentStage:'COMPLETED', groupCode:options.existingGroup, assignedPackageId:packageId, assignedPackageRevision:1, assignedPackageCode:'FIXTURE_MAIN', assignedPackageTopic:'AI comprehension', packageAssignmentMethod:'FIXED', packageAssignedAt:now, contentRevisionId:contentId, questionSetId, informationVersion:'test-info-v1', consentVersion:'test-consent-v1', debriefVersion:'test-debrief-v1', phase:'MAIN', deviceType:'desktop', validityFlag:'VALID', validityReason:null, createdAt:now, updatedAt:now, completedAt:now, withdrawnAt:null });
    }
    return { contentId, questionSetId };
  });
  // Indexes come from the production definition, so every new index is covered by every fixture automatically.
  await ensureIndexes();
  return seeded;
}

export async function getSessionById(id: string) { return withTestDb(db => db.collection('sessions').findOne({ id })); }
export async function getReading(id: string, roundNo: number) { return withTestDb(db => db.collection('reading_sessions').findOne({ sessionId:id, roundNo })); }
export async function countAttempts(id: string, roundNo: number) { return withTestDb(db => db.collection('test_attempts').countDocuments({ sessionId:id, roundNo })); }
export async function expireBreak(id: string) { return withTestDb(db => db.collection('breaks').updateOne({sessionId:id},{$set:{startedAt:new Date(Date.now()-121000)}})); }
