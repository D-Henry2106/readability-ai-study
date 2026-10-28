# 04 — Hướng dẫn quản trị bằng tiếng Việt

## Cài đặt và chạy

1. Dùng Node.js >= 20.9 và MongoDB riêng cho môi trường mong muốn.
2. `npm ci` để cài dependency.
3. Tạo `.env.local` bằng tay theo tài liệu triển khai hiện có; **không sao chép secret từ ZIP cũ**. Khởi tạo biến môi trường theo hướng dẫn trong `docs/DEPLOYMENT.md`.
4. `npm run db:check`, `npm run db:indexes`, `npm run create-admin` theo tài liệu hiện có.
5. `npm run dev` để phát triển hoặc `npm run build` sau đó `npm run start` để chạy production.

## Đăng nhập và Sidebar

Truy cập `/admin/login`, đăng nhập tài khoản `RESEARCHER`. Sidebar điều hướng đến Tổng quan, Cấu hình, Bộ nội dung, Phiên tham gia, Thống kê, Xuất dữ liệu. Quyền `SUPERVISOR` chỉ xem, không đăng nội dung/xuất CSV.

## Tạo bộ Content Package

1. Mở **Bộ nội dung thực nghiệm** (`/admin/content`) → **Tạo bộ nội dung mới**.
2. Điền mã duy nhất (ví dụ `LESSON_AI_01`), tên, chủ đề và chọn PILOT/MAIN.
3. Từ ChatGPT/AI bản web, **sao chép** nội dung đã duyệt, **dán nguyên văn** vào textarea. Không cần khóa AI API.
4. Xem preview V1/V2. Hai bản cùng văn bản gốc; chỉ đổi cách trình bày.
5. Nhập chính xác năm câu hỏi, mỗi câu bốn lựa chọn, đánh dấu một đáp án đúng. Nhóm nội dung được gợi ý lần lượt: khái niệm, thuật ngữ, quan hệ, điều kiện, suy luận.
6. Kiểm tra thông tin và **Lưu bộ nội dung nháp**.
7. Nếu cần sửa, chọn **Chỉnh sửa** ở bản nháp. Khi đầy đủ cấu hình protocol, chọn **Xuất bản** để khóa Content/Questions và Package.
8. Sau xuất bản, muốn sửa phải **Tạo phiên bản mới**; không thay nội dung của các session cũ. Có thể **Lưu trữ** một bản Published để dừng phân công mới.

## Cấu hình PILOT và MAIN

1. Mở **Cấu hình nghiên cứu** (`/admin/config`).
2. Điền đúng Participant Information, Consent, Debrief, quyền dữ liệu, thông tin kết quả, thời gian đọc tối thiểu và các trường phiên bản theo phê duyệt thực tế.
3. **PILOT**: có thể chọn **Ngẫu nhiên trong các bộ đã xuất bản** để kiểm thử nhiều Package.
4. **MAIN**: ưu tiên **Một bộ cố định** theo Proposal/Ethics. Không chọn nhiều Package ngẫu nhiên nếu chưa được phê duyệt; nếu được phép, quản trị viên chủ động xác nhận cờ phê duyệt.
5. Lưu và khi checklist tổng quan đạt yêu cầu, bật **Mở nghiên cứu**. Nếu chưa đủ điều kiện, trang chủ chặn bắt đầu.

**Lưu ý:** Bước xuất bản Package yêu cầu protocol cơ bản đầy đủ; điền cấu hình tài liệu đã duyệt **trước** khi xuất bản nội dung. Khi lưu cấu hình, nếu không đủ điều kiện, hệ thống không mở tuyển người tham gia.

## Kiểm tra kết quả

- **Phiên tham gia:** tìm theo mã phiên hoặc mã Package; xem group A/B, tình trạng, điểm V1/V2, cờ hợp lệ.
- **Thống kê:** xem riêng PILOT/MAIN, Package và revision. Không dùng trung bình gộp các bài đọc khác nhau để khẳng định hiệu quả.
- **Xuất dữ liệu:** chọn Wide / Long / Paired / Questions / Events, chọn PILOT hoặc MAIN; tải CSV bằng tài khoản `RESEARCHER`. Mã/cột dữ liệu giữ tiếng Anh để phục vụ phân tích.

## Khuyến nghị vận hành

Dùng cơ sở dữ liệu test riêng cho integration/E2E; không chạy `test:db:reset` vào DB thật. Trước MAIN cần thử luồng qua cả nhóm A và B, kiểm tra ẩn đáp án và rà soát Proposal/Ethics.
