# 06 — Báo cáo kiểm tra (bản source nâng cấp)

## Kết quả thực tế trong môi trường xử lý hiện tại

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| Kiểm tra parser toàn bộ TS/TSX | **PASS** | Dùng TypeScript compiler API toàn cục, đọc AST mọi file `src/` và `tests/`: 0 parse diagnostics |
| Unit smoke core (không cần MongoDB) | **PASS 13/13** | Chạy thực tế kiểm tra nối khối V2 khớp chuỗi nguồn, scoring, random/fixed selection, cohort mixed revisions |
| Phát hiện Next route collision | **PASS** | Quét route sau khi bỏ route-group segments, không có URL trùng |
| `npm ci --offline` | **FAIL (môi trường)** | npm cache thiếu một số dependency (ví dụ `zod-validation-error`), không hoàn tất cài đặt |
| `npm ci` online | **NOT VERIFIED** | Yêu cầu tải package bị timeout trong môi trường xử lý |
| `npm run typecheck` | **NOT VERIFIED** | Thiếu `node_modules` (không có `next` types), không phải một bài kiểm tra typecheck hoàn chỉnh |
| `npm run lint` | **NOT VERIFIED** | Không có ESLint local (`eslint: not found`) |
| `npm run test:unit` | **NOT VERIFIED** | Không có Vitest (`vitest: not found`) |
| `npm run build` | **NOT VERIFIED** | Không có Next CLI (`next: not found`) |
| Integration với MongoDB test | **SKIP** | Không có MongoDB test runtime khả dụng, tuyệt đối không kết nối/ghi dữ liệu DB production |
| Playwright/E2E desktop/mobile | **SKIP** | Cần Next runtime, browser cài đặt và MongoDB test |
| Publish/Archive/Draft UI end-to-end | **NOT VERIFIED** | Đã triển khai API/UI, chưa có kiểm thử trình duyệt thực tế |
| Vietnamese production UI | **NOT VERIFIED** | Root locale và chuỗi UI đã thay trong source; cần `npm run build && npm run start` thực tế |
| Keyboard accessibility / responsive runtime | **NOT VERIFIED** | Có CSS responsive, focus-visible, mobile drawer; chưa chạy axe/Playwright chuyên biệt |

## Lệnh tái kiểm tra trên máy của bạn

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run dev
```

Test tích hợp với DB test riêng sau khi đã xác minh biến môi trường **trỏ tới DB hậu tố `_test` hoặc `-test`**:

```bash
npm run test:integration
npm run test:e2e
```

## Test đã bổ sung/cập nhật

- `tests/unit/package.test.ts`: fixed/random assignment, kiểm tra content/question phase, MAIN approval, integrity.
- `tests/unit/readiness.test.ts`, `tests/unit/publication.test.ts`: yêu cầu Package Published thay cho hai revision rời.
- `tests/unit/export-package.test.ts`: các cột Package CSV.
- `tests/helpers/test-db.ts`: seed Published Package đúng revision, sử dụng ContentHash thật.
- `tests/e2e/*.spec.ts`: selector đã Việt hóa.

## Điều kiện bắt buộc trước production

Không triển khai MAIN trước khi các lệnh trên đạt, phiên thật PILOT đi trọn A/B, quy trình Admin Publish/Archive/Rollback đã kiểm tra và có đối chiếu Proposal/Ethics. Không dùng báo cáo này như bằng chứng E2E PASS.
