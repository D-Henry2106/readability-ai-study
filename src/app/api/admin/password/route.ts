import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSessionService, requireAdmin, startAdminSession } from '@/lib/auth/admin-session';
import { changeAdminPassword, MongoAdminAccountStore } from '@/lib/services/admin-account.service';
import { AuditService } from '@/lib/services/audit.service';
import { consumeAll, keyPart, MongoRateLimitStore } from '@/lib/security/rate-limit';
import { jsonError, tooManyRequests } from '@/lib/http';

const schema = z.object({ currentPassword: z.string().min(1).max(500), newPassword: z.string().min(1).max(500) });

/** Self-service password change (any admin role). Revokes all sessions, then signs the caller in again. */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const decision = await consumeAll(new MongoRateLimitStore(), [{ key: `pwchange:user:${keyPart(admin.username)}`, limit: 5, windowMs: 15 * 60_000 }]);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    const sessions = adminSessionService();
    const result = await changeAdminPassword(
      { username: admin.username, role: admin.role, ...input },
      { store: new MongoAdminAccountStore(), revokeAllSessions: (u, reason) => sessions.revokeAllForUser(u, reason), audit: new AuditService() }
    );
    if (result.status === 200) await startAdminSession(admin.username);
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) { return jsonError(e); }
}
