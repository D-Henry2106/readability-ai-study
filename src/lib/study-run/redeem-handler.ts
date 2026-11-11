import { NextResponse } from 'next/server';
import { StudyRunError } from './errors';
import { redeemBodySchema } from '@/lib/validation/invitation-schemas';
import { jsonError } from '@/lib/http';
import type { RedeemInput, RedeemResult } from '@/lib/services/invitation-redemption.service';

// Behaviour of POST /api/invitations/redeem, separated from Next.js wiring so it can be unit-tested.
// It never logs the request, never echoes the token, and every response is `no-store`.
const MESSAGES: Record<string, string> = {
  INVITATION_UNAVAILABLE: 'Liên kết không hợp lệ hoặc hiện chưa sử dụng được. Vui lòng liên hệ nhà nghiên cứu.',
  INVITATION_ALREADY_USED: 'Liên kết này đã được sử dụng. Vui lòng liên hệ nhà nghiên cứu.',
  ACTIVE_SESSION_IN_BROWSER: 'Trình duyệt này đang có một phiên nghiên cứu khác đang diễn ra. Vui lòng liên hệ nhà nghiên cứu.',
  INVITATION_REDEEM_IN_PROGRESS: 'Liên kết đang được xử lý. Vui lòng thử lại sau ít giây.'
};

export interface RedeemHandlerDeps {
  service: { redeem(input: RedeemInput): Promise<RedeemResult> };
  getCookieSessionId(): Promise<string | null>;
  setCookieSessionId(sessionId: string): Promise<void>;
}

function respond(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function handleRedeem(request: { json(): Promise<unknown> }, deps: RedeemHandlerDeps): Promise<Response> {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = redeemBodySchema.safeParse(body);
    if (!parsed.success) return respond({ error: 'Yêu cầu không hợp lệ.', code: 'INVALID_REQUEST' }, 400);
    const result = await deps.service.redeem({ ...parsed.data, cookieSessionId: await deps.getCookieSessionId() });
    if (result.grantCookie) await deps.setCookieSessionId(result.sessionId);
    return respond({ ok: true, resumed: result.outcome === 'RESUMED', nextRoute: result.nextRoute }, 200);
  } catch (error) {
    if (error instanceof StudyRunError) {
      return respond({ error: MESSAGES[error.code] ?? 'Không thể sử dụng liên kết này.', code: error.code }, error.status,
        error.code === 'INVITATION_REDEEM_IN_PROGRESS' ? { 'Retry-After': '15' } : {});
    }
    const response = jsonError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
