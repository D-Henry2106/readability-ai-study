# Giải thích website bằng tiếng Việt

## 1. Website này làm gì?

Đây là một **Controlled Online Research Experiment Platform** dùng để chạy thí nghiệm đọc trực tuyến. Mục tiêu hệ thống không phải là làm một website nội dung thông thường mà là giữ đúng quy trình nghiên cứu và thu dữ liệu có thể phân tích sau này bằng SPSS/R/Python.

Website có hai khu vực:

1. **Participant Area**: người tham gia đi qua Information → Consent → Demographics → 2 vòng Reading/Test có break ở giữa → Complete/Debrief.
2. **Admin/Researcher Area**: researcher cấu hình protocol, quản lý content/questions, theo dõi session, đánh dấu validity và export dữ liệu.

## 2. Thiết kế nghiên cứu

Đây là thiết kế **within-subject**: cùng một participant trải nghiệm cả hai presentation V1 và V2. Vì thứ tự có thể tạo hiệu ứng học/quen, hệ thống dùng **counterbalancing**:

```text
Group A: V1 → Test → Break → V2 → Test
Group B: V2 → Test → Break → V1 → Test
```

Backend gán group đúng một lần sau demographics và lưu MongoDB. Refresh không đổi group.

## 3. V1 và V2

Điểm quan trọng nhất là V1 và V2 dùng **cùng một raw content**. V2 chỉ thay đổi presentation như line-height, font size, max-width, spacing và khả năng đọc. Không thêm heading, summary, ví dụ hay câu giải thích mới.

Nhờ vậy biến độc lập là presentation format chứ không phải thay đổi nội dung.

`content-integrity.ts` normalize text và tạo SHA-256 hash. Admin preview cho phép xem cùng content ở hai cách render.

## 4. Vì sao state machine nằm ở server?

MongoDB lưu `currentStage`. Frontend không được tự quyết người dùng đang ở bước nào.

Ví dụ participant đang `READING_1` nhưng gõ trực tiếp `/experiment/test`: trang test sẽ đọc session phía server, thấy stage không đúng và đưa participant về `/experiment/reading`. Nếu người dùng gọi API test trực tiếp, API cũng kiểm tra stage nên không bypass được.

Đây là lý do hệ thống đáng tin cậy hơn chỉ dùng React state/localStorage.

## 5. Anonymous session và cookie

Khi bắt đầu, server tạo UUID ngẫu nhiên. UUID được lưu trong HttpOnly cookie `exp_session`.

Hệ thống không yêu cầu tên, email, số điện thoại, student ID hoặc địa chỉ. Research data không được lưu vào localStorage/IndexedDB.

Cookie chỉ giúp server tìm session MongoDB tương ứng; source of truth vẫn là database.

## 6. Protocol readiness

Project cố ý không bịa Information Sheet, Consent, Debrief, raw content, MCQ hay minimum reading time.

Nếu các giá trị này chưa có, `ReadinessService` trả dạng:

```json
{
  "ready": false,
  "missing": ["MINIMUM_READING_TIME", "PUBLISHED_CONTENT_REVISION"]
}
```

Khi `ready=false`, participant không tạo session mới được.

## 7. Reading timer

Khi trang reading mở, server tạo `reading_sessions` cho round hiện tại nếu chưa tồn tại. `startedAt` chỉ tạo lần đầu nên refresh không reset timer.

Khi participant bấm Continue, client gửi scroll metrics và timestamp mô tả, nhưng server tự tính elapsed time từ `startedAt`. Chỉ khi đủ minimum reading time đã được protocol approve thì server mới cho chuyển sang test.

## 8. Scroll metrics

Client chỉ lưu:

- `scrollCount`;
- `maxScrollDepthPercent` từ 0 đến 100.

Listener được throttle khoảng 250 ms. Không lưu từng pixel hoặc toàn bộ lịch sử scroll.

## 9. MCQ và scoring

Question set bắt buộc:

- 5 questions;
- 4 options/question;
- đúng 1 correct option/question.

Participant client chỉ nhận `question id`, `prompt`, `option id`, `option text`. `isCorrect` và score không được gửi xuống participant.

Khi submit, `ScoringService` chạy ở server và tính score 0–5.

Nếu chưa trả lời đủ, UI cảnh báo nhưng participant vẫn có thể submit. Unanswered được lưu là `null`, không biến thành đáp án giả.

## 10. Chống double submit

MongoDB tạo unique index:

```text
(sessionId, roundNo)
```

trên `test_attempts`. Vì vậy double-click hoặc hai request đồng thời không tạo hai attempt cho cùng round.

## 11. Break 120 giây

Sau Test Round 1, server tạo break với `startedAt`. Client chỉ hiển thị remaining seconds do server tính. Refresh không tạo break mới và không reset thời gian.

Server không cho chuyển qua Reading Round 2 trước đủ 120 giây.

## 12. Withdrawal và Incomplete

Participant có thể Withdraw ở các bước active và không phải đưa lý do.

`WITHDRAWN` khác `INCOMPLETE`. Đóng browser không tự động bị xem là withdrawal. Project không tự bịa một ngưỡng “abandoned sau X phút” vì protocol chưa cung cấp. Đây là limitation được ghi rõ.

## 13. Content revision và Question revision

Researcher tạo draft, kiểm tra rồi Publish. Khi publish, revision bị lock.

Session mới pin `contentRevisionId` và `questionSetId`, nên nếu researcher publish revision mới thì session đang chạy vẫn dùng revision cũ.

Protocol wording và minimum reading time cũng được snapshot vào session khi bắt đầu để tránh thay đổi giữa chừng.

## 14. Admin authentication

Không có public signup.

Admin được tạo bằng:

```bash
npm run create-admin
```

Password được hash bằng scrypt + random salt. Admin cookie được ký HMAC-SHA256 bằng `AUTH_SECRET`, HttpOnly, Secure ở production và hết hạn sau 8 giờ.

Role:

- `RESEARCHER`: chỉnh protocol/content/questions, validity, export.
- `SUPERVISOR`: read/review.

## 15. Dashboard

Dashboard dùng dữ liệu MongoDB thật. Khi DB trống thì count bằng 0.

Các chỉ số chỉ mang tính descriptive: started/completed/incomplete/withdrawn, validity và group balance. Hệ thống không chạy p-value, t-test, Wilcoxon hay kết luận “V2 tốt hơn”.

## 16. CSV

Wide CSV: 1 participant/session = 1 row, gồm demographics, group, scores, reading metrics, answers, completion và validity.

Long CSV: 1 session × round = 1 row với presentation, score, reading seconds và scroll metrics.

Missing value để blank, không đổi thành 0.

## 17. MongoDB

Luồng điển hình:

```text
Browser
→ Route Handler
→ Zod Validation
→ Cookie/Auth/Stage Check
→ Service
→ ResearchRepository
→ MongoDB
```

`Repository` chịu trách nhiệm thao tác collection. `Service` chứa business rule. React component không chứa scoring/counterbalancing/state transition quan trọng.

## 18. Accessibility

General UI dùng semantic HTML, label, focus visible, keyboard interaction, reduced motion và responsive layout.

Experimental reader được scope riêng để global accessibility CSS không vô tình làm V1 giống V2.

## 19. SEO

Chỉ landing page được đưa vào sitemap. Admin, experiment, consent, demographics, complete, withdraw, exit và API đều noindex/disallow.

Mục tiêu là tránh lộ experimental material và question set qua search engine.

## 20. Security

Các điểm chính:

- secrets chỉ từ environment variables;
- không commit `.env`;
- HttpOnly cookies;
- role check phía server;
- Zod validation;
- MongoDB query bằng object, không nối chuỗi query;
- không expose stack trace;
- không lưu password/token trong audit;
- không cài marketing tracker.

## 21. Testing

Có 3 tầng:

- unit: logic độc lập;
- integration: MongoDB test DB;
- E2E: Playwright chạy full participant flow.

Fixture chỉ tồn tại trong test database có tên chứa `test`. Production/development DB không được seed fake research data.

## 22. Deployment

Mô hình:

```text
GitHub
→ Vercel
→ Next.js
→ MongoDB Atlas
```

Bạn cấu hình Atlas, environment variables, create admin, publish approved protocol/content/questions, chạy test/build rồi kiểm tra Readiness trước khi mở recruitment.

## 23. Cách giải thích với lecturer/supervisor

Bạn có thể mô tả ngắn:

> Hệ thống dùng Next.js full-stack và MongoDB. Research flow được điều khiển bằng state machine phía server để chống skip và đảm bảo refresh-safe. Participant được counterbalance A/B và cả hai presentation dùng cùng raw content để giữ zero lexical difference. Timing, scoring và idempotency đều được xác thực phía server. Admin quản lý revision, validity và export nhưng thống kê suy luận được tách khỏi website để tránh bias và giữ hệ thống đúng scope nghiên cứu.

## 24. Feature cố ý không thêm

Không có participant account, AI chatbot, recommendation, notification, gamification, social login, CMS ngoài, analytics marketing, heavy animation hoặc microservices vì các feature này không có research purpose và có thể tăng confounding/complexity.
