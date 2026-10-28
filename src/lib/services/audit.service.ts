import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { AdminRole } from '@/types/research';

export class AuditService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async record(input: {
    username: string;
    role: AdminRole;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  }) {
    await this.repo.addAudit({
      username: input.username,
      role: input.role,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date()
    });
  }
}
