'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { QuestionItem, StudyPhase } from '@/types/research';
import { ExperimentalText } from '@/components/participant/ExperimentalText';
import { UiIcon } from './UiIcon';
import { useToast } from './ToastProvider';

export interface PackageView {
  _id: string;
  code: string;
  title: string;
  topic: string;
  description: string;
  phase: StudyPhase;
  revision: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  enabled: boolean;
  contentRevision: number | null;
  questionRevision: number | null;
  rawContent: string;
  aiSource?: string | null;
  questions: QuestionItem[];
  createdAt: string;
  publishedAt: string | null;
  validation?: {
    saveDraft: boolean;
    publish: boolean;
    startStudy: boolean;
    checks: Array<{ code: string; label: string; status: string }>;
  };
}

type Action = 'PUBLISH' | 'ARCHIVE';
type PendingAction = { action: Action; item: PackageView };
type PreviewMode = 'both' | 'V1' | 'V2';
const wizardLabels = ['Thông tin cơ bản', 'Bài đọc AI', 'Xem trước V1/V2', 'Bộ câu hỏi', 'Kiểm tra & lưu'];
const categories = ['Hiểu khái niệm', 'Hiểu thuật ngữ', 'Hiểu mối quan hệ', 'Hiểu điều kiện', 'Suy luận'];
const emptyQuestions = (): QuestionItem[] => Array.from({ length: 5 }, (_, index) => ({
  id: `q${index + 1}`,
  category: (['CONCEPTUAL', 'TERMINOLOGY', 'RELATIONSHIP', 'CONDITIONAL', 'INFERENTIAL'] as const)[index],
  prompt: '',
  options: Array.from({ length: 4 }, (_, option) => ({ id: `q${index + 1}o${option + 1}`, text: '', isCorrect: option === 0 })),
}));

function ConfirmDialog({ pending, busy, cancel, confirm }: {
  pending: PendingAction;
  busy: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  const publishing = pending.action === 'PUBLISH';
  return <dialog ref={ref} className="admin-confirm" onCancel={event => { if (busy) event.preventDefault(); else cancel(); }}>
    <div className="admin-confirm-icon"><UiIcon name={publishing ? 'shield' : 'archive'} width={23} height={23} /></div>
    <h2>{publishing ? 'Xác nhận xuất bản?' : 'Lưu trữ bộ nội dung?'}</h2>
    <p><strong>{pending.item.title}</strong> · {pending.item.code}</p>
    <p className="help">{publishing
      ? 'Hai revision bài đọc và câu hỏi sẽ được khóa để bảo toàn dữ liệu nghiên cứu. Bạn chỉ có thể chỉnh sửa bằng cách tạo phiên bản mới.'
      : 'Bộ nội dung sẽ ngừng xuất hiện trong danh sách có thể phân công. Những phiên đã bắt đầu vẫn giữ nguyên dữ liệu lịch sử.'}</p>
    <div className="admin-confirm-actions">
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={cancel}>Hủy</button>
      <button className={`btn ${publishing ? 'btn-primary' : 'btn-danger'}`} type="button" disabled={busy} onClick={confirm}>
        {busy ? 'Đang xử lý…' : publishing ? 'Xác nhận xuất bản' : 'Lưu trữ'}
      </button>
    </div>
  </dialog>;
}

function Preview({ rawContent, mode, onModeChange }: {
  rawContent: string;
  mode: PreviewMode;
  onModeChange?: (mode: PreviewMode) => void;
}) {
  return <div className="package-preview">
    <div className="package-preview-toolbar">
      <div>
        <span className="package-eyebrow"><UiIcon name="eye" /> KHUNG XEM TRƯỚC</span>
        <h3>Hai cách trình bày, một nội dung</h3>
        <p className="help">So sánh trực quan, không làm thay đổi từ ngữ hoặc thứ tự bài đọc.</p>
      </div>
      {onModeChange && <div className="package-segment" role="group" aria-label="Kiểu xem trước">
        {([['both', 'Song song'], ['V1', 'Chỉ V1'], ['V2', 'Chỉ V2']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? 'is-selected' : ''} onClick={() => onModeChange(value)}>{label}</button>)}
      </div>}
    </div>
    <div className={`preview-grid preview-grid--${mode}`}>
      {mode !== 'V2' && <section className="package-preview-panel">
        <div className="package-preview-heading"><span className="package-version package-version--v1">V1</span><div><strong>Bản chuẩn</strong><small>Trình bày nguyên bản</small></div></div>
        <div className="package-reading"><ExperimentalText rawContent={rawContent} presentation="V1" /></div>
      </section>}
      {mode !== 'V1' && <section className="package-preview-panel package-preview-panel--v2">
        <div className="package-preview-heading"><span className="package-version package-version--v2">V2</span><div><strong>Dễ tiếp cận</strong><small>Khoảng cách và nhóm đoạn được tối ưu</small></div></div>
        <div className="package-reading"><ExperimentalText rawContent={rawContent} presentation="V2" /></div>
      </section>}
    </div>
    <div className="package-integrity-note"><UiIcon name="shield" /> V1 và V2 chia sẻ cùng văn bản nguồn. Backend kiểm tra toàn vẹn trước khi xuất bản.</div>
  </div>;
}

export function PackageManager({ items, canEdit }: { items: PackageView[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [filter, setFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | StudyPhase>('ALL');
  const [phase, setPhase] = useState<StudyPhase>('PILOT');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [rawContent, setRaw] = useState('');
  const [aiSource, setAi] = useState('');
  const [questions, setQuestions] = useState<QuestionItem[]>(emptyQuestions);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('both');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const wordCount = useMemo(() => rawContent.trim() ? rawContent.trim().split(/\s+/u).length : 0, [rawContent]);
  const filtered = useMemo(() => items.filter(item => {
    const matchesText = `${item.title} ${item.code} ${item.topic}`.toLocaleLowerCase('vi').includes(filter.trim().toLocaleLowerCase('vi'));
    return matchesText && (phaseFilter === 'ALL' || item.phase === phaseFilter);
  }), [items, filter, phaseFilter]);
  const drafts = items.filter(item => item.status === 'DRAFT').length;
  const published = items.filter(item => item.status === 'PUBLISHED').length;
  const baseComplete = code.trim().length > 1 && !!title.trim() && !!topic.trim();
  const questionsValid = questions.length === 5 && questions.every(question => question.prompt.trim() && question.options.length === 4 && question.options.every(option => option.text.trim()) && question.options.filter(option => option.isCorrect).length === 1);
  const ready = baseComplete && !!rawContent.trim() && questionsValid;
  const checkItems = [
    { label: 'Thông tin bộ nội dung', complete: baseComplete, detail: 'Mã, tên và chủ đề' },
    { label: 'Bài đọc AI', complete: !!rawContent.trim(), detail: `${wordCount} từ trong nội dung nguồn` },
    { label: 'Bộ câu hỏi', complete: questionsValid, detail: '5 câu, mỗi câu 4 lựa chọn và 1 đáp án đúng' },
  ];

  const setPrompt = (index: number, text: string) => setQuestions(current => current.map((item, i) => i === index ? { ...item, prompt: text } : item));
  const setOption = (index: number, option: number, text: string) => setQuestions(current => current.map((item, i) => i === index ? { ...item, options: item.options.map((o, j) => j === option ? { ...o, text } : o) } : item));
  const setCorrect = (index: number, option: number) => setQuestions(current => current.map((item, i) => i === index ? { ...item, options: item.options.map((o, j) => ({ ...o, isCorrect: j === option })) } : item));

  async function call(data: Record<string, unknown>, successTitle: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/packages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : body.issues?.[0]?.message ?? 'Thao tác thất bại.');
      toast({ kind: 'success', title: successTitle, description: 'Dữ liệu đã được cập nhật trên hệ thống.' });
      setShowEditor(false);
      router.refresh();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Không thể lưu dữ liệu.';
      setMessage(errorMessage);
      toast({ kind: 'error', title: 'Không thể thực hiện', description: errorMessage });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEditor(item?: PackageView) {
    setCode(item?.code ?? '');
    setTitle(item?.title ?? '');
    setTopic(item?.topic ?? '');
    setDescription(item?.description ?? '');
    setPhase(item?.phase ?? 'PILOT');
    setRaw(item?.rawContent ?? '');
    setAi(item?.aiSource ?? '');
    setQuestions(item ? item.questions : emptyQuestions());
    setEditingId(item?._id ?? null);
    setPreviewMode('both');
    setShowEditor(true);
    setStep(0);
    setMessage('');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function chooseStep(next: number) {
    if (next > step && ((step === 0 && !baseComplete) || (step === 1 && !rawContent.trim()))) {
      const description = step === 0 ? 'Hãy hoàn thành mã, tên và chủ đề trước khi tiếp tục.' : 'Hãy dán nội dung bài đọc trước khi tiếp tục.';
      setMessage(description);
      toast({ kind: 'info', title: 'Cần thêm thông tin', description });
      return;
    }
    setMessage('');
    setStep(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
      const description = 'Cần đủ bài đọc và 5 câu hỏi hợp lệ, mỗi câu có 4 lựa chọn và 1 đáp án đúng.';
      setMessage(description);
      toast({ kind: 'error', title: 'Bản nháp chưa hoàn chỉnh', description });
      return;
    }
    await call({ action: editingId ? 'UPDATE' : 'CREATE', id: editingId ?? undefined, code, title, topic, description, phase, rawContent, questions, aiSource: aiSource || null }, editingId ? 'Đã lưu thay đổi bản nháp' : 'Đã tạo bộ nội dung nháp');
  }

  async function confirmAction() {
    if (!pending) return;
    const { item, action } = pending;
    const ok = await call({ action, id: item._id }, action === 'PUBLISH' ? 'Đã xuất bản và khóa revision' : 'Đã lưu trữ bộ nội dung');
    if (ok) setPending(null);
  }

  return <div className="package-manager stack">
    <section className="package-hero" aria-label="Tổng quan bộ nội dung">
      <div className="package-hero-main">
        <span className="package-eyebrow"><UiIcon name="sparkles" /> KHÔNG GIAN NỘI DUNG NGHIÊN CỨU</span>
        <h2>Tạo nội dung rõ ràng.<br /><span>Quản lý dễ dàng hơn.</span></h2>
        <p>Tạo bài đọc V1/V2, kiểm tra câu hỏi và quản lý các phiên bản đã xuất bản trong một quy trình nhất quán.</p>
        {canEdit && <button type="button" className="btn btn-primary package-hero-cta" onClick={() => showEditor ? setShowEditor(false) : startEditor()}>
          <UiIcon name={showEditor ? 'close' : 'plus'} /> {showEditor ? 'Đóng trình biên tập' : 'Tạo bộ nội dung mới'}
        </button>}
      </div>
      <div className="package-stats" aria-label="Thống kê bộ nội dung">
        <div className="package-stat"><span className="package-stat-icon package-stat-icon--blue"><UiIcon name="layers" /></span><strong>{items.length}</strong><small>Tổng bộ nội dung</small></div>
        <div className="package-stat"><span className="package-stat-icon package-stat-icon--amber"><UiIcon name="edit" /></span><strong>{drafts}</strong><small>Bản nháp</small></div>
        <div className="package-stat"><span className="package-stat-icon package-stat-icon--mint"><UiIcon name="checkCircle" /></span><strong>{published}</strong><small>Đã xuất bản</small></div>
      </div>
    </section>

    {showEditor && canEdit && <div ref={editorRef} className="package-editor-anchor">
      <form className="package-wizard stack" onSubmit={save} noValidate={false}>
        <div className="package-wizard-head">
          <div>
            <span className="package-eyebrow"><UiIcon name="edit" /> TRÌNH BIÊN TẬP NỘI DUNG</span>
            <h2>{editingId ? 'Chỉnh sửa bản nháp' : 'Tạo bộ nội dung mới'}</h2>
            <p className="help">Dán văn bản tạo từ AI bản web; hệ thống không gọi AI API hoặc tự sửa nội dung nghiên cứu.</p>
          </div>
          <div className="package-step-count"><strong>{String(step + 1).padStart(2, '0')}</strong><span> / 05</span><small>Bước hiện tại</small></div>
        </div>
        <div className="package-progress" role="progressbar" aria-label="Tiến độ quy trình" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={5}><span style={{ width: `${(step + 1) * 20}%` }} /></div>
        <ol className="wizard-steps" aria-label="Các bước tạo bộ nội dung">{wizardLabels.map((label, index) => <li key={label}>
          <button type="button" className={step === index ? 'wizard-active' : index < step ? 'wizard-done' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => chooseStep(index)}>
            <span className="wizard-number">{index < step ? <UiIcon name="check" width={15} height={15} /> : String(index + 1).padStart(2, '0')}</span><span className="wizard-label">{label}</span>
          </button>
        </li>)}</ol>

        <div className="package-wizard-body">
          {step === 0 && <div className="stack">
            <div className="package-section-heading"><span className="package-section-mark"><UiIcon name="layers" /></span><div><h3>Thông tin bộ nội dung</h3><p className="help">Đặt tên và phân loại bộ nội dung để dễ tìm kiếm, quản lý.</p></div></div>
            <div className="package-form-grid">
              <label className="field"><span>Mã bộ nội dung <em>*</em></span><input value={code} onChange={e => setCode(e.target.value)} required maxLength={40} pattern="[a-zA-Z0-9_-]{2,40}" placeholder="Ví dụ: AI_LESSON_01" /></label>
              <label className="field"><span>Tên bộ nội dung <em>*</em></span><input value={title} onChange={e => setTitle(e.target.value)} required maxLength={150} placeholder="Ví dụ: Introduction to Machine Learning" /></label>
              <label className="field"><span>Chủ đề <em>*</em></span><input value={topic} onChange={e => setTopic(e.target.value)} required maxLength={160} placeholder="Ví dụ: Machine Learning" /></label>
              <label className="field"><span>Giai đoạn</span><select value={phase} onChange={e => setPhase(e.target.value as StudyPhase)}><option value="PILOT">PILOT — Thử nghiệm</option><option value="MAIN">MAIN — Chính thức</option></select></label>
              <label className="field"><span>Nguồn AI <span className="package-optional">(tùy chọn)</span></span><input value={aiSource} onChange={e => setAi(e.target.value)} maxLength={120} placeholder="Ví dụ: ChatGPT bản web" /></label>
              <label className="field package-full-width"><span>Mô tả <span className="package-optional">(tùy chọn)</span></span><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="Mục đích và phạm vi bài đọc…" /></label>
            </div>
          </div>}

          {step === 1 && <div className="stack">
            <div className="package-section-heading"><span className="package-section-mark"><UiIcon name="book" /></span><div><h3>Nội dung bài đọc</h3><p className="help">Dán nguyên văn nội dung nguồn — đây là văn bản dùng chung cho V1 và V2.</p></div></div>
            <label className="field"><span>Nội dung nguồn <em>*</em></span><textarea className="package-source-area" rows={16} value={rawContent} onChange={e => setRaw(e.target.value)} required maxLength={100000} placeholder="Dán bài đọc nguyên văn tại đây…" /></label>
            <div className="package-editor-footnote"><span className="package-chip"><UiIcon name="list" /> {wordCount} từ</span><span className="help">V2 chỉ thay đổi cách trình bày; không thêm, xóa hoặc thay từ.</span></div>
          </div>}

          {step === 2 && <Preview rawContent={rawContent} mode={previewMode} onModeChange={setPreviewMode} />}

          {step === 3 && <div className="stack">
            <div className="package-section-heading"><span className="package-section-mark"><UiIcon name="list" /></span><div><h3>Bộ câu hỏi kiểm tra</h3><p className="help">5 câu hỏi, mỗi câu 4 phương án. Chọn đúng một đáp án cho mỗi câu.</p></div></div>
            {questions.map((question, index) => <fieldset key={question.id} className="package-question-card">
              <legend><span className="package-chip">Câu {index + 1} / 5</span> {categories[index]}</legend>
              <label className="field"><span>Nội dung câu hỏi <em>*</em></span><textarea value={question.prompt} onChange={e => setPrompt(index, e.target.value)} rows={2} required placeholder={`Nhập nội dung câu hỏi ${index + 1}…`} /></label>
              <div className="package-options">{question.options.map((option, optionIndex) => <div className={`package-option ${option.isCorrect ? 'package-option--correct' : ''}`} key={option.id}>
                <span className="package-option-index">{String.fromCharCode(65 + optionIndex)}</span>
                <label className="field"><span>Lựa chọn {optionIndex + 1}</span><input value={option.text} onChange={e => setOption(index, optionIndex, e.target.value)} required placeholder="Nhập phương án trả lời" /></label>
                <label className="package-correct"><input type="radio" name={`correct-${index}`} checked={option.isCorrect} onChange={() => setCorrect(index, optionIndex)} /><span>Đáp án đúng</span></label>
              </div>)}</div>
            </fieldset>)}
          </div>}

          {step === 4 && <div className="stack">
            <div className="package-section-heading"><span className="package-section-mark"><UiIcon name="shield" /></span><div><h3>Kiểm tra trước khi lưu</h3><p className="help">Xác nhận các thông tin cần thiết trước khi tạo hoặc cập nhật bản nháp.</p></div></div>
            <div className="package-review-top"><div><span className="package-eyebrow">BỘ NỘI DUNG</span><h3>{title || 'Chưa đặt tên'}</h3><p className="help">{code || 'Chưa có mã'} · {phase} · {wordCount} từ</p></div><span className={`package-state ${ready ? 'package-state--success' : 'package-state--warning'}`}><UiIcon name={ready ? 'checkCircle' : 'alert'} /> {ready ? 'Đủ điều kiện lưu nháp' : 'Cần bổ sung thông tin'}</span></div>
            <div className="package-checklist">{checkItems.map(item => <div className="package-check-item" key={item.label}><span className={`package-check-icon ${item.complete ? 'is-done' : ''}`}><UiIcon name={item.complete ? 'check' : 'alert'} /></span><div><strong>{item.label}</strong><small>{item.detail}</small></div><span className={`package-check-result ${item.complete ? 'is-done' : ''}`}>{item.complete ? 'Hoàn thành' : 'Chưa đủ'}</span></div>)}</div>
            <div className="package-integrity-note"><UiIcon name="info" /> Lưu bản nháp không phải xuất bản. Sau khi kiểm tra, chọn “Xuất bản” trong danh sách. Revision đã xuất bản sẽ được khóa.</div>
            <button type="submit" disabled={busy || !ready} className="btn btn-primary package-save-btn"><UiIcon name="check" /> {busy ? 'Đang lưu…' : editingId ? 'Lưu thay đổi bản nháp' : 'Lưu bộ nội dung nháp'}</button>
          </div>}
        </div>
        {message && <p className="notice notice-danger" role="alert">{message}</p>}
        <div className="package-wizard-actions"><button type="button" className="btn btn-secondary" onClick={() => chooseStep(Math.max(step - 1, 0))} disabled={step === 0 || busy}><UiIcon name="chevronLeft" /> Quay lại</button><span className="help">Bước {step + 1} / 5</span>{step < 4 && <button type="button" className="btn btn-primary" onClick={() => chooseStep(step + 1)} disabled={busy}>Tiếp theo <UiIcon name="chevronRight" /></button>}</div>
      </form>
    </div>}

    <section className="package-library" aria-label="Danh sách bộ nội dung">
      <div className="package-library-head"><div><span className="package-eyebrow"><UiIcon name="layers" /> THƯ VIỆN NỘI DUNG</span><h2>Danh sách bộ nội dung</h2><p className="help">Tìm kiếm, kiểm tra và quản lý trạng thái xuất bản.</p></div><span className="package-chip">{filtered.length} kết quả</span></div>
      <div className="package-library-controls"><label className="package-search"><UiIcon name="search" /><span className="sr-only">Tìm kiếm bộ nội dung</span><input placeholder="Tìm theo tên, mã hoặc chủ đề…" value={filter} onChange={event => setFilter(event.target.value)} /></label><label className="package-filter"><UiIcon name="filter" /><span className="sr-only">Lọc theo giai đoạn</span><select value={phaseFilter} onChange={event => setPhaseFilter(event.target.value as 'ALL' | StudyPhase)}><option value="ALL">Tất cả giai đoạn</option><option value="PILOT">PILOT</option><option value="MAIN">MAIN</option></select></label></div>
      <div className="package-library-table"><table><thead><tr><th>Bộ nội dung</th><th>Giai đoạn</th><th>Trạng thái</th><th>Phiên bản</th><th>Thao tác</th></tr></thead><tbody>{filtered.map(item => <tr key={item._id}>
        <td><div className="package-table-title"><span className="package-table-icon"><UiIcon name="book" /></span><div><strong>{item.title}</strong><small>{item.code} · {item.topic}</small></div></div></td>
        <td><span className="package-phase-tag">{item.phase}</span></td>
        <td><span className={`package-state ${item.status === 'PUBLISHED' ? 'package-state--success' : item.status === 'ARCHIVED' ? 'package-state--neutral' : 'package-state--warning'}`}><span className="package-state-dot" />{item.status === 'PUBLISHED' ? 'Đã xuất bản' : item.status === 'ARCHIVED' ? 'Đã lưu trữ' : 'Bản nháp'}</span></td>
        <td><span className="package-revision">Bộ #{item.revision}<small>Bài #{item.contentRevision ?? '—'} · Câu #{item.questionRevision ?? '—'}</small></span></td>
        <td><div className="package-row-actions">{canEdit && item.status === 'DRAFT' && <button className="btn btn-secondary btn-small" type="button" disabled={busy} onClick={() => startEditor(item)}><UiIcon name="edit" /> Chỉnh sửa</button>}{canEdit && item.status === 'DRAFT' && <button className="btn btn-primary btn-small" type="button" disabled={busy} onClick={() => setPending({ action: 'PUBLISH', item })}>Xuất bản</button>}{canEdit && item.status === 'PUBLISHED' && <button className="btn btn-secondary btn-small" type="button" disabled={busy} onClick={() => setPending({ action: 'ARCHIVE', item })}><UiIcon name="archive" /> Lưu trữ</button>}{canEdit && item.status !== 'DRAFT' && <button className="btn btn-secondary btn-small" type="button" disabled={busy} onClick={() => void call({ action: 'CLONE', id: item._id }, 'Đã tạo bản nháp từ phiên bản hiện tại')}><UiIcon name="copy" /> Tạo phiên bản mới</button>}</div></td>
      </tr>)}</tbody></table>{filtered.length === 0 && <div className="package-empty"><UiIcon name="search" width={28} height={28} /><strong>Không có bộ nội dung phù hợp</strong><p className="help">Thử từ khóa khác hoặc chọn lại giai đoạn.</p></div>}</div>
      <div className="package-preview-list">{filtered.map(item => <details className="package-detail" key={`preview-${item._id}`}><summary><span><UiIcon name="eye" /> Xem trước: <strong>{item.title}</strong> <span className="package-optional">(#{item.revision})</span></span><UiIcon name="chevronRight" className="package-details-chevron" /></summary><div className="package-detail-content"><Preview rawContent={item.rawContent} mode="both"  /><h3>Kiểm tra điều kiện</h3><div className="package-checklist">{([['Lưu nháp', item.validation?.saveDraft], ['Xuất bản', item.validation?.publish], ['Bắt đầu nghiên cứu', item.validation?.startStudy]] as const).map(([name, valid]) => <div className="package-check-item" key={name}><span className={`package-check-icon ${valid ? 'is-done' : ''}`}><UiIcon name={valid ? 'check' : 'alert'} /></span><strong>{name}</strong><span className={`package-check-result ${valid ? 'is-done' : ''}`}>{valid ? 'Đủ điều kiện' : 'Chưa đủ'}</span></div>)}</div><ul className="readiness-list">{item.validation?.checks.map(check => <li key={check.code}>{check.status} — {check.label}</li>)}</ul><h3>Bộ 5 câu hỏi</h3><ol>{item.questions.map(question => <li key={question.id}>{question.prompt} ({question.options.length} lựa chọn)</li>)}</ol></div></details>)}</div>
    </section>
    {!showEditor && message && <p role="alert" className="notice notice-danger">{message}</p>}
    {pending && <ConfirmDialog key={`${pending.action}-${pending.item._id}`} pending={pending} busy={busy} cancel={() => setPending(null)} confirm={() => void confirmAction()} />}
  </div>;
}
