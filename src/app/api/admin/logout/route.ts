import { NextResponse } from 'next/server';
import { clearAdminSession, getAdminSession } from '@/lib/auth/admin-session';
import { AuditService } from '@/lib/services/audit.service';

export async function POST() {
  const admin = await getAdminSession().catch(() => null);
  await clearAdminSession();
  if (admin) {
    // Best effort: a logging problem must never block signing out.
    await new AuditService().record({ username: admin.username, role: admin.role, action: 'ADMIN_LOGOUT', targetType: 'admin', targetId: admin.username }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
