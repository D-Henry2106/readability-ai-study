import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { selectPackage, PackageService, validatePresentation } from '@/lib/services/package.service';
import { contentHash } from '@/lib/experiment/content-integrity';
import type { ResearchRepository } from '@/lib/repositories/research.repository';

const contentId=new ObjectId(), qid=new ObjectId(), pkgId=new ObjectId();
const baseQuestions=Array.from({length:5},(_,i)=>({id:`q${i}`,prompt:`Question ${i}`,options:Array.from({length:4},(_,j)=>({id:`o${j}`,text:`Answer ${j}`,isCorrect:j===0}))}));
const pkg={_id:pkgId,code:'AI_01',title:'AI overview',topic:'AI',description:'',phase:'PILOT' as const, contentRevisionId:contentId,questionSetId:qid,status:'PUBLISHED' as const,enabled:true,revision:1,aiSource:null,createdAt:new Date(),updatedAt:new Date(),publishedAt:new Date(),archivedAt:null};
const repo=({
 getContentById:async()=>({_id:contentId,phase:'PILOT',status:'PUBLISHED',rawContent:'The model learns from data.',contentHash:contentHash('The model learns from data.')}),
 getQuestionSetById:async()=>({_id:qid,phase:'PILOT',status:'PUBLISHED',label:'AI overview',questions:baseQuestions}),
 listEligiblePackages:async()=>[pkg], getPackageById:async()=>pkg
} as unknown as ResearchRepository);

describe('content package integrity and assignment',()=>{
 it('V1/V2 keep identical lexical content',()=>{
   expect(validatePresentation('Title. First sentence. Second sentence.')).toBe(true);
 });
 it('rejects random assignment with no eligible packages',()=>{
   expect(()=>selectPackage([], 'RANDOM',null)).toThrow('NO_ELIGIBLE_PACKAGE');
 });
 it('selects configured published package deterministically when fixed',()=>{
   expect(selectPackage([pkg],'FIXED',pkgId.toHexString())).toBe(pkg);
 });
 it('never allows a different fixed package to be assigned',()=>{
   expect(()=>selectPackage([pkg],'FIXED',new ObjectId().toHexString())).toThrow('FIXED_PACKAGE_REQUIRED');
 });
 it('rejects mismatched content and question revisions',async()=>{
   const broken={...repo,getQuestionSetById:async()=>({...(await repo.getQuestionSetById(qid) ?? {}),phase:'MAIN'})} as unknown as ResearchRepository;
   expect(await new PackageService(broken).verifyPackage(pkg)).toContain('INVALID_QUESTIONS');
 });
 it('allows a valid locked package for PILOT',async()=>{
   expect(await new PackageService(repo).eligible('PILOT')).toHaveLength(1);
 });
 it('blocks MAIN random until protocol approval',async()=>{
   await expect(new PackageService(repo).choose({phase:'MAIN',assignmentMode:'RANDOM',mainRandomApproved:false} as never)).rejects.toThrow('MAIN_RANDOM_NOT_APPROVED');
 });
});
