import { collections } from '@/lib/db/collections';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '@/lib/security/password';
import { validateAdminPassword } from '@/lib/security/password-policy';
import { AuditService } from './audit.service';
import type { AdminDoc } from '@/types/research';

export interface AdminAccountStore {
  find(username: string): Promise<AdminDoc | null>;
  setPassword(username: string, passwordHash: string, at: Date): Promise<boolean>;
  disable(username: string, at: Date): Promise<boolean>;
}

export class MongoAdminAccountStore implements AdminAccountStore {
  async find(username: string) { return (await collections()).admins.findOne({ username }); }
  async setPassword(username: string, passwordHash: string, at: Date) {
    const r = await (await collections()).admins.updateOne({ username, disabledAt: { $in: [null, undefined] } }, { $set: { passwordHash, passwordChangedAt: at } });
    return r.modifiedCount === 1;
  }
  async disable(username: string, at: Date) {
    const r = await (await collections()).admins.updateOne({ username, disabledAt: { $in: [null, undefined] } }, { $set: { disabledAt: at } });
    return r.modifiedCount === 1;
  }
}

export interface AdminAccountDeps {
  store: AdminAccountStore;
  revokeAllSessions: (username: string, reason: string) => Promise<number>;
  audit: Pick<AuditService, 'record'>;
  clock?: () => Date;
}

export type PasswordChangeResult =
  | { status: 200; body: { ok: true } }
  | { status: 400; body: { error: string; code: 'CURRENT_PASSWORD_INVALID' | 'PASSWORD_POLICY' | 'PASSWORD_UNCHANGED'; errors?: Array<{ code: string; message: string }> } };

/**
 * Changes the caller's own password. All existing sessions are revoked (the route then issues a fresh one),
 * and a minimal audit entry (never the passwords) is written.
 */
export async function changeAdminPassword(
  input: { username: string; role: 'RESEARCHER' | 'SUPERVISOR'; currentPassword: string; newPassword: string },
  deps: AdminAccountDeps
): Promise<PasswordChangeResult> {
  const now = (deps.clock ?? (() => new Date()))();
  const admin = await deps.store.find(input.username);
  const currentOk = admin && !admin.disabledAt ? await verifyPassword(input.currentPassword, admin.passwordHash) : await verifyAgainstDummy(input.currentPassword);
  if (!admin || !currentOk) return { status: 400, body: { error: 'Mật khẩu hiện tại không đúng.', code: 'CURRENT_PASSWORD_INVALID' } };
  if (input.newPassword === input.currentPassword) return { status: 400, body: { error: 'Mật khẩu mới phải khác mật khẩu hiện tại.', code: 'PASSWORD_UNCHANGED' } };
  const policy = validateAdminPassword(input.newPassword, { username: input.username });
  if (!policy.ok) return { status: 400, body: { error: 'Mật khẩu mới chưa đạt yêu cầu.', code: 'PASSWORD_POLICY', errors: policy.errors } };
  if (!(await deps.store.setPassword(input.username, await hashPassword(input.newPassword), now))) {
    return { status: 400, body: { error: 'Mật khẩu hiện tại không đúng.', code: 'CURRENT_PASSWORD_INVALID' } };
  }
  const revoked = await deps.revokeAllSessions(input.username, 'PASSWORD_CHANGED');
  await deps.audit.record({ username: input.username, role: input.role, action: 'ADMIN_PASSWORD_CHANGED', targetType: 'admin', targetId: input.username, metadata: { revokedSessions: revoked } });
  return { status: 200, body: { ok: true } };
}

/** Disables an account and revokes every session at once. Never deletes the account or any research data. */
export async function disableAdminAccount(
  input: { username: string; actor: { username: string; role: 'RESEARCHER' | 'SUPERVISOR' | 'SYSTEM' } },
  deps: AdminAccountDeps
): Promise<{ disabled: boolean; revokedSessions: number }> {
  const now = (deps.clock ?? (() => new Date()))();
  const disabled = await deps.store.disable(input.username, now);
  const revokedSessions = disabled ? await deps.revokeAllSessions(input.username, 'ACCOUNT_DISABLED') : 0;
  if (disabled) await deps.audit.record({ username: input.actor.username, role: input.actor.role, action: 'ADMIN_DISABLED', targetType: 'admin', targetId: input.username, metadata: { revokedSessions } });
  return { disabled, revokedSessions };
}
