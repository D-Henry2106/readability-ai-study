# 03 — Kiến trúc và luồng dữ liệu

```text
ChatGPT/AI trên web (ngoài ứng dụng; không dùng API key)
   ↓ người nghiên cứu sao chép văn bản đã kiểm tra
Research Dashboard → Package Wizard → ContentService + QuestionService
   ↓ validation Zod / lexical integrity / phiên bản
Content Package (DRAFT) → Validate + Publish → PUBLISHED
   ↓ chọn ở server theo cấu hình PILOT/MAIN
Participant Session (ghim packageId, package revision,
                     contentRevisionId, questionSetId, topic, thời điểm)
   ↓ Consent + Demographics / AB-BA được gán theo logic có sẵn
Reading 1 (V1 hoặc V2) → Quiz 1 → Break
   ↓
Reading 2 (phiên bản còn lại) → Quiz 2 → Complete
   ↓
MongoDB: sessions, readings, attempts, events, ...
   ↓
Research Dashboard / Statistics (cohort) / CSV
```

## Collection mới

`content_packages` lưu `code`, `title`, `topic`, `phase`, `revision`, `status`, `enabled`, `contentRevisionId`, `questionSetId`, `aiSource`, timestamps. Hai revision được tham chiếu (không sao chép văn bản vào Package).

## Quy tắc phân công

- `FIXED`: dùng ID Package đã cấu hình; khi đúng một bộ hợp lệ thì có thể dùng bộ đó.
- `RANDOM`: server dùng `crypto.randomInt` để chọn trong các Package `PUBLISHED`, `enabled`, đúng phase, có content/question đã khóa và hợp lệ.
- `MAIN`: chặn random nếu `mainRandomApproved` không được người nghiên cứu xác nhận.
- Gán Package **một lần khi tạo session**; đã lưu thì reload, đổi tab, cấu hình/Archive sau đó không thay đổi revision của session.
- Phân nhóm A/B là bước **khác** với Package assignment, diễn ra sau Demographics như code gốc. Chấm điểm luôn dùng `session.questionSetId` đã ghim.

## V1/V2 và kiểm soát học thuật

V1 sử dụng chuỗi `rawContent`. V2 phân thành khối hiển thị với `accessibleVisualBlocks`; nối toàn bộ chuỗi khối tái tạo **chính xác từng ký tự**. CSS tăng nhóm thị giác/nhấn mạnh. Không viết lại, thêm từ, dịch hoặc tạo tiêu đề học thuật mới.

## Revision safety

- `PUBLISHED` content/questions được đánh dấu `locked: true` và từ chối `updateDraft`.
- Sửa bản Published bằng clone tạo revision Package, Content và Questions mới, dữ liệu cũ giữ nguyên.
- `ARCHIVED` chỉ ngăn phân công phiên **mới**. Session cũ dùng revision đã ghim và vẫn hoàn thành bình thường.
- Một số bản ghi trước nâng cấp không có packageId; export giữ ô trống và phân biệt nhóm `legacy`.

## API

- `GET /api/admin/packages`: liệt kê danh sách, content + questions (admin only).
- `POST /api/admin/packages` với `action=CREATE|UPDATE|PUBLISH|ARCHIVE|CLONE`: yêu cầu `RESEARCHER` và validation server.
- `POST /api/admin/config`: cấu hình `assignmentMode`, `fixedPackageId`, `mainRandomApproved`, các thông số protocol; giữ nguyên routes cũ.
- Public endpoints và contracts hiện có không nhận Package ID tự do, không trả correct answers.
