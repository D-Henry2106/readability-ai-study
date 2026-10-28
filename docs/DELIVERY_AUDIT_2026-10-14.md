# CRP Source audit — 14 October 2026

## Phạm vi thực sự đã kiểm tra

Đã đọc cây source Next.js (App Router), package.json, repository MongoDB, indexes, API participants/admin, readiness, assignment, content, question, presentation, reading, scoring, export, dashboard, test fixtures và các tài liệu giao thức trong repo. **Chưa truy vấn được database production**; không được tự kết luận MongoDB đã có/chưa có dữ liệu hay deploy đã chạy.

| Thành phần | Trạng thái trước chỉnh sửa | Bằng chứng trong code / kết quả audit |
|---|---|---|
| Trang Home / Start | EXISTING, bị readiness gate | `src/app/page.tsx`, `StartButton.tsx`; nút bị ẩn khi `ready:false`, không phải thiếu UI |
| `Study unavailable` | BLOCKED BY DESIGN, DB thực tế NOT VERIFIED | `readiness.service.ts`: yêu cầu information, consent, debrief, data rights, findings, min reading, published content/questions. `research/UNRESOLVED_PROTOCOL_VALUES.md` ghi nhiều giá trị chưa được phê duyệt. Nếu MongoDB/API lỗi thì trang chủ fallback `DATABASE_OR_CONFIGURATION_UNAVAILABLE` |
| Session/Consent/Demographics | EXISTING | API `session`, `information/ack`, `consent`, `demographics`; repository MongoDB |
| Luồng 2 lượt + break 120 giây | EXISTING | state machine, `reading`, `test`, `break` routes, guard server-side |
| Random group A/B | EXISTING; PROTOCOL CONFLICT PENDING | `assignment.service.ts`, `presentation.ts`, `docs/EXPERIMENT_FLOW.md` |
| V1/V2 lexical integrity | EXISTING | cùng rawContent, `accessibleVisualBlocks` nối lại nguyên chuỗi |
| 5 câu MCQ + score server-side | EXISTING | `questionSetSchema`, `ScoringService` |
| Published content/question revision immutable | EXISTING | repository update draft chỉ cho DRAFT/unlocked; session pin ObjectId |
| Backend data persistence | EXISTING, runtime NOT VERIFIED | MongoDB Native Driver + indexes + repositories |
| Dashboard & sessions details | EXISTING, statistics NEED MODIFICATION | metrics cơ bản có nhưng trước patch không có kết quả mô tả paired V1/V2 |
| Event logging | EXISTING nhưng PARTIAL | event stage transitions có; question selection/change chưa theo dõi |
| CSV export | EXISTING nhưng PARTIAL | Wide/long, chưa có event/questions format riêng trước patch |
| Public/admin separation | EXISTING | admin protected layout, role gates APIs |
| Thống kê suy luận / kiểm định | NOT IMPLEMENTED BY DESIGN | Chưa đủ protocol và điều kiện dữ liệu để tự quyết định test |
| Permission of answer-change logging, data retention/deletion on withdrawal | NOT VERIFIED | Phải đối chiếu văn bản Ethics, không tự bổ sung theo giả định |

## Kết luận về `study unavailable`

Readiness phụ thuộc MongoDB config và các bản **published**. Chỉ sửa giao diện hoặc ép `ready = true` sẽ khiến người tham gia đi vào một thực nghiệm không có protocol hợp lệ. Patch bổ sung **cờ publish nghiên cứu riêng** và checklist hiện rõ trong dashboard. Database nguồn chưa được kết nối/xác minh nên không biết chính xác ô nào đang thiếu trong dữ liệu thật. Vào `/admin`, kiểm tra `Experiment Readiness Check`, cấu hình text/phiên bản theo tài liệu đã phê duyệt, thêm reading/question và publish; sau đó đánh dấu **Publish public study**.

## Mâu thuẫn bắt buộc cần xác nhận

- **Thứ tự:** Request mới mô tả V1→V2; source có A: V1→V2, B: V2→V1. Chưa có Proposal/Ethics Approval đính kèm ở task này để kết luận. Giữ nguyên AB/BA và khóa public cho đến khi xác nhận phù hợp.
- **Phiên bản trình bày:** V2 chỉ thay đổi bố cục CSS, spacing và grouping ký tự gốc; không tự thêm heading mới, tóm tắt hay nhãn mang thêm thông tin. Nếu protocol cho phép lấy chính từ ngữ V1 làm heading/bold, cần duyệt cụ thể trước khi đổi renderer.
- **Tư cách tham gia, consent, demographics, thời gian đọc tối thiểu, retention/withdrawal:** Những nội dung này là quyết định học thuật/đạo đức; repo không chứa văn bản Ethics được đối chiếu đầy đủ.

**KHÔNG công khai tuyển người tham gia thực tế** nếu các quyết định trên chưa được xác nhận và cấu hình chưa đủ.
