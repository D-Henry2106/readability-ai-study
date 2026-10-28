import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { pairedEvidence } from '@/lib/services/paired-eligibility';
import type { SessionDoc, TestAttemptDoc, ReadingSessionDoc } from '@/types/research';
const date = new Date('2026-01-01T00:00:00Z'); const questionSetId = new ObjectId();
const session: SessionDoc = { id: 'case', status:'COMPLETED', currentStage:'COMPLETED', groupCode:'A', questionSetId, contentRevisionId:new ObjectId(),
  phase:'PILOT',deviceType:'desktop',informationVersion:'1',consentVersion:'1',debriefVersion:'1',validityFlag:'VALID',validityReason:null,validityChecklistVersion:1,
  createdAt:date,updatedAt:date,completedAt:date,withdrawnAt:null };
const tests: TestAttemptDoc[] = ([1,2] as const).map((roundNo,i) => ({ sessionId:'case',roundNo,presentation:i===0?'V1':'V2',questionSetId,
  answers:Array.from({length:5},(_,j)=>({questionId:`q${j}`,selectedOptionId:'a',isCorrect:true})),score:i===0?4:5,startedAt:date,submittedAt:date }));
const readings: ReadingSessionDoc[] = ([1,2] as const).map((roundNo,i) => ({ sessionId:'case',roundNo,presentation:i===0?'V1':'V2',startedAt:date,finishedAt:date,
  renderedAt:date,nextClickedAt:date,readingSeconds:90,scrollCount:2,maxScrollDepthPercent:80 }));
describe('shared paired analysis and export gate', () => {
  it('preserves the +1 historical regression on PILOT', () => expect(pairedEvidence(session,tests,readings)?.difference).toBe(1));
  it('excludes pending review and duplicate Quiz', () => {
    expect(pairedEvidence({...session,validityFlag:'REVIEW_REQUIRED'},tests,readings)).toBeNull();
    expect(pairedEvidence(session,[...tests,tests[0]],readings)).toBeNull();
  });
  it('rejects mismatched question revisions', () => expect(pairedEvidence(session,[{...tests[0],questionSetId:new ObjectId()},tests[1]],readings)).toBeNull());
});
