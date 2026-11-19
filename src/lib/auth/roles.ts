import type { AdminRole } from '@/types/research';

/** Defence in depth: critical services re-check the role even though the route already did. Maps to HTTP 403. */
export function assertRole(actor: { role: AdminRole }, allowed: readonly AdminRole[]): void {
  if (!allowed.includes(actor.role)) throw new Error('FORBIDDEN');
}
