import { MongoClient, ObjectId } from 'mongodb';
import { requireTestMongoUri } from './test-mongo-env';
import { contentHash } from '@/lib/experiment/content-integrity';


export async function withTestDb<T>(work: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const { uri } = requireTestMongoUri();
  const client = new MongoClient(uri);
  try { await client.connect(); return await work(client.db()); } finally { await client.close(); }
}

export async function resetAndSeedReady(options?: { existingGroup?: 'A' | 'B' }) {
  return withTestDb(async db => {
    await db.dropDatabase();
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
    await Promise.all([
      db.collection('sessions').createIndex({id:1},{unique:true}),
      db.collection('consents').createIndex({sessionId:1},{unique:true}),
      db.collection('demographics').createIndex({sessionId:1},{unique:true}),
      db.collection('reading_sessions').createIndex({sessionId:1,roundNo:1},{unique:true}),
      db.collection('test_attempts').createIndex({sessionId:1,roundNo:1},{unique:true}),
      db.collection('breaks').createIndex({sessionId:1},{unique:true}),
      db.collection('admins').createIndex({username:1},{unique:true}),
      db.collection('experiment_config').createIndex({key:1},{unique:true}),
      db.collection('content_packages').createIndex({code:1,revision:1},{unique:true})
    ]);
    return { contentId, questionSetId };
  });
}

export async function getSessionById(id: string) { return withTestDb(db => db.collection('sessions').findOne({ id })); }
export async function getReading(id: string, roundNo: number) { return withTestDb(db => db.collection('reading_sessions').findOne({ sessionId:id, roundNo })); }
export async function countAttempts(id: string, roundNo: number) { return withTestDb(db => db.collection('test_attempts').countDocuments({ sessionId:id, roundNo })); }
export async function expireBreak(id: string) { return withTestDb(db => db.collection('breaks').updateOne({sessionId:id},{$set:{startedAt:new Date(Date.now()-121000)}})); }
