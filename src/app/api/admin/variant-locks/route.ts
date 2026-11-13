import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { VariantLockService } from '@/lib/services/variant-lock.service';
import { jsonError } from '@/lib/http';

const bodySchema = z.object({ variant: z.enum(['V1', 'V2']), locked: z.boolean() });

export async function GET() {
  try {
    const admin = await requireAdmin();
    return NextResponse.json({ locks: await new VariantLockService().list({ username: admin.username, role: admin.role }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return jsonError(e); }
}

/** Lock or unlock ONE variant. The lock is enforced by InvitationService and InvitationRedemptionService, not by the UI. */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const { variant, locked } = bodySchema.parse(await request.json());
    const result = await new VariantLockService().set({ username: admin.username, role: admin.role }, variant, locked);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return jsonError(e); }
}
