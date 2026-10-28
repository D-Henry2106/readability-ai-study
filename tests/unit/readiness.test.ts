import { describe, expect, it } from 'vitest';
import { ReadinessService } from '@/lib/services/readiness.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
describe('experiment readiness', () => {
  it('reports missing approved protocol and published package', async () => {
    const repo={getConfig:async()=>({phase:'MAIN',studyPublished:false, informationText:null,informationVersion:null,consentText:null,consentVersion:null,debriefText:null,debriefVersion:null,dataRightsText:null,findingsText:null,minimumReadingSeconds:null}),listEligiblePackages:async()=>[]} as unknown as ResearchRepository;
    const result=await new ReadinessService(repo).check();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('MINIMUM_READING_TIME');
    expect(result.missing).toContain('PUBLISHED_CONTENT_PACKAGE');
  });
});
