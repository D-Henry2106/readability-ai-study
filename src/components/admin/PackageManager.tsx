'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { QuestionItem, StudyPhase } from '@/types/research';
import { ExperimentalText } from '@/components/participant/ExperimentalText';
import { RichTextEditor } from './RichTextEditor';
import { countWords } from '@/lib/experiment/content-integrity';
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
  questionSetId?: string | null;
  questionSetLabel?: string | null;
  questionRevision: number | null;
  rawContent: string;
  v2Content?: string | null;
  aiSource?: string | null;
  questions?: QuestionItem[];
  createdAt: string;
  publishedAt: string | null;
  validation?: {
    saveDraft: boolean;
    publish: boolean;
    startStudy: boolean;
    checks: Array<{ code: string; label: string; status: string }>;
  };
}

export interface AvailableQuestionSet {
  _id: string;
  revision: number;
  label: string;
  phase: StudyPhase;
  status: 'DRAFT' | 'PUBLISHED';
  locked: boolean;
  questionCount: number;
  archivedAt?: string | null;
  questions?: Array<{ id: string; prompt: string; category?: string }>;
}

type Action = 'PUBLISH' | 'ARCHIVE';
type PendingAction = { action: Action; item: PackageView };
type PreviewMode = 'both' | 'V1' | 'V2';

const wizardSteps = [
  { id: 'metadata', label: 'Thông tin cơ bản' },
  { id: 'content', label: 'Nội dung V1 & V2' },
  { id: 'review', label: 'Kiểm tra & lưu' }
];

function ConfirmDialog({
  pending,
  busy,
  cancel,
  confirm
}: {
  pending: PendingAction;
  busy: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      if (node?.open) node.close();
    };
  }, []);
  const publishing = pending.action === 'PUBLISH';
  return (
    <dialog
      ref={ref}
      className="admin-confirm"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else cancel();
      }}
    >
      <div className="admin-confirm-icon">
        <UiIcon name={publishing ? 'shield' : 'archive'} width={23} height={23} />
      </div>
      <h2>{publishing ? 'Xác nhận xuất bản?' : 'Lưu trữ bộ nội dung?'}</h2>
      <p>
        <strong>{pending.item.title}</strong> · {pending.item.code}
      </p>
      <p className="help">
        {publishing
          ? 'Bài đọc sẽ được khóa để bảo toàn dữ liệu nghiên cứu. Bạn chỉ có thể chỉnh sửa bằng cách tạo phiên bản mới.'
          : 'Bộ nội dung sẽ ngừng xuất hiện trong danh sách có thể phân công. Những phiên đã bắt đầu vẫn giữ nguyên dữ liệu lịch sử.'}
      </p>
      <div className="admin-confirm-actions">
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={cancel}>
          Hủy
        </button>
        <button
          className={`btn ${publishing ? 'btn-primary' : 'btn-danger'}`}
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            confirm();
          }}
        >
          {busy ? 'Đang xử lý…' : publishing ? 'Xác nhận xuất bản' : 'Lưu trữ'}
        </button>
      </div>
    </dialog>
  );
}

function Preview({
  rawContent,
  v2Content,
  mode,
  onModeChange
}: {
  rawContent: string;
  v2Content?: string | null;
  mode: PreviewMode;
  onModeChange?: (mode: PreviewMode) => void;
}) {
  const effectiveV2 = v2Content?.trim() ? v2Content : rawContent;
  return (
    <div className="package-preview stack">
      <div className="package-preview-toolbar">
        <div>
          <span className="package-eyebrow">
            <UiIcon name="eye" /> KHUNG XEM TRƯỚC
          </span>
          <h3>So sánh hiển thị V1 và V2</h3>
          <p className="help">
            V1 là phiên bản chuẩn. V2 có thể có định dạng, khoảng cách dòng hoặc cấu trúc đoạn độc lập.
          </p>
        </div>
        {onModeChange && (
          <div className="package-segment" role="group" aria-label="Kiểu xem trước">
            {(
              [
                ['both', 'Song song'],
                ['V1', 'Chỉ V1'],
                ['V2', 'Chỉ V2']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                className={mode === value ? 'is-selected' : ''}
                onClick={() => onModeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`preview-grid preview-grid--${mode}`}>
        {mode !== 'V2' && (
          <section className="package-preview-panel">
            <div className="package-preview-heading">
              <span className="package-version package-version--v1">V1</span>
              <div>
                <strong>Bản chuẩn (Standard)</strong>
                <small>Văn bản gốc</small>
              </div>
            </div>
            <div className="package-reading">
              <ExperimentalText rawContent={rawContent} presentation="V1" />
            </div>
          </section>
        )}
        {mode !== 'V1' && (
          <section className="package-preview-panel package-preview-panel--v2">
            <div className="package-preview-heading">
              <span className="package-version package-version--v2">V2</span>
              <div>
                <strong>Bản dễ tiếp cận (Accessible)</strong>
                <small>
                  {v2Content?.trim() ? 'Định dạng V2 riêng biệt' : 'Tối ưu phân đoạn tự động'}
                </small>
              </div>
            </div>
            <div className="package-reading">
              <ExperimentalText rawContent={effectiveV2} presentation="V2" />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function PackageManager({
  items,
  questionSets = [],
  canEdit
}: {
  items: PackageView[];
  questionSets?: AvailableQuestionSet[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [filter, setFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | StudyPhase>('ALL');

  // Form fields
  const [phase, setPhase] = useState<StudyPhase>('PILOT');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [aiSource, setAi] = useState('');
  const [rawContent, setRaw] = useState('');
  const [v2Content, setV2] = useState('');

  const [previewMode, setPreviewMode] = useState<PreviewMode>('both');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const actionLockRef = useRef(false);

  const v1WordCount = useMemo(
    () => countWords(rawContent),
    [rawContent]
  );
  const v2WordCount = useMemo(
    () => countWords(v2Content),
    [v2Content]
  );

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchesText = `${item.title} ${item.code} ${item.topic}`
        .toLocaleLowerCase('vi')
        .includes(filter.trim().toLocaleLowerCase('vi'));
      return matchesText && (phaseFilter === 'ALL' || item.phase === phaseFilter);
    });
  }, [items, filter, phaseFilter]);

  const drafts = items.filter((item) => item.status === 'DRAFT').length;
  const published = items.filter((item) => item.status === 'PUBLISHED').length;

  // Validation
  const baseComplete = code.trim().length > 1 && !!title.trim() && !!topic.trim();
  const contentComplete = !!rawContent.trim();
  const ready = baseComplete && contentComplete;

  const checkItems = [
    { label: 'Thông tin cơ bản', complete: baseComplete, detail: 'Mã, tên và chủ đề nghiên cứu' },
    {
      label: 'Bài đọc V1',
      complete: contentComplete,
      detail: `${v1WordCount} từ trong nội dung chuẩn`
    },
    {
      label: 'Bài đọc V2',
      complete: true,
      detail: v2Content.trim()
        ? `${v2WordCount} từ (định dạng V2 riêng biệt)`
        : 'Dùng văn bản V1 với định dạng dễ tiếp cận tự động'
    }
  ];

  async function call(data: Record<string, unknown>, successTitle: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/packages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : body.issues?.[0]?.message ?? 'Thao tác thất bại.'
        );
      }
      toast({
        kind: 'success',
        title: successTitle,
        description: 'Dữ liệu đã được cập nhật thành công.'
      });
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
    setAi(item?.aiSource ?? '');
    setRaw(item?.rawContent ?? '');
    setV2(item?.v2Content ?? '');
    setEditingId(item?._id ?? null);
    setPreviewMode('both');
    setShowEditor(true);
    setStep(0);
    setMessage('');
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  }

  function chooseStep(next: number) {
    if (next > step) {
      if (step === 0 && !baseComplete) {
        const description = 'Hãy nhập đầy đủ mã, tên và chủ đề trước khi tiếp tục.';
        setMessage(description);
        toast({ kind: 'info', title: 'Cần thêm thông tin', description });
        return;
      }
      if (step === 1 && !contentComplete) {
        const description = 'Hãy nhập nội dung bài đọc V1 trước khi tiếp tục.';
        setMessage(description);
        toast({ kind: 'info', title: 'Cần thêm thông tin', description });
        return;
      }
    }
    setMessage('');
    setStep(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
      const description = 'Vui lòng hoàn thành thông tin cơ bản và nội dung bài đọc V1.';
      setMessage(description);
      toast({ kind: 'error', title: 'Bản nháp chưa hoàn chỉnh', description });
      return;
    }
    await call(
      {
        action: editingId ? 'UPDATE' : 'CREATE',
        id: editingId ?? undefined,
        code,
        title,
        topic,
        description,
        phase,
        rawContent,
        v2Content: v2Content.trim() ? v2Content : null,
        aiSource: aiSource || null
      },
      editingId ? 'Đã lưu thay đổi bản nháp' : 'Đã tạo bộ nội dung nháp'
    );
  }

  async function confirmAction() {
    if (!pending || busy || actionLockRef.current) return;
    actionLockRef.current = true;
    const { item, action } = pending;
    try {
      const ok = await call(
        { action, id: item._id },
        action === 'PUBLISH' ? 'Đã xuất bản và khóa bộ nội dung' : 'Đã lưu trữ bộ nội dung'
      );
      if (ok) setPending(null);
    } finally {
      actionLockRef.current = false;
    }
  }

  return (
    <div className="package-manager stack">
      <section className="package-hero" aria-label="Tổng quan bộ nội dung">
        <div className="package-hero-main">
          <span className="package-eyebrow">
            <UiIcon name="sparkles" /> QUẢN LÝ BỘ NỘI DUNG THỰC NGHIỆM
          </span>
          <h2>
            Định hình bài đọc V1 & V2.<br />
            <span>Nội dung nghiên cứu chuẩn hóa.</span>
          </h2>
          <p>
            Soạn thảo bài đọc V1 (chuẩn) và V2 (dễ tiếp cận) để tạo nên Bộ nội dung hoàn chỉnh phục vụ thực nghiệm.
          </p>
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary package-hero-cta"
              onClick={() => (showEditor ? setShowEditor(false) : startEditor())}
            >
              <UiIcon name={showEditor ? 'close' : 'plus'} />{' '}
              {showEditor ? 'Đóng trình biên tập' : 'Tạo bộ nội dung mới'}
            </button>
          )}
        </div>
        <div className="package-stats" aria-label="Thống kê bộ nội dung">
          <div className="package-stat">
            <span className="package-stat-icon package-stat-icon--blue">
              <UiIcon name="layers" />
            </span>
            <strong>{items.length}</strong>
            <small>Tổng bộ nội dung</small>
          </div>
          <div className="package-stat">
            <span className="package-stat-icon package-stat-icon--amber">
              <UiIcon name="edit" />
            </span>
            <strong>{drafts}</strong>
            <small>Bản nháp</small>
          </div>
          <div className="package-stat">
            <span className="package-stat-icon package-stat-icon--mint">
              <UiIcon name="checkCircle" />
            </span>
            <strong>{published}</strong>
            <small>Đã xuất bản</small>
          </div>
        </div>
      </section>

      {showEditor && canEdit && (
        <div ref={editorRef} className="package-editor-anchor">
          <form className="package-wizard stack" onSubmit={save} noValidate={false}>
            <div className="package-wizard-head">
              <div>
                <span className="package-eyebrow">
                  <UiIcon name="edit" /> TRÌNH BIÊN TẬP BỘ NỘI DUNG
                </span>
                <h2>{editingId ? 'Chỉnh sửa bản nháp' : 'Tạo bộ nội dung mới'}</h2>
                <p className="help">
                  Tuân theo quy trình chuẩn: Nhập thông tin cơ bản, soạn thảo bài đọc V1/V2 và kiểm tra.
                </p>
              </div>
              <div className="package-step-count">
                <strong>{String(step + 1).padStart(2, '0')}</strong>
                <span> / 03</span>
                <small>Bước hiện tại</small>
              </div>
            </div>

            <div
              className="package-progress"
              role="progressbar"
              aria-label="Tiến độ quy trình"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={3}
            >
              <span style={{ width: `${((step + 1) / 3) * 100}%` }} />
            </div>

            <ol className="wizard-steps" aria-label="Các bước tạo bộ nội dung">
              {wizardSteps.map((s, index) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={
                      step === index ? 'wizard-active' : index < step ? 'wizard-done' : ''
                    }
                    aria-current={step === index ? 'step' : undefined}
                    onClick={() => chooseStep(index)}
                  >
                    <span className="wizard-number">
                      {index < step ? (
                        <UiIcon name="check" width={15} height={15} />
                      ) : (
                        String(index + 1).padStart(2, '0')
                      )}
                    </span>
                    <span className="wizard-label">{s.label}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="package-wizard-body">
              {/* STEP 0: THÔNG TIN CƠ BẢN */}
              {step === 0 && (
                <div className="stack">
                  <div className="package-section-heading">
                    <span className="package-section-mark">
                      <UiIcon name="layers" />
                    </span>
                    <div>
                      <h3>Thông tin bộ nội dung</h3>
                      <p className="help">Mã nhận diện, tên hiển thị và giai đoạn nghiên cứu.</p>
                    </div>
                  </div>
                  <div className="package-form-grid">
                    <label className="field">
                      <span>
                        Mã bộ nội dung <em>*</em>
                      </span>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                        maxLength={40}
                        pattern="[a-zA-Z0-9_-]{2,40}"
                        placeholder="Ví dụ: AI_LESSON_01"
                      />
                    </label>
                    <label className="field">
                      <span>
                        Tên bộ nội dung <em>*</em>
                      </span>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        maxLength={150}
                        placeholder="Ví dụ: Introduction to Machine Learning"
                      />
                    </label>
                    <label className="field">
                      <span>
                        Chủ đề <em>*</em>
                      </span>
                      <input
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        required
                        maxLength={160}
                        placeholder="Ví dụ: Machine Learning Basics"
                      />
                    </label>
                    <label className="field">
                      <span>Giai đoạn</span>
                      <select
                        value={phase}
                        onChange={(e) => setPhase(e.target.value as StudyPhase)}
                      >
                        <option value="PILOT">PILOT — Thử nghiệm</option>
                        <option value="MAIN">MAIN — Chính thức</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>
                        Nguồn AI <span className="package-optional">(tùy chọn)</span>
                      </span>
                      <input
                        value={aiSource}
                        onChange={(e) => setAi(e.target.value)}
                        maxLength={120}
                        placeholder="Ví dụ: ChatGPT bản web, Gemini Web"
                      />
                    </label>
                    <label className="field package-full-width">
                      <span>
                        Mô tả tóm tắt <span className="package-optional">(tùy chọn)</span>
                      </span>
                      <textarea
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={1000}
                        placeholder="Mục đích và ghi chú nghiên cứu…"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* STEP 1: NỘI DUNG V1 & V2 */}
              {step === 1 && (
                <div className="stack">
                  <div className="package-section-heading">
                    <span className="package-section-mark">
                      <UiIcon name="book" />
                    </span>
                    <div>
                      <h3>Nội dung bài đọc V1 & V2</h3>
                      <p className="help">
                        V1 là bài đọc chuẩn. V2 có thể có cấu trúc, khoảng cách và định dạng riêng biệt.
                      </p>
                    </div>
                  </div>

                  <div className="package-content-editors grid-2col">
                    {/* V1 Editor */}
                    <div className="card stack">
                      <div className="space-between">
                        <div>
                          <span className="package-version package-version--v1">V1</span>
                          <strong>Nội dung chuẩn (Standard)</strong>
                        </div>
                        <span className="package-chip">{v1WordCount} từ</span>
                      </div>
                      <label className="field">
                        <span>
                          Văn bản V1 <em>*</em>
                        </span>
                        <RichTextEditor
                          value={rawContent}
                          onChange={setRaw}
                          placeholder="Dán hoặc soạn nội dung bài đọc chuẩn V1 tại đây…"
                          minHeight={250}
                        />
                      </label>
                      <small className="help">
                        Nội dung nguyên bản được dùng làm đối chứng chuẩn trong nghiên cứu.
                      </small>
                    </div>

                    {/* V2 Editor */}
                    <div className="card stack">
                      <div className="space-between">
                        <div>
                          <span className="package-version package-version--v2">V2</span>
                          <strong>Nội dung dễ tiếp cận (Accessible)</strong>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="package-chip">
                            {v2Content.trim() ? `${v2WordCount} từ` : 'Kế thừa V1'}
                          </span>
                          {rawContent.trim() && !v2Content.trim() && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={() => setV2(rawContent)}
                            >
                              Sao chép từ V1
                            </button>
                          )}
                        </div>
                      </div>
                      <label className="field">
                        <span>
                          Văn bản V2 <span className="package-optional">(tùy chọn định dạng riêng)</span>
                        </span>
                        <RichTextEditor
                          value={v2Content}
                          onChange={setV2}
                          placeholder="Nhập hoặc định dạng văn bản V2 (hoặc để trống để tự động áp dụng phân đoạn dễ tiếp cận từ V1)…"
                          minHeight={250}
                        />
                      </label>
                      <small className="help">
                        V2 cho phép cấu trúc độc lập: có thể chia đoạn ngắn hơn, thêm ngắt dòng hoặc bố cục giúp dễ tiếp cận.
                      </small>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: XEM TRƯỚC, KIỂM TRA & LƯU */}
              {step === 2 && (
                <div className="stack">
                  <Preview
                    rawContent={rawContent}
                    v2Content={v2Content}
                    mode={previewMode}
                    onModeChange={setPreviewMode}
                  />

                  <div className="package-section-heading" style={{ marginTop: 24 }}>
                    <span className="package-section-mark">
                      <UiIcon name="shield" />
                    </span>
                    <div>
                      <h3>Kiểm tra điều kiện trước khi lưu</h3>
                      <p className="help">
                        Xác nhận tính hoàn chỉnh của bộ nội dung trước khi lưu bản nháp.
                      </p>
                    </div>
                  </div>

                  <div className="package-review-top">
                    <div>
                      <span className="package-eyebrow">BỘ NỘI DUNG</span>
                      <h3>{title || 'Chưa đặt tên'}</h3>
                      <p className="help">
                        {code || 'Chưa có mã'} · {phase} · V1: {v1WordCount} từ{' '}
                        {v2Content.trim() ? `· V2: ${v2WordCount} từ` : ''}
                      </p>
                    </div>
                    <span
                      className={`package-state ${
                        ready ? 'package-state--success' : 'package-state--warning'
                      }`}
                    >
                      <UiIcon name={ready ? 'checkCircle' : 'alert'} />{' '}
                      {ready ? 'Đủ điều kiện lưu nháp' : 'Cần bổ sung thông tin'}
                    </span>
                  </div>

                  <div className="package-checklist">
                    {checkItems.map((item) => (
                      <div className="package-check-item" key={item.label}>
                        <span className={`package-check-icon ${item.complete ? 'is-done' : ''}`}>
                          <UiIcon name={item.complete ? 'check' : 'alert'} />
                        </span>
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </div>
                        <span
                          className={`package-check-result ${item.complete ? 'is-done' : ''}`}
                        >
                          {item.complete ? 'Hoàn thành' : 'Chưa đủ'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="package-integrity-note">
                    <UiIcon name="info" /> Lưu bản nháp không phải xuất bản. Sau khi tạo bản nháp,
                    bạn có thể bấm “Xuất bản” trong danh sách để sẵn sàng sử dụng.
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !ready}
                    className="btn btn-primary package-save-btn"
                  >
                    <UiIcon name="check" />{' '}
                    {busy
                      ? 'Đang lưu…'
                      : editingId
                        ? 'Lưu thay đổi bản nháp'
                        : 'Lưu bộ nội dung nháp'}
                  </button>
                </div>
              )}
            </div>

            {message && (
              <p className="notice notice-danger" role="alert">
                {message}
              </p>
            )}

            <div className="package-wizard-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => chooseStep(Math.max(step - 1, 0))}
                disabled={step === 0 || busy}
              >
                <UiIcon name="chevronLeft" /> Quay lại
              </button>
              <span className="help">
                Bước {step + 1} / {wizardSteps.length}
              </span>
              {step < wizardSteps.length - 1 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => chooseStep(step + 1)}
                  disabled={busy}
                >
                  Tiếp theo <UiIcon name="chevronRight" />
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* LIBRARY LIST */}
      <section className="package-library" aria-label="Danh sách bộ nội dung">
        <div className="package-library-head">
          <div>
            <span className="package-eyebrow">
              <UiIcon name="layers" /> THƯ VIỆN BỘ NỘI DUNG
            </span>
            <h2>Danh sách bộ nội dung</h2>
            <p className="help">
              Quản lý các bộ bài đọc V1/V2, liên kết câu hỏi và trạng thái xuất bản.
            </p>
          </div>
          <span className="package-chip">{filtered.length} kết quả</span>
        </div>

        <div className="package-library-controls">
          <label className="package-search">
            <UiIcon name="search" />
            <span className="sr-only">Tìm kiếm bộ nội dung</span>
            <input
              placeholder="Tìm theo tên, mã hoặc chủ đề…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <label className="package-filter">
            <UiIcon name="filter" />
            <span className="sr-only">Lọc theo giai đoạn</span>
            <select
              value={phaseFilter}
              onChange={(event) => setPhaseFilter(event.target.value as 'ALL' | StudyPhase)}
            >
              <option value="ALL">Tất cả giai đoạn</option>
              <option value="PILOT">PILOT</option>
              <option value="MAIN">MAIN</option>
            </select>
          </label>
        </div>

        <div className="package-library-table">
          <table>
            <thead>
              <tr>
                <th>Bộ nội dung</th>
                <th>Giai đoạn</th>
                <th>Trạng thái</th>
                <th>Phiên bản</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item._id}>
                  <td>
                    <div className="package-table-title">
                      <span className="package-table-icon">
                        <UiIcon name="book" />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {item.code} · {item.topic}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="package-phase-tag">{item.phase}</span>
                  </td>
                  <td>
                    <span
                      className={`package-state ${
                        item.status === 'PUBLISHED'
                          ? 'package-state--success'
                          : item.status === 'ARCHIVED'
                            ? 'package-state--neutral'
                            : 'package-state--warning'
                      }`}
                    >
                      <span className="package-state-dot" />
                      {item.status === 'PUBLISHED'
                        ? 'Đã xuất bản'
                        : item.status === 'ARCHIVED'
                          ? 'Đã lưu trữ'
                          : 'Bản nháp'}
                    </span>
                  </td>
                  <td>
                    <span className="package-revision">
                      Bộ #{item.revision}
                      <small>Bài #{item.contentRevision ?? '—'}</small>
                    </span>
                  </td>
                  <td>
                    <div className="package-row-actions">
                      {canEdit && item.status === 'DRAFT' && (
                        <button
                          className="btn btn-secondary btn-small"
                          type="button"
                          disabled={busy}
                          onClick={() => startEditor(item)}
                        >
                          <UiIcon name="edit" /> Chỉnh sửa
                        </button>
                      )}
                      {canEdit && item.status === 'DRAFT' && (
                        <button
                          className="btn btn-primary btn-small"
                          type="button"
                          disabled={busy}
                          onClick={() => setPending({ action: 'PUBLISH', item })}
                        >
                          Xuất bản
                        </button>
                      )}
                      {canEdit && item.status === 'PUBLISHED' && (
                        <button
                          className="btn btn-secondary btn-small"
                          type="button"
                          disabled={busy}
                          onClick={() => setPending({ action: 'ARCHIVE', item })}
                        >
                          <UiIcon name="archive" /> Lưu trữ
                        </button>
                      )}
                      {canEdit && item.status !== 'DRAFT' && (
                        <button
                          className="btn btn-secondary btn-small"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void call(
                              { action: 'CLONE', id: item._id },
                              'Đã tạo bản nháp mới từ phiên bản hiện tại'
                            )
                          }
                        >
                          <UiIcon name="copy" /> Tạo phiên bản mới
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="package-empty">
              <UiIcon name="search" width={28} height={28} />
              <strong>Không có bộ nội dung phù hợp</strong>
              <p className="help">Thử từ khóa khác hoặc tạo bộ nội dung mới.</p>
            </div>
          )}
        </div>

        {/* PREVIEW DETAILS */}
        <div className="package-preview-list">
          {filtered.map((item) => (
            <details className="package-detail" key={`preview-${item._id}`}>
              <summary>
                <span>
                  <UiIcon name="eye" /> Xem trước: <strong>{item.title}</strong>{' '}
                  <span className="package-optional">(#{item.revision})</span>
                </span>
                <UiIcon name="chevronRight" className="package-details-chevron" />
              </summary>
              <div className="package-detail-content stack">
                <Preview
                  rawContent={item.rawContent}
                  v2Content={item.v2Content}
                  mode="both"
                />
                <div className="card stack-sm">
                  <h4>Kiểm tra điều kiện kỹ thuật</h4>
                  <div className="package-checklist">
                    {(
                      [
                        ['Lưu nháp', item.validation?.saveDraft],
                        ['Xuất bản', item.validation?.publish],
                        ['Bắt đầu nghiên cứu', item.validation?.startStudy]
                      ] as const
                    ).map(([name, valid]) => (
                      <div className="package-check-item" key={name}>
                        <span className={`package-check-icon ${valid ? 'is-done' : ''}`}>
                          <UiIcon name={valid ? 'check' : 'alert'} />
                        </span>
                        <strong>{name}</strong>
                        <span className={`package-check-result ${valid ? 'is-done' : ''}`}>
                          {valid ? 'Đủ điều kiện' : 'Chưa đủ'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {!showEditor && message && (
        <p role="alert" className="notice notice-danger">
          {message}
        </p>
      )}

      {pending && (
        <ConfirmDialog
          key={`${pending.action}-${pending.item._id}`}
          pending={pending}
          busy={busy}
          cancel={() => setPending(null)}
          confirm={() => void confirmAction()}
        />
      )}
    </div>
  );
}
