import { describe, expect, it } from 'vitest';
import { ExportService } from '@/lib/services/export.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';

// Parses one CSV line: cells are double-quoted ("" is an escaped quote); a missing value is an empty, unquoted cell.
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const id = (hex: string) => ({ toHexString: () => hex, toString: () => hex });
const session = {
  id: 's1', participantId: 'p1', phase: 'MAIN', groupCode: null, invitationId: id('inv1'), studyRunId: id('run1'),
  presentationVariant: 'V1', presentationVersion: null, questionSetId: id('qs1'), questionSetRevision: 1,
  assignedPackageId: id('pkg1'), assignedPackageCode: 'PKG', assignedPackageRevision: 1, assignedPackageTopic: 'Topic',
  contentRevisionId: id('c1'), status: 'COMPLETED', validityFlag: 'VALID', validityReason: null, deviceType: 'desktop',
  createdAt: new Date('2026-01-01T00:00:00Z'), completedAt: new Date('2026-01-01T00:10:00Z')
};
const bundle = {
  readings: [{ roundNo: 1, presentation: 'V1', readingSeconds: 60, scrollCount: 3, maxScrollDepthPercent: 100 }],
  tests: [{ roundNo: 1, presentation: 'V1', score: 12, answers: [] }],
  demographics: { ageRange: '21–24', gender: 'Nữ', fieldOfStudy: 'CNTT', yearOfStudy: 'Năm 3', aiUsageFrequency: 'Hằng ngày', onlineReadingFrequency: 'Hằng ngày' }
};
const repo = {
  listAllSessionsForExport: async () => [session],
  getSessionBundle: async () => bundle
} as unknown as ResearchRepository;

describe('exports no longer contain the age column', () => {
  for (const format of ['run', 'wide'] as const) {
    it(`${format}: no age header, no age value, and header and row stay aligned`, async () => {
      const csv = await new ExportService(repo)[format]('MAIN');
      const [header, row] = csv.split('\n');
      expect(header).not.toContain('age_range');
      expect(csv).not.toContain('21–24');
      expect(cells(row)).toHaveLength(cells(header).length);
      const col = (name: string) => cells(row)[cells(header).indexOf(name)];
      expect(col('gender')).toBe('Nữ');
      expect(col('field_of_study')).toBe('CNTT');
      expect(col('year_of_study')).toBe('Năm 3');
      expect(col('ai_usage_frequency')).toBe('Hằng ngày');
      expect(col('online_reading_frequency')).toBe('Hằng ngày');
    });
  }
});
