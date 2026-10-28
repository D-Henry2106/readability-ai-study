import type { GroupCode } from '@/types/research';

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
