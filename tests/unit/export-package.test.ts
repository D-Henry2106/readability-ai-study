import { describe, expect, it } from 'vitest';
import { ExportService } from '@/lib/services/export.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
describe('CSV package metadata',()=>{
 it('exports stable package dimension column names without fake rows',async()=>{
   const repo={listAllSessionsForExport:async()=>[]} as unknown as ResearchRepository;
   const out=await new ExportService(repo).wide('PILOT');
   expect(out).toContain('package_id');
   expect(out).toContain('package_revision');
   expect(out).toContain('package_topic');
   expect(out.split('\n')).toHaveLength(1);
 });
});
