import { GET as canonicalGet } from '@/app/api/admin/export/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/export. Same handler (shared export service), plus deprecation headers. */
export const GET = deprecatedAlias(canonicalGet, '/api/admin/export');
