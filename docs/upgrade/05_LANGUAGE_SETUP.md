# 05 — Giao diện tiếng Việt mặc định

- `<html lang="vi">` được đặt trực tiếp tại `src/app/layout.tsx`.
- `npm run dev`, `npm run build` và `npm run start` dùng **cùng giao diện tiếng Việt**, không cần lệnh `dev:vi`, biến môi trường hoặc language switcher.
- Không sử dụng thư viện i18n ở giai đoạn này. UI strings đặt trong component/route hiện hữu để triển khai nhanh; có thể gom vào từ điển khi bổ sung i18n sau.
- Dữ liệu học thuật và protocol đã phê duyệt được giữ nguyên **ngôn ngữ lưu trong MongoDB**; `rawContent`, câu hỏi, phương án, Consent/Information/Debrief không được dịch tự động.
- Tên trường API, collection và cột CSV tiếp tục bằng tiếng Anh để giữ tương thích và phân tích nghiên cứu.
- Với học liệu nguồn tiếng Anh có thể khai báo `lang="en"` ở vùng nội dung nếu đã xác định trước ngôn ngữ nguồn; không giả định mọi nội dung dán đều tiếng Anh.
- Một số mã trạng thái kỹ thuật, tên giai đoạn `PILOT/MAIN`, thuật ngữ V1/V2/AB/BA, ID và mã revision được giữ nguyên.

## Thử nghiệm giao diện

1. `npm run dev`, kiểm tra trang chủ, Information, Consent, Demographics, Reading, Quiz, Break, Complete và Dashboard.
2. `npm run build && npm run start`, xác nhận cùng các trang bằng tiếng Việt.
3. Đối chiếu nguyên văn 1 bài đọc, 1 Question Set, 1 bản Consent đã duyệt với dữ liệu nguồn để đảm bảo không có dịch hoặc chỉnh sửa.
4. Thử kích thước màn hình mobile, điều hướng bàn phím, các thông báo lỗi/empty/loading.
