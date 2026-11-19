import { GET as canonicalGet, POST as canonicalPost } from '@/app/api/admin/packages/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/packages. Same handlers (shared package service), plus deprecation headers. */
export const GET = deprecatedAlias(canonicalGet, '/api/admin/packages');
export const POST = deprecatedAlias(canonicalPost, '/api/admin/packages');
