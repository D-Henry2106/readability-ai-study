export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 200;

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwertyuiop', 'qwerty123456', 'iloveyou', 'welcome123',
  'admin', 'administrator', 'letmein', 'changeme', 'trustno1', 'abc123456789', '123456789012', '1q2w3e4r5t6y',
  'research', 'researcher', 'readability', 'nghiencuu', 'matkhau', 'matkhau123'
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; errors: Array<{ code: string; message: string }> };

/** Length and blocklist based (no composition rules). Server-side only; the client never decides. */
export function validateAdminPassword(password: string, context: { username?: string } = {}): PasswordPolicyResult {
  const errors: Array<{ code: string; message: string }> = [];
  const add = (code: string, message: string) => errors.push({ code, message });
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) add('TOO_SHORT', `Mật khẩu cần tối thiểu ${ADMIN_PASSWORD_MIN_LENGTH} ký tự.`);
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) add('TOO_LONG', `Mật khẩu tối đa ${ADMIN_PASSWORD_MAX_LENGTH} ký tự.`);
  if (password.trim() !== password) add('EDGE_WHITESPACE', 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.');
  const folded = password.toLowerCase();
  const alnum = folded.replace(/[^\p{L}\p{N}]/gu, '');
  const repeatsCommon = [...COMMON].some((word) => alnum.length > word.length && alnum.length % word.length === 0 && alnum === word.repeat(alnum.length / word.length));
  if (COMMON.has(folded) || COMMON.has(alnum) || repeatsCommon) add('COMMON', 'Mật khẩu quá phổ biến.');
  if (password.length > 0 && new Set(password).size <= 2) add('LOW_VARIETY', 'Mật khẩu lặp lại quá ít ký tự khác nhau.');
  const user = context.username?.trim().toLowerCase();
  if (user && user.length >= 3 && folded.includes(user)) add('CONTAINS_USERNAME', 'Mật khẩu không được chứa tên đăng nhập.');
  return errors.length ? { ok: false, errors } : { ok: true };
}
