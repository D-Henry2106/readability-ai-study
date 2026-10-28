# CRP — Setup, verification and handover

## A. Prerequisites

Node.js >=20.9, MongoDB (managed Atlas hoặc server tự quản). Các địa chỉ, tài khoản, password, secret chỉ dùng biến môi trường. Không đưa `.env.*.local` vào ZIP hoặc commit.

```bash
npm ci
cp .env.example .env.local # Tạo file nếu project chưa có mẫu; tự điền placeholder bên dưới
npm run db:check
npm run db:indexes
npm run create-admin
npm run dev
```

Nếu thiếu `.env.example`, tạo `.env.local` với các key:

```dotenv
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET_IN_DEPLOYMENT_SETTINGS
APP_URL=http://localhost:3000
```

**Không dùng** giá trị trên cho production. `AUTH_SECRET` cần giá trị ngẫu nhiên dài. Atlas cần user ít quyền theo phạm vi cần thiết, network rules phù hợp. Chạy create-admin theo hướng dẫn từ CLI, không sử dụng mật khẩu mẫu.

## B. Run tests (do the tests yourself)

```bash
npm run typecheck
npm run lint
npm run build
npm run test:unit
# Integration MUST use a separate test database; setup/reset wipes it
npm run test:db:setup
npm run test:integration
npm run test:e2e
```

- `test:db:setup` và integration/E2E chỉ chạy khi đảm bảo `MONGODB_URI` test không thể trỏ đến DB production. Xem `tests/helpers/test-mongo-env.ts`.
- Nếu `test:e2e` có warning `allowedDevOrigins` khi dùng hostname khác nhau, kiểm tra `playwright.config.ts` và `next.config.ts`; không disable security global.
- Smoke thủ công: vào `/admin`, cài nội dung/protocol được duyệt; tạo và publish content/questions, bật Study Published; mở đường dẫn public ẩn danh; thực hiện consent → hai lượt đọc → hai quiz → complete; kiểm tra MongoDB documents, session detail, Statistics và 5 dạng CSV (wide, long, paired, questions, events).
- Test negative: chưa publish phải chặn; bỏ consent và bypass URL phải chặn; POST điểm client phải bị bỏ qua; submit duplicate không tạo test attempt đôi; edit published content/question phải bị chặn.
- Chỉ đánh dấu valid kết quả sau khi kiểm tra quality; Statistics MAIN không lấy PILOT.

## C. Kết quả kiểm tra thực hiện trong môi trường tạo ZIP

| Kiểm tra | Trạng thái | Ghi chú |
|---|---|---|
| Audit source/routes/models | PASS (static inspection) | Đọc source hiện có |
| TypeScript/TSX syntax transpilation | PASS | 111 file source/test `.ts/.tsx` kiểm tra bằng TypeScript transpileModule, không phải `tsc` typecheck |
| `npm ci` | FAIL (environment) | Registry/npm install không hoàn tất trong sandbox; offline thiếu gói cache |
| `npm run typecheck` | NOT VERIFIED | Thiếu project dependencies |
| `npm run lint` | NOT VERIFIED | Thiếu project dependencies |
| `npm run build` | NOT VERIFIED | Thiếu project dependencies |
| `npm run test:unit` (Vitest) | NOT VERIFIED | File test đã tạo, chưa chạy Vitest |
| Pure TypeScript statistics smoke assertions | PASS | Kiểm tra trực tiếp hàm phân tích và chặn gộp revision khác nhau (không phải Vitest) |
| MongoDB integration/E2E | NOT VERIFIED | Không kết nối database production, không chạy destructive tests |
| Vercel production deployment | NOT VERIFIED | Không có dự án deployment/credential |

## D. Dashboard usage

1. `npm run create-admin` trong môi trường phù hợp và mở `/admin/login` để đăng nhập.
2. `/admin` điền wording phiên bản được duyệt, min reading time, chọn PILOT hoặc MAIN, lưu trước **chưa publish**.
3. `/admin/content` tạo raw text, preview V1/V2, publish revision.
4. `/admin/questions` tạo 5 câu x 4 lựa chọn; chỉ một đáp án đúng mỗi câu; publish revision.
5. Trở lại `/admin`, xem toàn bộ `Experiment Readiness Check`. Khi các thiếu sót học thuật/đạo đức đã xác nhận, bật checkbox **Publish public study** và lưu.
6. Public link là `APP_URL`; server chỉ hiện Start Study nếu readiness đạt. Không tự bypass gate.
7. `/admin/sessions` xem trạng thái và mở từng session xem 2 lượt + event + mark VALID/INVALID. `/admin/statistics` xem paired results; `/admin/exports` xuất MAIN/PILOT theo wide, long, question, events.

## E. Deploy

Vercel cho Next.js nếu deployment phù hợp: kết nối repository, build mặc định `npm run build`, cấu hình `MONGODB_URI`, `AUTH_SECRET`, `APP_URL` qua Vercel Environment Variables, domain HTTPS; cấu hình MongoDB Atlas Network Access và TLS phù hợp. Bảo đảm index được tạo bởi quy trình riêng (`npm run db:indexes`) trước khi mở study, tạo admin qua CLI an toàn (không chạy create-admin trong build).

Sau deploy: thử không đăng nhập admin, đăng nhập admin, ẩn danh bắt đầu, reload giữa hai lượt, consent decline, withdraw, export CSV, check traces/error logs đã redacted. Không tuyển người trước khi Ethics/Proposal và bài đọc/câu hỏi được phê duyệt.

## F. Việc còn thiếu để được tuyên bố production-ready

- Quyết định **AB/BA hay fixed V1→V2** với Proposal/Ethics; không áp dụng cả hai theo ý thích.
- Xác minh và điền protocol/consent/debrief/dữ liệu source chính thức; quyết định retention/withdrawal deletion.
- Kiểm chứng privacy scope cho option-change logging trước khi bật, thiết kế nếu được duyệt.
- Session ID đã là mã ẩn danh của session, **chưa có participant ID riêng** liên kết nhiều phiên nếu protocol đòi hỏi.
- Rate limiting phân tán phù hợp môi trường Vercel, chống abuse và hạn chế export rất lớn chưa được kiểm thử tải thực tế.
- Chạy Vitest, MongoDB integration, Playwright, WCAG/manual mobile, deploy smoke; không đánh dấu production-ready cho đến khi đạt.
