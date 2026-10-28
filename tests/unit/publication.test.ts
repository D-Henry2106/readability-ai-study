import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { ReadinessService } from '@/lib/services/readiness.service';
import { contentHash } from '@/lib/experiment/content-integrity';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
const contentId=new ObjectId(),questionsId=new ObjectId(),pkgId=new ObjectId();
const content={ _id:contentId,phase:'MAIN',status:'PUBLISHED',rawContent:'An approved reading source.',contentHash:contentHash('An approved reading source.') };
const questions={_id:questionsId,phase:'MAIN',status:'PUBLISHED',label:'Five questions',questions:Array.from({length:5},(_,i)=>({id:`q${i}`,prompt:`Question ${i}`, options:Array.from({length:4},(_,j)=>({id:`a${j}`,text:`Option ${j}`,isCorrect:j===0}))}))};
const fake=(published:boolean)=>({
  getConfig:async()=>({phase:'MAIN',studyPublished:published,assignmentMode:'FIXED',informationText:'Study info',informationVersion:'1',consentText:'Consent',consentVersion:'1',debriefText:'Debrief',debriefVersion:'1',dataRightsText:'Rights',findingsText:'Findings',minimumReadingSeconds:30}),
  listEligiblePackages:async()=>[{_id:pkgId,code:'TEST',title:'Test',topic:'AI',phase:'MAIN',status:'PUBLISHED',enabled:true,contentRevisionId:contentId,questionSetId:questionsId}],
  getContentById:async()=>content,getQuestionSetById:async()=>questions
} as unknown as ResearchRepository);
describe('study publication readiness',()=>{
  it('blocks unpublished study despite valid package',async()=>{
    const result=await new ReadinessService(fake(false)).check();
    expect(result.ready).toBe(false);expect(result.missing).toContain('STUDY_NOT_PUBLISHED');
  });
  it('distinguishes publication gate from valid prerequisites',async()=>{
    const result=await new ReadinessService(fake(false)).check({ignorePublication:true});
    expect(result.ready).toBe(true);
  });
});
