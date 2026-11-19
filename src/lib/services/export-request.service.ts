import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExportService } from './export.service';
import { AuditService } from './audit.service';
import { parseResearchFilters } from './research-filters';
import { jsonError } from '@/lib/http';
import type { StudyPhase } from '@/types/research';

/** Shared by both legacy and /api/admin/export URLs. */
export async function exportResearchCsv(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const params = request.nextUrl.searchParams;
    const formatValue = params.get('format');
    const format = (['wide', 'long', 'paired', 'questions', 'events', 'run'] as const).find(f => f === formatValue) ?? 'wide';
    const phaseValue = params.get('phase');
    const requestedPhase: StudyPhase | undefined = phaseValue === 'PILOT' || phaseValue === 'MAIN' ? phaseValue : undefined;
    const filters = parseResearchFilters(Object.fromEntries(params));
    // Never silently broaden an export if the user supplied an invalid filter.
    if ((params.has('phase') && !requestedPhase) ||
        (params.has('variant') && params.get('variant') !== '' && !filters.variant) ||
        (params.has('group') && params.get('group') !== '' && !filters.group) ||
        (params.has('package') && params.get('package') !== '' && !filters.packageCode) ||
        (params.has('revision') && params.get('revision') !== '' && !filters.revision) ||
        (params.has('studyRunId') && params.get('studyRunId') !== '' && !filters.studyRunId)) {
      return NextResponse.json({ error: 'Bộ lọc xuất dữ liệu không hợp lệ.' }, { status: 400 });
    }
    const repo = new ResearchRepository();
    // Same default as the dashboard and statistics: no phase means the configured phase, never PILOT+MAIN mixed.
    const phase: StudyPhase = requestedPhase ?? (await repo.getConfig()).phase;
    const service = new ExportService(repo);
    const csv = await service[format](phase, filters);
    await new AuditService(repo).record({ username: admin.username, role: admin.role, action: 'DATA_EXPORTED', targetType: 'csv',
      metadata: { format, phase, group: filters.group ?? null,
        packageCode: filters.packageCode ?? null, revision: filters.revision ?? null, variant: filters.variant ?? null, studyRunId: filters.studyRunId ?? null } });
    // The BOM makes Excel read the file as UTF-8, so non-English answers are not garbled.
    return new NextResponse(`\uFEFF${csv}`, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="research-${phase.toLowerCase()}-${format}${filters.variant ? `-${filters.variant}` : ''}.csv"`,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
    } });
  } catch (error) { return jsonError(error); }
}
