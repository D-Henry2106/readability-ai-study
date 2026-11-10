import type { GroupCode, SessionStatus, StudyPhase, ValidityFlag } from '@/types/research';

export type ResearchFilters = { group?: GroupCode; packageCode?: string; revision?: number };
/** One parser for the statistics dashboard and every CSV entrypoint. */
export function parseResearchFilters(query: { group?: string; package?: string; revision?: string }): ResearchFilters {
  const revision = query.revision && /^[1-9][0-9]*$/.test(query.revision) ? Number(query.revision) : undefined;
  return {
    group: query.group === 'A' || query.group === 'B' ? query.group : undefined,
    packageCode: query.package && /^[A-Za-z0-9_-]{2,40}$/.test(query.package) ? query.package.toUpperCase() : undefined,
    revision: revision !== undefined && Number.isSafeInteger(revision) ? revision : undefined
  };
}

const SESSION_STATUSES: readonly SessionStatus[] = ['ACTIVE', 'COMPLETED', 'WITHDRAWN', 'DECLINED', 'INCOMPLETE'];
const VALIDITY_FLAGS: readonly ValidityFlag[] = ['VALID', 'INVALID', 'REVIEW_REQUIRED'];

export type SessionListQuery = ResearchFilters & {
  page: number;
  pageSize: number;
  search?: string;
  status?: SessionStatus;
  validityFlag?: ValidityFlag;
  groupCode?: GroupCode;
  phase: StudyPhase;
  sort: 'newest' | 'oldest';
};

/**
 * Parser for session-list endpoints. Reuses parseResearchFilters so group/package/revision mean
 * exactly the same thing as on the statistics page and in every CSV export. An empty string means
 * "not supplied"; a supplied-but-invalid value is rejected instead of silently broadening the list.
 */
export function parseSessionListQuery(
  query: Record<string, string | undefined>,
  defaultPhase: StudyPhase
): { ok: true; value: SessionListQuery } | { ok: false; error: string } {
  const get = (key: string) => (query[key] === undefined || query[key] === '' ? undefined : query[key]);
  const invalid = { ok: false as const, error: 'Bộ lọc không hợp lệ.' };
  const filters = parseResearchFilters({ group: get('group'), package: get('package'), revision: get('revision') });
  if ((get('group') && !filters.group) || (get('package') && !filters.packageCode) || (get('revision') && !filters.revision)) return invalid;

  const phaseRaw = get('phase');
  if (phaseRaw !== undefined && phaseRaw !== 'PILOT' && phaseRaw !== 'MAIN') return invalid;
  const statusRaw = get('status');
  if (statusRaw !== undefined && !SESSION_STATUSES.includes(statusRaw as SessionStatus)) return invalid;
  const validityRaw = get('validity');
  if (validityRaw !== undefined && !VALIDITY_FLAGS.includes(validityRaw as ValidityFlag)) return invalid;
  const pageRaw = get('page') ?? '1';
  const sizeRaw = get('pageSize') ?? '25';
  if (!/^[1-9][0-9]{0,5}$/.test(pageRaw) || !/^[1-9][0-9]{0,3}$/.test(sizeRaw)) return invalid;
  const search = get('search')?.trim();
  if (search && search.length > 100) return invalid;

  return { ok: true, value: {
    ...filters,
    groupCode: filters.group,
    page: Number(pageRaw),
    pageSize: Math.min(100, Number(sizeRaw)),
    search: search || undefined,
    status: statusRaw as SessionStatus | undefined,
    validityFlag: validityRaw as ValidityFlag | undefined,
    phase: (phaseRaw as StudyPhase | undefined) ?? defaultPhase,
    sort: get('sort') === 'oldest' ? 'oldest' : 'newest'
  } };
}
