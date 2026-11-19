import { GET as canonicalGet, POST as canonicalPost } from '@/app/api/admin/config/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/config. Same handlers (shared config service), plus deprecation headers. */
export const GET = deprecatedAlias(canonicalGet, '/api/admin/config');
export const POST = deprecatedAlias(canonicalPost, '/api/admin/config');
