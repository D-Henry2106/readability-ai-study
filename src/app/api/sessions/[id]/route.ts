import { GET as canonicalGet } from '@/app/api/admin/sessions/[id]/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/sessions/[id]. Same handler, plus deprecation headers. */
export const GET = deprecatedAlias(canonicalGet, '/api/admin/sessions');
