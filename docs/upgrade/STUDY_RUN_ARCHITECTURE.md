# Study Run V1/V2 – Kiến trúc và tiêu chí nghiệm thu (cập nhật theo Design Decision đã phê duyệt)

Trạng thái: P0 hoàn thành. Chưa có mã nào của Study Run (P1–P7) được viết.
Tài liệu này thay thế bản đề xuất trước; mọi mục "Quyết định tự đặt" ở §11 có thể bị đảo ngược.

## 1. Quyết định đã phê duyệt

| # | Quyết định |
|---|---|
| D1 | Phương án B, between-subjects: mỗi người chỉ trải nghiệm **một** variant (V1 hoặc V2). |
| D2 | Luồng Study Run: INFORMATION → CONSENT → DEMOGRAPHICS → READING → REVIEW → TEST → COMPLETED. Không có BREAK, READING_2, REVIEW_2, TEST_2. |
| D3 | Cùng một content revision và cùng một question set cho V1 và V2. |
| D4 | Luồng within-subjects cũ và mọi dữ liệu lịch sử giữ nguyên hoàn toàn; không migrate, không sửa. |
| D5 | Admin quyết định tất cả; hệ thống chỉ thống kê, kiểm tra, cảnh báo (§2). |
| D6 | Invitation gắn cố định với Study Run và variant; token băm trước khi lưu; dùng một lần để tạo một session; mở lại thì resume. |
| D7 | Chữ đậm của V2 do Admin chọn thủ công từ từ/cụm từ có sẵn; có thể không dùng; có Preview; lưu metadata riêng; khóa khi đã phát hành invitation. V1 giữ nguyên. |
| D8 | Chỉ session COMPLETED + VALID (do Admin đánh dấu) được tính quota, mỗi session đúng một lần. Dữ liệu vượt quota được giữ và đánh dấu bổ sung. |
| D9 | Giữ PILOT/MAIN, GroupCode A/B và cấu trúc dữ liệu cũ; không dùng A/B thay cho V1/V2. |
| D10 | Thêm `study_runs`, `invitations`, `presentation_profiles` và các trường bổ sung trên `sessions`. |

## 2. Nguyên tắc "Admin quyết định" (bắt buộc)

Hệ thống **không bao giờ tự động**: chuyển variant, đổi quota, tạo invitation, gửi invitation, mở/tạm dừng/đóng Study Run,
thu hồi invitation, hết hạn invitation, xóa hay loại bỏ dữ liệu, chuyển phiên bị vượt quota thành tính quota.

| Hành động | Ai được làm | Ghi nhận |
|---|---|---|
| Tạo/sửa Study Run, nhập tổng sample size (chẵn) | Admin (RESEARCHER) | audit |
| Xác nhận quota chia đều V1/V2 trước khi lưu | Admin, bước xác nhận bắt buộc | audit |
| Chọn variant, nhập số lượng, tạo invitation, tải link | Admin | audit (link chỉ hiện một lần) |
| Mở, tạm dừng, tiếp tục, đóng tuyển | Admin | audit |
| Thu hồi invitation, tạo invitation thay thế, tạo thêm khi đã đạt quota | Admin | audit |
| Đánh dấu VALID/INVALID (kéo theo ghi quota) | Admin | audit + `reviewedBy` |
| Đưa một session bổ sung vào quota (khi có chỗ trống) | Admin | audit |

Hệ thống chỉ **cảnh báo**, không hành động: quota nhánh đạt mục tiêu; cả hai nhánh đạt; vượt quota; còn invitation chưa dùng khi đóng;
có chỗ trống quota do một session bị đổi sang INVALID; số invitation đã phát lớn hơn số còn thiếu; profile chưa xác nhận.
Test tự động bảo vệ nguyên tắc: không có đường mã nào ghi vào `study_runs.status`, `arms`, `invitations` ngoài các endpoint admin
đã xác thực vai trò RESEARCHER và service tương ứng.

## 3. Luồng participant: cũ và mới

Điểm rẽ nhánh duy nhất là `session.studyRunId` (vắng mặt = luồng cũ, không đổi một dòng hành vi).

| Bước | Luồng cũ (không đổi) | Study Run |
|---|---|---|
| Vào | `/` → `POST /api/session` (cấu hình toàn cục) | `/i/[token]` → `POST /api/invitations/redeem`; `/api/session` từ chối khi có run `INVITE_ONLY` đang mở |
| Tạo session | `SessionService.create` | `RunSessionService.createFromInvitation`: ghim run, invitation, variant, content/question snapshot của run |
| INFORMATION, CONSENT, DEMOGRAPHICS | giữ nguyên | giữ nguyên; `groupCode` của run session để `null` (xem §11-a) |
| Đọc | `READING_1` rồi `READING_2` | một lượt, dùng stage `READING_1`/`REVIEW_1`/`TEST_1` làm "READING/REVIEW/TEST"; variant lấy từ `session.presentationVariant` |
| Nộp bài | `TEST_1` → BREAK → ... → `TEST_2` → COMPLETED | `TEST_1` → COMPLETED qua CAS riêng `completeRunSessionIfReady` |
| Validity | `checkValidity` (hai lượt, nghỉ, AB/BA) | `checkRunSessionValidity` (một lượt, không nghỉ, đúng variant, đúng profile) |

Phát hiện khi audit làm cơ sở cho thiết kế: `completeSessionIfReady` chỉ hoàn tất từ `TEST_2`; `checkValidity` đòi hai lượt, nghỉ và AB/BA
nên phiên một lượt sẽ không bao giờ đủ điều kiện nếu không có nhánh riêng. Cả hai hàm cũ được giữ nguyên, thêm hàm mới song song.
Ngoài ra `presentationForRound(group, round)` không đụng tới; run session đọc `presentationVariant` trực tiếp.

## 4. Mô hình dữ liệu (chỉ thêm)

**`study_runs`**: `_id`, `code` (unique), `name`, `phase` (PILOT/MAIN), `status` (`DRAFT`|`OPEN`|`PAUSED`|`CLOSED`),
`targetSampleSize` (số chẵn ≥ 2), `quotaPerArm` (= target/2, Admin đã xác nhận), snapshot bất biến:
`packageId/code/revision`, `contentRevisionId`, `questionSetId`, `presentation: { V1: {version}, V2: {profileId, version} }`,
`arms: { V1: { validIncluded, supplementalValid }, V2: { ... } }` (bộ đếm nguyên tử), `locked` (true khi đã phát hành invitation đầu tiên),
`version` (khóa lạc quan), `createdBy/At`, `statusChangedBy/At`, `closedAt`. Không có trường nào tự đổi trạng thái.

**`invitations`**: `_id`, `studyRunId`, `variant` (V1/V2), `tokenHash` (unique), `status` (`ISSUED`|`REDEEMED`|`REVOKED`),
`sessionId` (được cấp trước khi tạo session để thử lại an toàn), `redeemedAt`, `revokedAt/By/reason`, `replacesInvitationId`,
`label` (ghi chú ngắn, cấm PII), `createdBy/At`. Không lưu token thô; không có `expiresAt` (hết hạn là thu hồi tự động).

**`presentation_profiles`**: `_id`, `contentRevisionId`, `contentHash`, `variant: 'V2'`, `version`, `status` (`DRAFT`|`CONFIRMED`|`LOCKED`),
`segmentation` (`{ algorithm: 'SENTENCES_PER_BLOCK', sentencesPerBlock }`), `style` (cỡ chữ, line-height, độ rộng, màu, giãn khối, căn lề),
`emphasis: [{ start, end, text }]` (offset ký tự trong `rawContent`, `text` lưu để đối chiếu), `confirmedBy/At`, `lockedAt`.
Khi `LOCKED` mọi sửa đổi trả 409; muốn đổi phải tạo version mới và Study Run mới.

**Trường mới trên `sessions`** (tùy chọn; vắng mặt = phiên cũ): `studyRunId`, `invitationId`, `presentationVariant`, `presentationVersion`,
`presentationProfileId`, `quotaStatus` (`INCLUDED`|`SUPPLEMENTAL`|`NOT_COUNTED`|null), `quotaRecordedAt`, `quotaRecordedBy`.
`reading_sessions`/`test_attempts` giữ `presentation` và thêm `presentationVersion` (tùy chọn).

**Index mới**: `invitations.tokenHash` (unique); `invitations {studyRunId, variant, status}`; `invitations.sessionId` (unique, sparse);
`study_runs.code` (unique); `presentation_profiles {contentRevisionId, version}` (unique);
`sessions {studyRunId, presentationVariant, status, validityFlag}`; `sessions.invitationId` (unique, sparse).
Kèm theo (nhóm D, cần cho tính đúng của quota): unique `{phase, revision}` cho content/question revision.

## 5. Thuật toán then chốt

**Redeem** (`POST /api/invitations/redeem`, Origin + rate-limit; token 256 bit):
1. Băm token, tìm invitation. Không có hoặc `REVOKED` → trang lỗi chung (không lộ lý do).
2. `ISSUED` và run `OPEN`: CAS `ISSUED → REDEEMED` kèm `sessionId` cấp sẵn, rồi tạo session đúng `id` đó (transaction nếu có; nếu không, thử lại idempotent vì `id` cố định và unique).
3. Run `PAUSED`/`CLOSED` và invitation `ISSUED`: chặn, không tạo session.
4. `REDEEMED`: nếu session `ACTIVE` thì cấp lại cookie phiên cũ và resume (kể cả khi run đã đóng/tạm dừng); nếu đã `COMPLETED/WITHDRAWN/DECLINED/INCOMPLETE` thì hiện trang kết thúc, không tạo phiên mới.
5. Trình duyệt đang có cookie của session ACTIVE khác → 409, không ghi đè (tránh một người dùng hai link).

**Quota** (chạy trong cùng transaction với `reviewSessionValidity`, chỉ khi Admin đặt VALID trên session `COMPLETED` thuộc run):
CAS `quotaStatus: null → INCLUDED` kèm `findOneAndUpdate` điều kiện `arms.<V>.validIncluded < quotaPerArm` và `$inc`. Nhánh đã đầy thì ghi `SUPPLEMENTAL`
(dữ liệu giữ nguyên, tăng `supplementalValid`). Gọi lặp lại không tính trùng (CAS theo `quotaStatus`).
Đổi VALID → INVALID: nếu `INCLUDED` thì trả chỗ (`-1`) và cảnh báo "có chỗ trống"; không tự đưa session bổ sung vào. Admin có hành động rõ ràng "đưa vào quota".
Đạt quota chỉ sinh **cảnh báo**; không đổi `status` của run.

**Profile lock**: tạo invitation đầu tiên chạy CAS `locked: false → true` trên run và `CONFIRMED → LOCKED` trên profile trong cùng transaction.
Run chỉ chuyển `OPEN` được khi profile là `CONFIRMED` hoặc `LOCKED`.

**Toàn vẹn nội dung V2**: văn bản hiển thị (`textContent`) của V2 phải bằng đúng `rawContent`; chữ đậm chỉ là `<strong>` bao quanh offset có sẵn;
không thêm tiêu đề, nhãn, từ nào (kể cả bằng CSS `content:`).

## 6. API (chuẩn dưới `/api/admin`, chỉ RESEARCHER ghi; SUPERVISOR chỉ đọc)

`GET/POST study-runs`; `PATCH study-runs/[id]` (sample size chỉ khi chưa `locked`, kèm cờ `quotaConfirmed`); `POST study-runs/[id]/status` (open|pause|resume|close|reopen);
`GET/POST study-runs/[id]/invitations` (POST: variant + số lượng; trả link một lần; GET: không kèm token); `POST invitations/[id]/revoke`;
`GET study-runs/[id]/recruitment` (số mời, đã bắt đầu, hoàn thành, valid, invalid, incomplete tách riêng + cảnh báo);
`GET/PUT presentation-profiles` + `POST .../confirm`; `POST sessions/[id]/quota` (include);
export thêm bộ lọc `variant`, `studyRun` và cột `study_run_id, invitation_id, presentation_variant, presentation_version, quota_status` (INCLUDED/SUPPLEMENTAL).
Participant: `GET /i/[token]` (trang), `POST /api/invitations/redeem`. Trang `/i/*` dùng `Referrer-Policy: no-referrer` và không ghi log đường dẫn.

## 7. UI Admin

`/admin/recruitment` (danh sách và tạo run, bước xác nhận quota chia đều), `/admin/recruitment/[id]` (thẻ quota từng nhánh, bảng số lượng, cảnh báo,
quản lý invitation, mở/tạm dừng/đóng, preview V1/V2), trình chọn chữ đậm có Preview, lọc theo variant ở danh sách phiên và trang export.

## 8. Di trú và rollback

Chỉ thêm collection, index và trường tùy chọn; không backfill, không đổi dữ liệu cũ. Phiên không có `studyRunId` là phiên cũ.
Rollback: bỏ ba collection mới và bỏ qua trường mới (mã cũ không đọc chúng). Dữ liệu run đã thu vẫn nằm trong `sessions`/`reading_sessions`/`test_attempts`
nên xuất được bằng truy vấn trực tiếp.

## 9. Lộ trình patch

| Patch | Phạm vi | Ảnh hưởng participant flow |
|---|---|---|
| P0 | Ổn định integration test, DB riêng theo worker (**xong**) | không |
| P1 | Kiểu dữ liệu, `study_runs`, service tạo/xác nhận quota, trạng thái run, bộ đếm quota nguyên tử, index | không |
| P2 | `invitations`, tạo link, redeem, tạo session ghim run/variant, resume, chặn `/api/session` khi có run `INVITE_ONLY` | có: điểm vào mới `/i/[token]` |
| P3 | `presentation_profiles`, renderer V2 mới, bold thủ công, test toàn vẹn nội dung | có: chỉ hiển thị cho run session |
| P4 | Luồng một lượt cho run session, `checkRunSessionValidity`, nối validity với quota | có: run session bỏ BREAK/vòng 2 |
| P5 | API admin và UI quản trị, cảnh báo, preview | không |
| P6 | Export theo variant/run, phân biệt INCLUDED/SUPPLEMENTAL | không |
| P7 | E2E, tài liệu, báo cáo rủi ro | không |

## 10. Tiêu chí nghiệm thu

Mỗi mục có test tự động ở patch ghi trong ngoặc, trừ khi ghi "thủ công".

- AC-01 Sample size lẻ, 0 hoặc âm bị từ chối; sample size chẵn hiển thị quota V1/V2 = N/2 và chỉ lưu sau khi Admin xác nhận. (P1)
- AC-02 Chỉ RESEARCHER ghi được; SUPERVISOR nhận 403; đổi trạng thái run khi nhập sai phiên bản (`version`) trả 409. (P1, P5)
- AC-03 Không có thao tác nào của hệ thống tự đổi `status` run, quota, invitation hay variant: kiểm bằng test quét ghi/DB sau chuỗi sự kiện (đạt quota, đóng nhánh, hoàn tất session). (P1, P4)
- AC-04 Link mời chỉ hiện một lần; DB chỉ chứa hash; token sai, đã thu hồi hoặc không tồn tại cho cùng một phản hồi chung. (P2)
- AC-05 Một invitation chỉ tạo được một session, kể cả khi 20 yêu cầu redeem đồng thời; thử lại sau lỗi giữa chừng không tạo hai session. (P2)
- AC-06 Mở lại link đã dùng khi session ACTIVE thì resume đúng bước; khi session đã kết thúc thì không tạo phiên mới. (P2)
- AC-07 Variant của session luôn bằng variant của invitation; không có API nào đổi variant sau khi tạo. (P2)
- AC-08 Run `PAUSED/CLOSED` chặn invitation chưa dùng nhưng session đã bắt đầu vẫn hoàn thành được. (P2, P4)
- AC-09 Run session không có BREAK, READING_2, REVIEW_2, TEST_2; hoàn tất từ TEST_1; luồng cũ không đổi (toàn bộ test hiện có vẫn PASS). (P4)
- AC-10 `groupCode` A/B của run session là `null` và không bao giờ biểu diễn V1/V2. (P2, P4)
- AC-11 V1 hiển thị y hệt hiện tại; V2 và V1 dùng cùng content revision và question set; thứ tự câu, đáp án, chấm điểm, timer không đổi. (P3, P4)
- AC-12 `textContent` của V2 bằng đúng `rawContent`; không thêm/xóa/đổi ký tự; không thêm tiêu đề hay nhãn (kể cả CSS `content:`). (P3)
- AC-13 Chữ đậm chỉ có khi Admin chọn thủ công, offset hợp lệ, không chồng lấn, nằm trong nội dung; không chọn thì V2 không có chữ đậm. (P3)
- AC-14 Profile phải qua Preview và xác nhận; sau khi tạo invitation đầu tiên thì khóa, mọi sửa đổi trả 409. (P3)
- AC-15 Chỉ session COMPLETED + VALID được tính; INVALID, INCOMPLETE, WITHDRAWN, REVIEW_REQUIRED không bao giờ tính. (P4)
- AC-16 Đánh dấu VALID lặp lại hoặc song song không tính trùng; bộ đếm nhánh không vượt `quotaPerArm`. (P4)
- AC-17 Session VALID vượt quota được giữ nguyên và gắn `SUPPLEMENTAL`; không có dữ liệu nào bị xóa hay loại. (P4, P6)
- AC-18 Đạt quota chỉ hiện cảnh báo; run vẫn `OPEN` cho tới khi Admin quyết định. (P4, P5)
- AC-19 **Chấp nhận chính:** với target 30, hỗ trợ 15 session COMPLETED+VALID của V1 và 15 của V2; cảnh báo xuất hiện khi mỗi nhánh đủ và khi cả hai đủ; Admin đóng tuyển thì invitation chưa dùng bị chặn; mọi dữ liệu vẫn xuất được. (P4, P5, P6)
- AC-20 Admin tạo được invitation thay thế (có `replacesInvitationId`) và tạo thêm sau khi đủ quota nếu muốn. (P2, P5)
- AC-21 Dashboard hiển thị riêng: đã mời, đã bắt đầu, hoàn thành, valid, invalid, incomplete cho từng variant. (P5)
- AC-22 Export V1, V2 và gộp có `presentation_variant`, id participant/session, thời gian, validity, package và revision; phân biệt INCLUDED/SUPPLEMENTAL; chống công thức CSV vẫn hoạt động. (P6)
- AC-23 Không đổi: Consent, Information, stimuli, câu hỏi/đáp án, chấm điểm, timer, BREAK và state machine cũ, assignment cũ, cookie/resume cũ (ngoài tích hợp invitation). Kiểm bằng diff phạm vi file và test hồi quy. (mọi patch)
- AC-24 Integration test chạy song song nhiều worker và nhiều tiến trình đồng thời đều PASS (stress). (P0 và mọi patch)
- AC-25 Không có PII trong invitation, log hay export; token không xuất hiện trong log. (P2, P6, thủ công)

## 11. Quyết định tự đặt (đảo ngược được) và rủi ro mở

a. **Run session có `groupCode = null`** để thống kê A/B của luồng cũ không bị trộn và A/B không bao giờ bị hiểu là V1/V2.
   Hệ quả: nhánh `GROUP_NOT_ASSIGNED` ở trang đọc/nộp bài được rẽ theo `studyRunId`; logic assignment cũ không đổi.
b. **`CLOSED` có thể mở lại** bằng hành động Admin rõ ràng và có audit (tránh khóa vĩnh viễn do đóng nhầm).
c. **Không có `expiresAt`** cho invitation (hết hạn tự động là thu hồi tự động, trái nguyên tắc §2).
d. **Mở lại link ở thiết bị khác**: cấp lại cookie cho session ACTIVE vì link là thông tin xác thực duy nhất.
   Rủi ro: ai giữ link đều tiếp quản được phiên đang dở; giảm bằng rate-limit và chỉ khi session ACTIVE.
e. **Nội dung Information/Consent do Admin cấu hình có thể đang mô tả "hai lượt đọc và nghỉ giữa giờ"**, không đúng với Study Run một lượt.
   Mã không được sửa các nội dung này; cần nhà nghiên cứu/hội đồng đạo đức cập nhật trước khi mở run. Hệ thống chỉ hiện cảnh báo và yêu cầu Admin xác nhận đã rà soát (không chặn tự động).
f. **Trang chủ `/` và `/api/session` cũ nói "hai lượt"**: giữ nguyên cho luồng cũ; Study Run dùng trang `/i/[token]` có nội dung riêng cho điểm vào.
g. **Hạn ngạch phụ thuộc Admin duyệt validity**: mời nhiều hơn số còn thiếu có thể tạo dữ liệu bổ sung; hệ thống chỉ cảnh báo.
h. **Mất link hoặc xóa cookie**: invitation đã dùng nhưng session ACTIVE vẫn resume bằng link; nếu mất link thì Admin tạo invitation thay thế, session cũ giữ ở trạng thái incomplete (không tính quota).
i. **V2 mới khác V2 cũ** (profile tách riêng, `presentationVersion` riêng): dữ liệu PILOT/MAIN cũ không so sánh trực tiếp với V2 của Study Run.
j. **Transaction cần replica set** (Atlas đáp ứng). Trên máy chủ không có transaction, đường dự phòng là CAS + khóa idempotent đã nêu ở §5.
