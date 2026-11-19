import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { StudyRunService } from '@/lib/services/study-run.service';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { jsonError } from '@/lib/http';

const noStore = { 'Cache-Control': 'no-store' };
const actionSchema = z.object({ action: z.enum(['SAMPLE_SIZE', 'CONFIRM_QUOTA', 'ENTRY_POLICY', 'INFO_CONSENT', 'PROFILE', 'TRANSITION']) }).passthrough();

/** Run + exactly what still prevents OPEN (the readiness list uses the service's own codes, e.g. QUOTA_NOT_CONFIRMED). */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const actor = { username: admin.username, role: admin.role };
    const { id } = await context.params;
    const service = new StudyRunService();
    const run = await service.get(actor, id);
    const [readiness, infoConsent, profiles] = await Promise.all([
      service.checkOpenReadiness(actor, id),
      service.infoConsentState(actor, id),
      new PresentationProfileService().listByContent(actor, run.snapshot.contentRevisionId.toHexString())
    ]);
    return NextResponse.json({ run, readiness, infoConsent, profiles }, { headers: noStore });
  } catch (e) { return jsonError(e); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const actor = { username: admin.username, role: admin.role };
    const { id } = await context.params;
    const { action, ...payload } = actionSchema.parse(await request.json());
    const service = new StudyRunService();
    const result = action === 'SAMPLE_SIZE' ? await service.updateSampleSize(actor, id, payload)
      : action === 'CONFIRM_QUOTA' ? await service.confirmQuota(actor, id, payload)
      : action === 'ENTRY_POLICY' ? await service.confirmEntryPolicy(actor, id, payload)
      : action === 'INFO_CONSENT' ? await service.confirmInfoConsentReview(actor, id, payload)
      : action === 'PROFILE' ? await service.confirmPresentationProfile(actor, id, payload)
      : await service.transition(actor, id, payload);
    return NextResponse.json({ ok: true, run: result.run, proposedQuotaPerArm: result.proposedQuotaPerArm, auditLogged: result.auditLogged }, { headers: noStore });
  } catch (e) { return jsonError(e); }
}
