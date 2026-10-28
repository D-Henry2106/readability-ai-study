import { describe, expect, it } from 'vitest';
import { ReadingService } from '@/lib/services/reading.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
import type { ReadingSessionDoc, SessionDoc } from '@/types/research';
import { ObjectId } from 'mongodb';
const session: SessionDoc={id:'s',status:'ACTIVE',currentStage:'READING_1',groupCode:'A',contentRevisionId:new ObjectId(),questionSetId:new ObjectId(),informationVersion:'1',consentVersion:'1',debriefVersion:'1',phase:'MAIN',deviceType:'desktop',validityFlag:'REVIEW_REQUIRED',validityReason:null,createdAt:new Date(),updatedAt:new Date(),completedAt:null,withdrawnAt:null};
describe('reading-time validation', () => {
  it('reports remaining seconds when server minimum is not met', async () => { const reading:ReadingSessionDoc={sessionId:'s',roundNo:1,presentation:'V1',renderedAt:null,nextClickedAt:null,startedAt:new Date(Date.now()-3000),finishedAt:null,readingSeconds:null,scrollCount:0,maxScrollDepthPercent:0}; const repo={ getReading:async()=>reading, getConfig:async()=>({minimumReadingSeconds:10}) } as unknown as ResearchRepository; const result=await new ReadingService(repo).finish(session,{scrollCount:1,maxScrollDepthPercent:50}); expect(result.remainingSeconds).toBeGreaterThan(0); });
});
