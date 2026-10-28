# 07 — Các quyết định nghiên cứu cần xác nhận

## Các mục được giữ nguyên

- Research question: *How does accessible web content presentation affect students' comprehension of AI-generated learning materials, as measured by the number of correct answers on a comprehension test?*
- Hai điều kiện V1/V2 là **cùng câu chữ và cùng kiến thức** (same semantic and lexical content), chỉ khác presentation.
- Thứ tự nghiên cứu A: V1 → quiz → nghỉ → V2 → quiz; B: V2 → quiz → nghỉ → V1 → quiz.
- Điểm do server chấm, mỗi lượt 5 câu, thang 0–5. `VALID` cần xét duyệt, không tự mặc định theo completion.

## Các câu hỏi bắt buộc đối chiếu Proposal/Ethics

1. **Có cho phép nhiều bài đọc khác nhau?** Nếu chưa rõ, chọn `MAIN = FIXED` với một Package đã duyệt. Có thể thử `PILOT = RANDOM` khi được phép ở giai đoạn thử nghiệm.
2. **Độ khó/độ dài/sự quen thuộc với chủ đề:** các Package khác nhau có thể gây sai lệch. Cần kiểm định tương đương theo protocol; không tự so sánh điểm gộp.
3. **Question Set:** mỗi Package phải có bộ 5 câu tương ứng, có độ khó/cấp độ nhận thức được đối chiếu. Hai lượt của cùng session dùng cùng bộ câu hỏi như thiết kế ban đầu.
4. **Order AB/BA:** cơ chế cân bằng hiện tại vẫn còn. Không tự thay sang phân nhóm mới hoặc thay quy tắc cân bằng.
5. **Practice/carry-over:** hỏi lại cùng bộ câu hỏi ở lượt thứ hai có thể tạo tác động học nhớ; đây là giới hạn phương pháp nghiên cứu cần ghi rõ.
6. **Thời gian đọc, thời gian nghỉ và tracking events:** chỉ sử dụng các mốc và sự kiện đã phê duyệt. Không thêm đo click từng đáp án hoặc dữ liệu nhận diện.
7. **Migration dữ liệu lịch sử:** session cũ không có Package ID phải được giữ và phân tích riêng; không tự gán một Package tùy ý.
8. **Phân tích thống kê:** cung cấp mô tả theo Package/nhóm; không tự áp dụng kiểm định suy luận, không tuyên bố khác biệt có ý nghĩa thống kê khi chưa có phương pháp được duyệt.

## Chốt trước khi mở MAIN

- [ ] Research Proposal/Ethics xác nhận số lượng Package cho MAIN.
- [ ] Tài liệu được duyệt giữ nguyên ngôn ngữ và câu chữ.
- [ ] Gán Package cố định hoặc random theo phương án đã xác nhận.
- [ ] Chấm điểm và export đúng revision qua PILOT (cả nhóm A/B).
- [ ] Tất cả bài test typecheck/lint/unit/build/integration/E2E chạy đạt.
