import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { collections } from '@/lib/db/collections';
import { getSecurityEnv } from '@/config/env';
import { verifyAgainstDummy, verifyPassword } from '@/lib/security/password';
import { startAdminSession } from '@/lib/auth/admin-session';
import { consumeAll, loginRules, MongoRateLimitStore } from '@/lib/security/rate-limit';
import { clientIp } from '@/lib/security/request-guard';
import { jsonError, tooManyRequests } from '@/lib/http';
import { AuditService } from '@/lib/services/audit.service';

const schema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(500) });
const GENERIC_FAILURE = { error: 'Tên đăng nhập hoặc mật khẩu không đúng.' };

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const ip = clientIp(request.headers, getSecurityEnv().TRUST_PROXY_HEADERS === 'true');
    const store = new MongoRateLimitStore();
    const { rules, successClears } = loginRules(ip, input.username);
    // Counted before the password is checked, so parallel guesses cannot slip through.
    const decision = await consumeAll(store, rules);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);

    const { admins } = await collections();
    const admin = await admins.findOne({ username: input.username });
    // Unknown, disabled and wrong-password cases take the same time and return the same answer.
    const valid = admin && !admin.disabledAt ? await verifyPassword(input.password, admin.passwordHash) : await verifyAgainstDummy(input.password);
    if (!admin || !valid) return NextResponse.json(GENERIC_FAILURE, { status: 401 });

    await Promise.all(successClears.map((key) => store.clear(key)));
    await startAdminSession(admin.username);
    // Best effort: a logging problem must never lock an admin out.
    await new AuditService().record({ username: admin.username, role: admin.role, action: 'ADMIN_LOGIN', targetType: 'admin', targetId: admin.username }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
