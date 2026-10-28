import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { checkValidity } from '@/lib/services/validity.service';
import { ValidityForm } from '@/components/admin/ValidityForm';
import type { QuestionItem } from '@/types/research';

export const metadata: Metadata = { title: 'Chi tiết phiên', robots: { index: false, follow: false } };
const demographyLabels: Record<string, string> = {
  ageRange: 'Độ tuổi', gender: 'Giới tính', fieldOfStudy: 'Ngành học', yearOfStudy: 'Năm học',
  aiUsageFrequency: 'Tần suất sử dụng AI', onlineReadingFrequency: 'Tần suất đọc trực tuyến'
};
function show(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value); }
const time = (date: Date | undefined | null) => date ? new Date(date).toLocaleString('vi-VN') : '—';
function answerLabel(question: QuestionItem | undefined, selected: string | null) {
  if (!selected) return 'Không chọn';
  const item = question?.options.find(option => option.id === selected);
  return item ? `${item.id} — ${item.text}` : `${selected} — không có trong revision`;
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdminSession();
  const repo = new ResearchRepository();
  const bundle = await repo.getSessionBundle(id);
  const session = bundle.session;
  if (!session) notFound();
  const questionSet = await repo.getQuestionSetById(session.questionSetId);
  const validation = checkValidity({ ...bundle, session, questions: questionSet });
  const v1 = bundle.tests.find(t => t.presentation === 'V1');
  const v2 = bundle.tests.find(t => t.presentation === 'V2');
  const demography = bundle.demographics;
  return <div className="stack">
    <header className="stack-sm"><h1>Chi tiết phiên tham gia</h1><p className="help">Mã phiên ẩn danh: <code>{session.id}</code></p></header>
    <section className="card stack"><h2>Tổng quan và revision đã khóa</h2>
      <div className="table-wrap"><table><tbody>
        {([['Bộ nội dung', `${show(session.assignedPackageCode)} · revision ${show(session.assignedPackageRevision)} · ${show(session.assignedPackageTopic)}`],
          ['Package ID',session.assignedPackageId?.toString()],['Content Revision ID', session.contentRevisionId?.toString()],
          ['Question Set Revision ID',session.questionSetId?.toString()],['Giai đoạn',session.phase],['Nhóm AB/BA',session.groupCode],
          ['Tình trạng',session.status],['Bước hiện tại',session.currentStage],['Validity',session.validityFlag],
          ['Lý do',session.validityReason],['Người đánh giá',session.validityReviewedBy],['Thời điểm đánh giá',time(session.validityReviewedAt)],
          ['Ngày tạo',time(session.createdAt)],['Ngày hoàn thành',time(session.completedAt)]] as Array<[string,unknown]>).map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{show(value)}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="card stack"><h2>Thông tin chung (đã ẩn định danh)</h2>{demography ? <div className="table-wrap"><table><tbody>{Object.entries(demographyLabels).map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{show(demography[key as keyof typeof demography])}</td></tr>)}</tbody></table></div>:<p className="help">Chưa có dữ liệu nhân khẩu học.</p>}</section>
    <section className="card stack"><h2>Kết quả theo lượt</h2>
      <p>V1: <strong>{show(v1?.score)} / 5</strong> · V2: <strong>{show(v2?.score)} / 5</strong> · Chênh lệch V2 − V1: <strong>{v1 && v2 ? v2.score-v1.score : '—'}</strong></p>
      <div className="table-wrap"><table><thead><tr><th>Lượt</th><th>Kiểu</th><th>Thời gian đọc (giây)</th><th>Cuộn</th><th>Độ sâu tối đa</th><th>Điểm</th></tr></thead><tbody>{([1,2] as const).map(round => {const r=bundle.readings.find(x=>x.roundNo===round);const t=bundle.tests.find(x=>x.roundNo===round);return <tr key={round}><td>{round}</td><td>{r?.presentation??t?.presentation??'—'}</td><td>{show(r?.readingSeconds)}</td><td>{show(r?.scrollCount)}</td><td>{r ? `${r.maxScrollDepthPercent.toFixed(1)}%` : '—'}</td><td>{show(t?.score)} / 5</td></tr>;})}</tbody></table></div>
      {bundle.tests.map(test => <div className="stack-sm" key={test.roundNo}><h3>Đáp án lượt {test.roundNo} — {test.presentation}</h3><div className="table-wrap"><table><thead><tr><th>Câu hỏi</th><th>Đã chọn</th><th>Kết quả</th></tr></thead><tbody>{test.answers.map(answer=>{const question=questionSet?.questions.find(q=>q.id===answer.questionId);return <tr key={answer.questionId}><td>{question?.prompt??answer.questionId}</td><td>{answerLabel(question,answer.selectedOptionId)}</td><td>{answer.isCorrect===true?'Đúng':answer.isCorrect===false?'Sai':'Không trả lời'}</td></tr>;})}</tbody></table></div></div>)}
    </section>
    <section className="card stack"><h2>Checklist tính hợp lệ</h2><p className="help">Tất cả điều kiện phải PASS trước khi xét VALID. Quyết định cuối cùng vẫn do nhà nghiên cứu thực hiện.</p>
      <ul className="readiness-list">{validation.checks.map(c=><li key={c.code}><strong>{c.status}</strong> — {c.label}{c.status!=='PASS' ? `: ${c.reason}` : ''}</li>)}</ul>
      <ValidityForm id={id} flag={session.validityFlag} reason={session.validityReason} disabled={admin?.role!=='RESEARCHER'||session.status!=='COMPLETED'} />
      <h3>Lịch sử xét duyệt</h3>{bundle.validityHistory.length===0?<p>Chưa có lần xét duyệt nào được ghi log.</p>:<ol>{bundle.validityHistory.map((entry,i)=><li key={entry._id?.toString()??i}>{time(entry.createdAt)} — {entry.username} — {show(entry.metadata.previousFlag)} → {show(entry.metadata.validityFlag)} · {show(entry.metadata.reason)}</li>)}</ol>}
    </section>
    <section className="card stack"><h2>Dòng thời gian sự kiện</h2><ol>{bundle.events.map((event,i)=><li key={event._id?.toString()??i}><time dateTime={new Date(event.createdAt).toISOString()}>{time(event.createdAt)}</time> · {event.type} · {event.roundNo ? `Lượt ${event.roundNo}` : 'Phiên'} · {show(event.stage)}</li>)}</ol></section>
    <details className="card"><summary>Technical Details — JSON dữ liệu thô (chỉ Admin)</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({readings:bundle.readings,tests:bundle.tests,events:bundle.events,breakDoc:bundle.breakDoc},null,2)}</pre></details>
  </div>;
}
