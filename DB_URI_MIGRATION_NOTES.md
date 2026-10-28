# Chuyển đổi MongoDB: Chỉ dùng `MONGODB_URI`

## Mục tiêu

- MongoDB lấy **tên database duy nhất từ đoạn `/database` trong connection string**.
- Không còn `MONGODB_DB_NAME`, `MONGODB_TEST_DB_NAME` hay `MONGODB_TEST_URI` trong source/scripts/config/tests/docs.
- `npm run dev` dùng `.env.local`; Integration/E2E dùng `.env.test.local`, cả hai đều khai báo `MONGODB_URI`.
- Giữ nguyên API, schema, authentication, state machine, V1/V2 và logic nghiên cứu.

## Các thay đổi chính xác

| File | Thay đổi | Lý do |
|---|---|---|
| `src/config/env.ts` | Xóa `MONGODB_DB_NAME` khỏi schema; kiểm tra URI có database path | Không còn hardcode database mặc định |
| `src/lib/db/mongodb.ts` | `client.db(getMongoEnv().MONGODB_DB_NAME)` → `client.db()` | MongoDB driver tự chọn DB từ connection URI |
| `src/lib/db/mongodb-uri.ts` (mới) | Kiểm tra và đọc tên DB từ path, không log URI | Tránh vô tình chạy vào database `test` mặc định khi thiếu path |
| `scripts/check-db.ts` | Lấy tên DB từ `db.databaseName` | Hiển thị đúng database thực sự đang dùng |
| `scripts/test-db-setup.ts` | Dùng `MONGODB_URI` + `client.db()` + guard | Kiểm tra DB test |
| `scripts/test-db-reset.ts` | Dùng `MONGODB_URI` + `client.db()` + guard | Chặn reset nhầm DB prod |
| `tests/helpers/test-mongo-env.ts` (mới) | Guard bắt buộc `NODE_ENV=test`, DB name kết thúc `_test`/`-test` | Đảm bảo test phá hủy chỉ chạy trên DB test |
| `tests/helpers/test-db.ts` | Dùng `client.db()` + guard trước `dropDatabase()` | Cùng database với app test |
| `tests/setup.ts` | Bỏ chuyển đổi tên biến test thành biến app | Test đã dùng chung `MONGODB_URI` |
| `tests/integration/research-flow.test.ts` | Bỏ `describe.skipIf` khi thiếu `MONGODB_TEST_URI` | Thiếu URI sẽ fail rõ ràng, không còn `5 skipped` |
| `playwright.config.ts` | Dùng `MONGODB_URI` test trực tiếp; guard trước setup; `reuseExistingServer=false` | Tránh chạy nhầm test trên server dev đang mở |
| `tests/unit/mongodb-uri.test.ts` (mới) | Kiểm tra URI/path và guard từ chối prod | Regression safety |
| `.github/workflows/ci.yml` | Thêm `/ci_build_only` trực tiếp vào URI | CI build không dùng biến DB riêng |
| `.env.example`, `.env.test.example` (mới) | Template không chứa mật khẩu thật | Hướng dẫn cách config URI duy nhất |
| `README.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/PROJECT_REVIEW_2026-10-06.md` | Cập nhật ví dụ và mô tả biến mới | Không còn hướng dẫn theo biến cũ |

Không sửa `package.json`, API, data model, research content hay page UI.

## Cấu hình cần có trên máy của bạn (không gửi credential)

`.env.local` (Next.js development):

```dotenv
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=YOUR_SECRET_AT_LEAST_32_CHARACTERS
APP_URL=http://localhost:3000
```

`.env.test.local` (Integration/E2E):

```dotenv
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=YOUR_TEST_SECRET_AT_LEAST_32_CHARACTERS
APP_URL=http://127.0.0.1:3100
```

> Các tên database ở đây chỉ để minh họa. Code không chứa một tên database cố định.
> **Không nên trỏ `.env.local` và `.env.test.local` tới cùng một DB:** test fixture có `dropDatabase()` sẽ xóa dữ liệu dev.
> Tên DB được chọn từ URI, không phải chỉ từ việc bạn tạo DB trong MongoDB Compass/GUI. DB và collection thường xuất hiện khi có thao tác ghi đầu tiên.

Production: cấu hình `MONGODB_URI` trên Vercel với đường dẫn DB production, ví dụ `/research_experiment_prod`; không cần thay code.

## Cách kiểm tra

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run db:check
npm run test:db:setup
npm run test:integration
npm run test:e2e
npm run build
```

**Cẩn thận:** `npm run test:e2e` và `npm run test:db:reset` có thể xóa/seed lại toàn bộ DB test, vì vậy phải là DB riêng. `test:db:setup` chỉ ping, không drop. Chạy các lệnh DB từ máy bạn, không đưa URI hoặc mật khẩu vào log/chat.

Sau khi đổi đường dẫn database trong `.env.local`, **restart `npm run dev`** vì MongoDB client được cache trong process đang chạy. Với production, cập nhật environment variable và redeploy/restart service.

## Bảo mật và phát hành

- ZIP kết quả **không bao gồm** `.env.local`, `.env.test.local`, `test-results`, `tsconfig.tsbuildinfo`, `node_modules` hoặc artifact sinh tự động.
- URI chứa credential từng được chia sẻ trong hội thoại: phải thay đổi password/rotate MongoDB Atlas user trước khi sử dụng lại.
- Kiểm tra `.gitignore` và không commit biến môi trường chứa credentials.
