import { randomInt } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { GroupCode, StudyPhase } from '@/types/research';

export class AssignmentService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async chooseGroup(phase: StudyPhase): Promise<GroupCode> {
    const counts = await this.repo.countGroups(phase);
    if (counts.A < counts.B) return 'A';
    if (counts.B < counts.A) return 'B';
    return randomInt(0, 2) === 0 ? 'A' : 'B';
  }
}
