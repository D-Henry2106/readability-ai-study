# 02 — Changelog

## Tác động chính

- Bổ sung hệ quản lý Package ghim đúng một revision bài đọc và một revision câu hỏi.
- Cơ chế `FIXED`/`RANDOM` có phân tách PILOT/MAIN; random thực hiện trên server.
- Session giữ bản ghim bất biến; archive không xóa dữ liệu lịch sử.
- Dashboard có sidebar, wizard, readiness checklist, thống kê theo cohort.
- Giao diện web mặc định tiếng Việt trên cả dev/prod; không tạo i18n hay AI API.

## File thêm (so với ZIP gốc)

- `[ADD] src/app/admin/(protected)/config/page.tsx`
- `[ADD] src/app/api/admin/packages/route.ts`
- `[ADD] src/components/admin/AdminSidebar.tsx`
- `[ADD] src/components/admin/PackageManager.tsx`
- `[ADD] src/lib/services/package.service.ts`
- `[ADD] tests/unit/export-package.test.ts`
- `[ADD] tests/unit/package.test.ts`

## File sửa (so với ZIP gốc)

- `[MODIFY] src/app/admin/(protected)/content/page.tsx`
- `[MODIFY] src/app/admin/(protected)/exports/page.tsx`
- `[MODIFY] src/app/admin/(protected)/layout.tsx`
- `[MODIFY] src/app/admin/(protected)/page.tsx`
- `[MODIFY] src/app/admin/(protected)/questions/page.tsx`
- `[MODIFY] src/app/admin/(protected)/sessions/[id]/page.tsx`
- `[MODIFY] src/app/admin/(protected)/sessions/page.tsx`
- `[MODIFY] src/app/admin/(protected)/statistics/page.tsx`
- `[MODIFY] src/app/admin/login/page.tsx`
- `[MODIFY] src/app/api/admin/config/route.ts`
- `[MODIFY] src/app/api/admin/content/route.ts`
- `[MODIFY] src/app/api/admin/questions/route.ts`
- `[MODIFY] src/app/complete/page.tsx`
- `[MODIFY] src/app/consent/page.tsx`
- `[MODIFY] src/app/demographics/page.tsx`
- `[MODIFY] src/app/exit/page.tsx`
- `[MODIFY] src/app/experiment/break/page.tsx`
- `[MODIFY] src/app/experiment/reading/page.tsx`
- `[MODIFY] src/app/experiment/review/page.tsx`
- `[MODIFY] src/app/experiment/test/page.tsx`
- `[MODIFY] src/app/globals.css`
- `[MODIFY] src/app/information/page.tsx`
- `[MODIFY] src/app/layout.tsx`
- `[MODIFY] src/app/page.tsx`
- `[MODIFY] src/app/withdraw/page.tsx`
- `[MODIFY] src/components/admin/AdminLoginForm.tsx`
- `[MODIFY] src/components/admin/ConfigForm.tsx`
- `[MODIFY] src/components/admin/ContentManager.tsx`
- `[MODIFY] src/components/admin/LogoutButton.tsx`
- `[MODIFY] src/components/admin/QuestionManager.tsx`
- `[MODIFY] src/components/admin/ValidityForm.tsx`
- `[MODIFY] src/components/participant/BreakClient.tsx`
- `[MODIFY] src/components/participant/ConsentForm.tsx`
- `[MODIFY] src/components/participant/DemographicsForm.tsx`
- `[MODIFY] src/components/participant/InformationContinue.tsx`
- `[MODIFY] src/components/participant/ParticipantShell.tsx`
- `[MODIFY] src/components/participant/Progress.tsx`
- `[MODIFY] src/components/participant/ReadingClient.tsx`
- `[MODIFY] src/components/participant/StartButton.tsx`
- `[MODIFY] src/components/participant/TestForm.tsx`
- `[MODIFY] src/components/participant/TestReview.tsx`
- `[MODIFY] src/components/participant/WithdrawButton.tsx`
- `[MODIFY] src/lib/db/collections.ts`
- `[MODIFY] src/lib/db/indexes.ts`
- `[MODIFY] src/lib/http.ts`
- `[MODIFY] src/lib/repositories/research.repository.ts`
- `[MODIFY] src/lib/services/analysis.service.ts`
- `[MODIFY] src/lib/services/export.service.ts`
- `[MODIFY] src/lib/services/readiness.service.ts`
- `[MODIFY] src/lib/services/session.service.ts`
- `[MODIFY] src/lib/validation/schemas.ts`
- `[MODIFY] src/types/research.ts`
- `[MODIFY] tests/e2e/edge-cases.spec.ts`
- `[MODIFY] tests/e2e/experiment-flow.spec.ts`
- `[MODIFY] tests/helpers/test-db.ts`
- `[MODIFY] tests/unit/publication.test.ts`
- `[MODIFY] tests/unit/readiness.test.ts`

## File xóa / tệp không đóng gói

- **Không xóa mã nguồn đang hoạt động** do việc nâng cấp.
- Các tệp `.env.local`, `.env.test.local` (chứa cấu hình bí mật), `test-results/` (dấu vết kết quả E2E), `.next/`, `node_modules/` và `.git/` **bị loại khỏi ZIP bàn giao vì bảo mật/dung lượng**; không phải những file source bị xóa.
- Giữ nguyên `.gitignore`, `.nvmrc`, `.prettierrc`. File cache `tsconfig.tsbuildinfo` không đưa vào bản bàn giao.

## Phần giữ nguyên / tái sử dụng

Auth/session, cơ chế Consent, luồng đọc–quiz–break, chuyển bước server-authoritative, bảo vệ không lộ đáp án, EventService, scoring và assignment thứ tự AB/BA. Không tự tạo nội dung AI; chỉ nhận văn bản dán thủ công.

## Tương thích dữ liệu cũ

Trường mới trong `SessionDoc` và cấu hình là optional để đọc dữ liệu lịch sử. Collection `content_packages` mới không đụng các collection cũ. Không có script xóa/ghi đè dữ liệu production. `npm run db:indexes` được dùng để tạo index bổ sung.
