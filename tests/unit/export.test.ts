import { describe, expect, it } from 'vitest';
import { ExportService } from '@/lib/services/export.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
describe('CSV mapping', () => {
  it('empty DB emits header only and no sample row', async () => { const repo={ listAllSessionsForExport:async()=>[] } as unknown as ResearchRepository; const csv=await new ExportService(repo).wide('MAIN'); expect(csv.split('\n')).toHaveLength(1); expect(csv).toContain('session_id'); });
});
