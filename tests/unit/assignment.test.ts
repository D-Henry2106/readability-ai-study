import { describe, expect, it } from 'vitest';
import { AssignmentService } from '@/lib/services/assignment.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
describe('group assignment', () => {
  it('fills the smaller group', async () => { const repo={ countGroups: async()=>({A:2,B:3}) } as unknown as ResearchRepository; expect(await new AssignmentService(repo).chooseGroup('MAIN')).toBe('A'); });
  it('returns one valid group when balanced', async () => { const repo={ countGroups: async()=>({A:2,B:2}) } as unknown as ResearchRepository; expect(['A','B']).toContain(await new AssignmentService(repo).chooseGroup('MAIN')); });
});
