# 01 — Rà soát source trước nâng cấp

## Hiện trạng được xác minh từ source ZIP

- **Framework:** Next.js `16.3.8` (App Router), React `19.3.0`, TypeScript `5.9.2`, Tailwind CSS 4.
- **Database:** MongoDB Node Driver `7.7.0`, repository dùng trực tiếp `db.collection<T>()` (không phải Mongoose).
- **Authentication:** cookie/session admin hiện hữu với phân quyền `RESEARCHER`/`SUPERVISOR`; participant dùng cookie phiên ẩn danh.
- **Experimental flow:** Information → Consent → Demographics → Reading 1 → Review 1 → Test 1 → Break → Reading 2 → Review 2 → Test 2 → Complete.
- **Thiết kế thứ tự:** A: V1→V2, B: V2→V1, cơ chế cân bằng số lượng A/B hiện tại được **giữ nguyên**.
- **V1/V2:** một chuỗi nguồn; V2 dùng `accessibleVisualBlocks()` để phân đoạn, nối ngược lại khớp chính xác bản nguồn.
- **Câu hỏi:** 5 câu, mỗi câu 4 lựa chọn, đáp án chỉ lưu backend, chấm điểm phía server.

## Bảng audit

| Module | Existing | Missing/Broken trước nâng cấp | Need modification / kết quả |
|---|---|---|---|
| Next.js routes / layouts | Có | Chưa có Package API; Dashboard dùng header menu | Tái dùng route hiện có; thêm `/api/admin/packages`, trang cấu hình, Sidebar |
| Admin authentication / RBAC | Có | Không phát hiện nhu cầu thay Auth | Dùng `requireAdmin(['RESEARCHER'])` cho các thao tác ghi |
| Public session APIs | Có | Session chọn Content và Question published mới nhất **độc lập** | Chuyển lựa chọn sang Published Package có cặp revision xác định |
| MongoDB repository / indexes | Có | Chưa có `content_packages` | Mở rộng repository, thêm collection và index |
| Content revision | Có | Không liên kết revision câu hỏi | Tái dùng ContentService, hash, publish bất biến |
| Question revision | Có | Không gắn đúng Content Package | Tái dùng QuestionService, Zod và server-side scoring |
| Publication / readiness | Có | Readiness chấp nhận hai revision rời rạc | Kiểm tra Published Package và cấu hình phân công |
| Experimental AB/BA | Có | Không phát hiện thay đổi cần thiết | Giữ `assignment.service.ts` và `presentationForRound()` |
| Session assignment | Có | Chưa chọn và ghim Package | Sử dụng `crypto.randomInt` phía backend; lưu Package và các revision |
| Reading / quiz / scoring | Có | Rủi ro dữ liệu không tương ứng do session cũ | Tái dùng revision ID đã ghim; không gửi đáp án đúng công khai |
| Event logging | Có | Chưa có sự kiện gán Package | Thêm `PACKAGE_ASSIGNED`, tái dùng event idempotency |
| Statistics | Có | Chưa phân biệt Package trong cohort | Phân nhóm Package + revision; nhóm A/B; không gộp bản không tương đương |
| CSV export | Có | Thiếu metadata Package | Bổ sung cột định danh Package trong nhiều loại CSV |
| Dashboard UI / UX | Có | Form cấu hình dài, raw readiness JSON, không sidebar | Sidebar, overview, checklist, Package wizard |
| Giao diện tiếng Việt | Chưa thống nhất | UI gốc phần lớn tiếng Anh | Chuyển UI ứng dụng sang tiếng Việt mặc định; giữ nguyên dữ liệu nghiên cứu |
| Integration/E2E | Có | Test fixtures chưa có Package và selector còn tiếng Anh | Cập nhật fixture/test; chạy thực tế cần MongoDB test riêng |

## Những rủi ro và giới hạn phát hiện

1. Trước nâng cấp, `getPublishedContent()` và `getPublishedQuestionSet()` dùng hai truy vấn độc lập với `revision` mới nhất. Điều này có thể ghép nhầm tài liệu; luồng tạo session mới đã chuyển sang Package.
2. Các phiên lịch sử không có `assignedPackageId` vẫn đọc/chấm theo `contentRevisionId` và `questionSetId` đã lưu; tuyệt đối không tự cập nhật ngầm thành Package mới.
3. Trong giao diện quản trị cũ, Content và Questions có các route riêng. Chúng được giữ lại nhằm tương thích; **chỉ Package đã xuất bản, đủ điều kiện mới được phân công cho phiên mới**.
4. Cấu hình MAIN không tự random nhiều Package; thay đổi phương pháp phải được phê duyệt.
5. Không truy cập MongoDB thật, không sửa dữ liệu lịch sử và không thử login trên production trong quá trình nâng cấp source.
