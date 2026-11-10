import { GET as canonicalGet } from '@/app/api/admin/sessions/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/sessions. Same handler, plus deprecation headers. */
export const GET = deprecatedAlias(canonicalGet, '/api/admin/sessions');
