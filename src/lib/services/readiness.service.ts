import type { ExperimentConfigDoc } from '@/types/research';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { PackageService } from './package.service';

export interface ReadinessCheck { code: string; label: string; status: 'PASS' | 'FAIL'; detail: string; href: string; gate: 'START_STUDY' }
export interface ReadinessResult { ready: boolean; missing: string[]; checks: ReadinessCheck[] }
const descriptions: Record<string, [string, string]> = {
  STUDY_NOT_PUBLISHED: ['Nghiên cứu đã được mở', '/admin/config'],
  PARTICIPANT_INFORMATION_SHEET: ['Thông tin tham gia và version', '/admin/config'],
  CONSENT_WORDING: ['Consent và version', '/admin/config'],
  DEBRIEF_WORDING: ['Debrief và version', '/admin/config'],
  DATA_RIGHTS_WORDING: ['Quyền dữ liệu', '/admin/config'],
  FINDINGS_INFORMATION: ['Thông tin kết quả', '/admin/config'],
  MINIMUM_READING_TIME: ['Thời gian đọc tối thiểu', '/admin/config'],
  PUBLISHED_CONTENT_PACKAGE: ['Package đã xuất bản và hợp lệ', '/admin/content'],
  FIXED_PACKAGE_REQUIRED: ['Package cố định đã được chọn', '/admin/config'],
  FIXED_PACKAGE_NOT_ELIGIBLE: ['Package cố định đủ điều kiện', '/admin/config'],
  MAIN_RANDOM_NOT_APPROVED: ['Phê duyệt phân bổ ngẫu nhiên MAIN', '/admin/config']
};
export class ReadinessService {
  constructor(private readonly repo = new ResearchRepository()) {}
  async check(options: { ignorePublication?: boolean; configOverride?: ExperimentConfigDoc } = {}): Promise<ReadinessResult> {
    const config = options.configOverride ?? await this.repo.getConfig();
    const missing: string[] = [];
    if (!options.ignorePublication && !config.studyPublished) missing.push('STUDY_NOT_PUBLISHED');
    if (!config.informationText || !config.informationVersion) missing.push('PARTICIPANT_INFORMATION_SHEET');
    if (!config.consentText || !config.consentVersion) missing.push('CONSENT_WORDING');
    if (!config.debriefText || !config.debriefVersion) missing.push('DEBRIEF_WORDING');
    if (!config.dataRightsText) missing.push('DATA_RIGHTS_WORDING');
    if (!config.findingsText) missing.push('FINDINGS_INFORMATION');
    if (!config.minimumReadingSeconds) missing.push('MINIMUM_READING_TIME');
    const eligible = await new PackageService(this.repo).eligible(config.phase);
    if (!eligible.length) missing.push('PUBLISHED_CONTENT_PACKAGE');
    if ((config.assignmentMode ?? 'FIXED') === 'FIXED' && eligible.length > 1 && !config.fixedPackageId) missing.push('FIXED_PACKAGE_REQUIRED');
    if ((config.assignmentMode ?? 'FIXED') === 'FIXED' && config.fixedPackageId && !eligible.some(p => p._id?.toHexString() === config.fixedPackageId)) missing.push('FIXED_PACKAGE_NOT_ELIGIBLE');
    if (config.phase === 'MAIN' && config.assignmentMode === 'RANDOM' && !config.mainRandomApproved) missing.push('MAIN_RANDOM_NOT_APPROVED');
    return { ready: missing.length === 0, missing, checks: Object.entries(descriptions).map(([code, [label, href]]) => ({
      code, label, href, gate: 'START_STUDY' as const,
      status: missing.includes(code) ? 'FAIL' as const : 'PASS' as const,
      detail: missing.includes(code) ? 'Chưa đáp ứng điều kiện' : 'Đã đạt điều kiện'
    })) };
  }
}
