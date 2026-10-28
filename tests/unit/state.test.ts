import { describe, expect, it } from 'vitest';
import { ExperimentStateService } from '@/lib/services/state.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
import type { SessionDoc } from '@/types/research';
import { ObjectId } from 'mongodb';
const session: SessionDoc = { id:'s', status:'ACTIVE', currentStage:'READING_1', groupCode:'A', contentRevisionId:new ObjectId(), questionSetId:new ObjectId(), informationVersion:'1',consentVersion:'1',debriefVersion:'1',phase:'MAIN',deviceType:'desktop',validityFlag:'REVIEW_REQUIRED',validityReason:null,createdAt:new Date(),updatedAt:new Date(),completedAt:null,withdrawnAt:null };
describe('state machine', () => {
  it('maps stage to canonical route', () => expect(new ExperimentStateService({} as ResearchRepository).routeFor(session)).toBe('/experiment/reading'));
  it('maps review stage to the pre-question review route', () => {
    const reviewSession = { ...session, currentStage: 'REVIEW_1' as const };
    expect(new ExperimentStateService({} as ResearchRepository).routeFor(reviewSession)).toBe('/experiment/review');
  });
  it('blocks unexpected stages', async () => { const repo={ getSession: async()=>session } as unknown as ResearchRepository; await expect(new ExperimentStateService(repo).requireStage('s','TEST_1')).rejects.toThrow('INVALID_STAGE:/experiment/reading'); });
});
