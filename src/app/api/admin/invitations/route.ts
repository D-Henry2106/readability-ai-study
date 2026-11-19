import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { InvitationService } from '@/lib/services/invitation.service';
import { jsonError } from '@/lib/http';

// Links carry the raw token (in the URL fragment): never cache, and the token is returned ONLY by CREATE/REPLACE, once.
const noStore = { 'Cache-Control': 'no-store' };
const actionSchema = z.object({ action: z.enum(['CREATE', 'REVOKE', 'REPLACE', 'AUTHORIZE_RECOVERY', 'CANCEL_RECOVERY']) }).passthrough();
const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);

/** Invitations of one run, without token or hash. */
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const studyRunId = idSchema.parse(request.nextUrl.searchParams.get('studyRunId'));
    const invitations = await new InvitationService().list({ username: admin.username, role: admin.role }, studyRunId);
    return NextResponse.json({ invitations }, { headers: noStore });
  } catch (e) { return jsonError(e); }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const actor = { username: admin.username, role: admin.role };
    const { action, ...payload } = actionSchema.parse(await request.json());
    const service = new InvitationService();
    if (action === 'CREATE') {
      const { issued, auditLogged } = await service.create(actor, payload);
      return NextResponse.json({ ok: true, auditLogged, issued: issued.map(({ invitationId, variant, link }) => ({ invitationId, variant, link })) }, { status: 201, headers: noStore });
    }
    const invitationId = idSchema.parse((payload as { invitationId?: unknown }).invitationId);
    if (action === 'REVOKE') return NextResponse.json({ ok: true, ...(await service.revoke(actor, invitationId, payload)) }, { headers: noStore });
    if (action === 'REPLACE') {
      const { issued, auditLogged } = await service.replace(actor, invitationId, payload);
      return NextResponse.json({ ok: true, auditLogged, issued: [{ invitationId: issued.invitationId, variant: issued.variant, link: issued.link }] }, { status: 201, headers: noStore });
    }
    if (action === 'AUTHORIZE_RECOVERY') return NextResponse.json({ ok: true, ...(await service.authorizeRecovery(actor, invitationId, payload)) }, { headers: noStore });
    return NextResponse.json({ ok: true, ...(await service.cancelRecovery(actor, invitationId)) }, { headers: noStore });
  } catch (e) { return jsonError(e); }
}
