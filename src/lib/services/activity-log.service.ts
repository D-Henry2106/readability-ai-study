import { collections } from '@/lib/db/collections';

/** Plain-language names for the action codes written to admin_audit. Unknown codes are shown as stored. */
export const ADMIN_ACTION_LABEL: Record<string, string> = {
  ADMIN_LOGIN: 'Đăng nhập quản trị',
  ADMIN_LOGOUT: 'Đăng xuất quản trị',
  ADMIN_PASSWORD_CHANGED: 'Đổi mật khẩu',
  ADMIN_DISABLED: 'Vô hiệu hóa tài khoản quản trị',
  EXPERIMENT_CONFIG_UPDATED: 'Cập nhật văn bản và cài đặt',
  PACKAGE_DRAFT_CREATED: 'Tạo bản nháp bộ nội dung',
  PACKAGE_DRAFT_UPDATED: 'Sửa bản nháp bộ nội dung',
  CONTENT_PUBLISHED: 'Xuất bản bộ nội dung',
  QUESTIONS_DRAFT_CREATED: 'Tạo bộ câu hỏi',
  QUESTIONS_UPDATED: 'Sửa bộ câu hỏi',
  QUESTIONS_PUBLISHED: 'Xuất bản bộ câu hỏi',
  QUESTIONS_ARCHIVED: 'Lưu trữ bộ câu hỏi',
  QUESTIONS_DELETED: 'Xóa bộ câu hỏi',
  STUDY_RUN_CREATED: 'Tạo đợt nghiên cứu',
  STUDY_RUN_QUOTA_CONFIRMED: 'Xác nhận chỉ tiêu mỗi nhóm',
  STUDY_RUN_SAMPLE_SIZE_CHANGED: 'Đổi tổng số người tham gia',
  STUDY_RUN_ENTRY_POLICY_CONFIRMED: 'Xác nhận cách vào nghiên cứu',
  STUDY_RUN_INFO_CONSENT_REVIEWED: 'Xác nhận văn bản Thông tin/Đồng ý/Kết thúc',
  STUDY_RUN_PRESENTATION_PROFILE_CONFIRMED: 'Gắn bài đọc V2 vào đợt',
  STUDY_RUN_STATUS_CHANGED: 'Đổi trạng thái đợt (mở/tạm dừng/đóng)',
  STUDY_RUN_LOCKED: 'Khóa cấu hình đợt',
  STUDY_RUN_QUOTA_SUPPLEMENTAL_INCLUDED: 'Đưa phiên bổ sung vào chỉ tiêu',
  PRESENTATION_PROFILE_CREATED: 'Tạo bài đọc V2',
  PRESENTATION_PROFILE_UPDATED: 'Sửa bài đọc V2',
  PRESENTATION_PROFILE_PREVIEWED: 'Xem trước bài đọc V2',
  PRESENTATION_PROFILE_CONFIRMED: 'Xác nhận bài đọc V2',
  PRESENTATION_PROFILE_LOCKED: 'Khóa bài đọc V2',
  INVITATION_ISSUED: 'Phát link mời',
  INVITATION_REVOKED: 'Thu hồi link mời',
  INVITATION_RECOVERY_AUTHORIZED: 'Cho phép khôi phục link',
  INVITATION_RECOVERY_CANCELLED: 'Hủy khôi phục link',
  INVITATION_RECOVERY_CONSUMED: 'Người tham gia dùng link khôi phục',
  VARIANT_LOCKED: 'Khóa nhóm V1/V2',
  VARIANT_UNLOCKED: 'Mở khóa nhóm V1/V2',
  VALIDITY_CHANGED: 'Đổi trạng thái hợp lệ của phiên',
  DATA_EXPORTED: 'Xuất dữ liệu'
};

/** Plain-language names for what a participant did (experiment_events.type). */
export const PARTICIPANT_EVENT_LABEL: Record<string, string> = {
  SESSION_STARTED: 'Mở link và bắt đầu',
  INFORMATION_SHOWN: 'Xem thông tin nghiên cứu',
  CONSENT_ACCEPTED: 'Đồng ý tham gia',
  CONSENT_DECLINED: 'Không đồng ý',
  DEMOGRAPHICS_SUBMITTED: 'Gửi thông tin cá nhân',
  GROUP_ASSIGNED: 'Được xếp nhóm (luồng cũ)',
  PACKAGE_ASSIGNED: 'Được giao bài đọc',
  READING_STARTED: 'Bắt đầu đọc',
  READING_FINISHED: 'Đọc xong',
  TEST_REVIEW_CONFIRMED: 'Xác nhận đã đọc hướng dẫn',
  TEST_STARTED: 'Bắt đầu làm câu hỏi',
  TEST_SUBMITTED: 'Nộp bài',
  BREAK_STARTED: 'Bắt đầu nghỉ (luồng cũ)',
  BREAK_FINISHED: 'Hết giờ nghỉ (luồng cũ)',
  SESSION_COMPLETED: 'Hoàn thành nghiên cứu',
  WITHDRAWAL_REQUESTED: 'Rút khỏi nghiên cứu',
  SESSION_ABANDONED: 'Bỏ dở'
};

export interface AdminLogRow {
  id: string;
  at: Date;
  who: string;
  action: string;
  target: string;
}
export interface ParticipantLogRow {
  id: string;
  at: Date;
  sessionId: string;
  what: string;
}

const LIMIT = 200;

/** Read-only views of what admins did and what participants did, newest first. */
export class ActivityLogService {
  async adminActions(): Promise<AdminLogRow[]> {
    const { adminAudit } = await collections();
    const docs = await adminAudit.find({}).sort({ createdAt: -1 }).limit(LIMIT).toArray();
    return docs.map((d) => ({
      id: String(d._id),
      at: d.createdAt,
      who: d.role === 'SYSTEM' ? 'Hệ thống' : d.username,
      action: ADMIN_ACTION_LABEL[d.action] ?? d.action,
      target: d.targetId ? `${d.targetType} · ${String(d.targetId).slice(-8)}` : d.targetType
    }));
  }

  async participantActions(): Promise<ParticipantLogRow[]> {
    const { experimentEvents } = await collections();
    const docs = await experimentEvents.find({}).sort({ createdAt: -1 }).limit(LIMIT).toArray();
    return docs.map((d) => ({
      id: String(d._id),
      at: d.createdAt,
      sessionId: d.sessionId,
      what: PARTICIPANT_EVENT_LABEL[d.type] ?? d.type
    }));
  }
}
