import { POST as canonicalPost } from '@/app/api/admin/sessions/[id]/validity/route';
import { deprecatedAlias } from '@/lib/http';

/** @deprecated Use /api/admin/sessions/[id]/validity. Same handler (shared validity service), plus deprecation headers. */
export const POST = deprecatedAlias(canonicalPost, '/api/admin/sessions');
