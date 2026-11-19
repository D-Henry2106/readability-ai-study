import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { jsonError } from '@/lib/http';

const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
const actionSchema = z.object({ action: z.enum(['CREATE', 'PREVIEW', 'CONFIRM']) }).passthrough();

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const contentRevisionId = idSchema.parse(request.nextUrl.searchParams.get('contentRevisionId'));
    return NextResponse.json({ profiles: await new PresentationProfileService().listByContent({ username: admin.username, role: admin.role }, contentRevisionId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return jsonError(e); }
}

/**
 * V2 profile steps. Confirming is always an explicit Admin action AFTER a preview (the service refuses CONFIRM without a fresh preview);
 * nothing here confirms automatically or relaxes the CONFIRMED requirement for V2 links.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const actor = { username: admin.username, role: admin.role };
    const { action, ...payload } = actionSchema.parse(await request.json());
    const service = new PresentationProfileService();
    if (action === 'CREATE') return NextResponse.json({ ok: true, ...(await service.create(actor, payload)) }, { status: 201 });
    const id = idSchema.parse((payload as { id?: unknown }).id);
    if (action === 'PREVIEW') return NextResponse.json({ ok: true, ...(await service.preview(actor, id)) });
    return NextResponse.json({ ok: true, ...(await service.confirm(actor, id, payload)) });
  } catch (e) { return jsonError(e); }
}
