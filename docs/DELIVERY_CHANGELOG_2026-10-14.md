# CRP Delivery — Changes and operation

## Added

- `src/lib/services/analysis.service.ts` — thống kê mô tả dữ liệu ghép cặp: mean, median, sample SD, phân bố 0–5, per-question accuracy, thời lượng đã ghi nhận, đánh dấu loại trừ.
- `src/app/admin/(protected)/statistics/page.tsx` — trang Statistics theo MAIN/PILOT, không đưa incomplete hoặc REQUIRES_REVIEW vào mean.
- `tests/unit/analysis.test.ts` — unit fixtures test số liệu ghép cặp, exclusions và empty dataset.
- `tests/unit/publication.test.ts` — test readiness được chặn khi study unpublished.
- `docs/DELIVERY_AUDIT_2026-10-14.md`, `docs/DELIVERY_CHANGELOG_2026-10-14.md`, `docs/DELIVERY_TEST_DEPLOY_2026-10-14.md`.

## Modified

- `src/types/research.ts` — optional `studyPublished` (mặc định blocked với dữ liệu legacy), `eventKey`, optional stage của event.
- `src/lib/validation/schemas.ts` — cờ publish study trong schema.
- `src/lib/services/readiness.service.ts` — gate publication và hỗ trợ riêng bước kiểm tra prepublish.
- `src/app/api/admin/config/route.ts` — từ chối publish khi thiếu protocol/content/question; lưu cờ publish server-side, có audit.
- `src/components/admin/ConfigForm.tsx`, `src/app/admin/(protected)/page.tsx` — nút publish có giải thích, checklist readiness, sửa phân biệt active/incomplete/consent.
- `src/lib/repositories/research.repository.ts` — analysis dataset, event list, số consent, atomic completion và unique event upsert.
- `src/lib/db/indexes.ts` — unique partial index cho eventKey mới; bản ghi legacy không cần xóa.
- `src/lib/services/event.service.ts` — ghi stage theo session do server quản lý.
- `src/lib/services/scoring.service.ts` — từ chối gói đáp án không khớp đủ 5 question ID.
- `src/app/api/test/submit/route.ts` — kiểm tra đã có đủ 2 quiz và 2 lần đọc kết thúc trước khi đánh dấu hoàn thành; hoàn thành atomically, lưu quiz startedAt theo event server.
- `src/app/api/session/route.ts`, `src/components/participant/StartButton.tsx`, `src/app/page.tsx` — tái sử dụng session ACTIVE khi cookie sẵn có; status unavailable mô tả rõ hơn; completed không bị hiểu nhầm là ACTIVE.
- `src/lib/services/export.service.ts`, `src/app/api/admin/export/route.ts`, `src/app/admin/(protected)/exports/page.tsx` — thêm CSV paired V1/V2 đủ điều kiện, question-level và event-level theo phase, vẫn sử dụng sanitizer chống CSV formula injection.
- `src/app/admin/(protected)/layout.tsx` — liên kết Statistics.
- `src/components/participant/TestForm.tsx`, `ReadingClient.tsx`, `ConsentForm.tsx`, `DemographicsForm.tsx`, `WithdrawButton.tsx` — xử lý mất kết nối, báo lỗi và cho phép thử lại an toàn; yêu cầu timestamp bắt đầu bài kiểm tra do server ghi nhận.
- `src/components/participant/TestForm.tsx`, `ReadingClient.tsx`, `ConsentForm.tsx`, `DemographicsForm.tsx`, `WithdrawButton.tsx` — xử lý mất kết nối, báo lỗi và cho phép thử lại an toàn; yêu cầu timestamp bắt đầu bài kiểm tra do server ghi nhận.
- `src/lib/http.ts` — tránh ghi stack/error object chứa bí mật môi trường trong log.
- `tests/helpers/test-db.ts` — test fixture cần explicit publish (test-only).

## Deleted

Không xóa feature/module cũ. Khi đóng gói, chủ động **loại bỏ** `.env.local`, `.env.test.local`, `node_modules`, `.next`, traces, test-results, lock/credential ngoài scope nếu có; giữ nguyên `package-lock.json`.

## Luồng dữ liệu

`Home (readiness) → POST /api/session (cookie/session MongoDB) → Participant Information → Consent → Demographics → group AB/BA → Reading Round 1 → Quiz 1 (server scoring) → 120-second break → Reading Round 2 → Quiz 2 → atomic Completed → MongoDB (sessions/consents/readings/test_attempts/events) → Admin Sessions/Statistics → CSV export`.

## Bảo toàn và giới hạn

- Không thay đổi nội dung học thuật V1/V2, lời consent/ethics, nội dung 5 câu hỏi hoặc thứ tự phân nhóm AB/BA.
- Không tạo sample nghiên cứu cho production. Việc mark VALID cần người nghiên cứu review session; chỉ các cặp hợp lệ mới vào số liệu phân tích.
- Chưa thêm per-answer selection/change event vì thiếu xác nhận nội dung này được consent/Ethics cho phép; không log thao tác cá nhân ngoài phạm vi.
- Chưa đưa ra inferential p-values, không khẳng định cải thiện có ý nghĩa thống kê; cần đánh giá assumptions và protocol.
- Chưa triển khai quản trị data deletion/retention tự động vì chưa có policy được phê duyệt.
- Statistics trang hiện dùng bảng phân bố dễ tiếp cận thay vì chart library; tránh dependency mới. Với nhiều dữ liệu cần tối ưu pagination/aggregation và kiểm soát kích cỡ export.
