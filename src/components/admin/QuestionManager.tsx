'use client';
import { useRef, useState } from 'react';
import type { QuestionItem, StudyPhase } from '@/types/research';
import {
  OPTIONS_PER_QUESTION,
  QUESTION_CATEGORIES,
  QUESTIONS_PER_CATEGORY,
  QUESTIONS_PER_TEST,
  questionSetBlockers,
  type QuestionCategory
} from '@/lib/questions/question-spec';
import {
  getQuestionImportTemplate,
  validateQuestionImport
} from '@/lib/questions/question-import';

const CATEGORY_INFO: Record<QuestionCategory, { label: string; hint: string }> = {
  CONCEPTUAL: { label: 'Khái niệm (Conceptual)', hint: 'Hỏi về ý chính hoặc khái niệm trung tâm của bài đọc.' },
  TERMINOLOGY: { label: 'Thuật ngữ (Terminology)', hint: 'Hỏi về nghĩa của một thuật ngữ được dùng trong bài.' },
  RELATIONSHIP: { label: 'Quan hệ (Relationship)', hint: 'Hỏi về mối liên hệ giữa các ý, ví dụ nguyên nhân – kết quả, so sánh.' },
  CONDITIONAL: { label: 'Điều kiện (Conditional)', hint: 'Hỏi theo dạng "nếu … thì …" dựa trên nội dung bài.' },
  INFERENTIAL: { label: 'Suy luận (Inferential)', hint: 'Hỏi về điều có thể rút ra nhưng bài không nói thẳng.' }
};
const LETTERS = ['A', 'B', 'C', 'D'];
const PAGE_SIZE = 5;

type QuestionSetItem = {
  _id: string;
  revision: number;
  label: string;
  questions: QuestionItem[];
  status: 'DRAFT' | 'PUBLISHED';
  locked: boolean;
  phase: StudyPhase;
  archivedAt?: string | null;
};

/** Turns a server error body ({ error, issues: [{ path, message }] }) into a message that says which field is wrong. */
function describeError(d: { error?: unknown; issues?: Array<{ path?: string; message?: string }> } | null, failure: string): string {
  const base = typeof d?.error === 'string' ? d.error : failure;
  const issues = (d?.issues ?? []).slice(0, 5).map((i) => {
    const m = /^questions\.(\d+)\.?(.*)$/.exec(i.path ?? '');
    const where = m ? `Câu ${Number(m[1]) + 1}${m[2] ? ` (${m[2].replace('prompt', 'nội dung').replace('options', 'lựa chọn')})` : ''}` : (i.path || 'Dữ liệu');
    return `${where}: ${i.message ?? ''}`;
  });
  return issues.length ? `${base} ${issues.join(' · ')}` : base;
}

const isDone = (q: QuestionItem) =>
  q.prompt.trim() !== '' &&
  q.options.length === OPTIONS_PER_QUESTION &&
  q.options.every((o) => o.text.trim() !== '') &&
  q.options.filter((o) => o.isCorrect).length === 1;

function blankQuestion(id: string, category: QuestionCategory): QuestionItem {
  return {
    id,
    category,
    prompt: '',
    options: Array.from({ length: OPTIONS_PER_QUESTION }, (_, j) => ({
      id: `${id}o${j + 1}`,
      text: '',
      isCorrect: j === 0
    }))
  };
}

/** Always returns exactly 15 slots in category order (3 per category). Existing questions keep their ids and fill the slots of their category first. */
function toSlots(existing: QuestionItem[]): QuestionItem[] {
  const clone = (q: QuestionItem): QuestionItem => ({ ...q, options: q.options.map((o) => ({ ...o })) });
  const taken = new Set(existing.map((q) => q.id));
  const byCategory = new Map<QuestionCategory, QuestionItem[]>(
    QUESTION_CATEGORIES.map((c) => [c, existing.filter((q) => q.category === c).slice(0, QUESTIONS_PER_CATEGORY).map(clone)])
  );
  const placed = new Set([...byCategory.values()].flat().map((q) => q.id));
  const leftovers = existing.filter((q) => !placed.has(q.id)).map(clone);
  let n = 0;
  const freshId = () => {
    let id: string;
    do {
      n += 1;
      id = `q${Date.now().toString(36)}${n}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
  const slots: QuestionItem[] = [];
  for (const c of QUESTION_CATEGORIES) {
    const mine = byCategory.get(c)!;
    while (mine.length < QUESTIONS_PER_CATEGORY) {
      const next = leftovers.shift();
      mine.push(next ? { ...next, category: c } : blankQuestion(freshId(), c));
    }
    slots.push(...mine);
  }
  return slots;
}

type CallResult = { ok: boolean; data: { id?: string } | null };

export function QuestionManager({ items, canEdit }: { items: QuestionSetItem[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState<StudyPhase>('MAIN');
  const [slots, setSlots] = useState<QuestionItem[]>([]);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Import / Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<QuestionItem[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const done = slots.filter(isDone).length;
  const blockers = questionSetBlockers(slots);
  const complete = blockers.length === 0 && label.trim() !== '';

  const totalPages = Math.max(1, Math.ceil(slots.length / PAGE_SIZE));
  const startIndex = page * PAGE_SIZE;
  const endIndex = Math.min(slots.length, startIndex + PAGE_SIZE);
  const pageSlots = slots.slice(startIndex, endIndex);

  const patch = (id: string, fn: (q: QuestionItem) => QuestionItem) =>
    setSlots((all) => all.map((q) => (q.id === id ? fn(q) : q)));

  const startNew = () => {
    setEditingId(null);
    setLabel('');
    setPhase('MAIN');
    setSlots(toSlots([]));
    setPage(0);
    setMessage('');
    setImportErrors([]);
    setImportPreview(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditingId(null);
    setLabel('');
    setSlots([]);
    setPage(0);
    setMessage('');
    setImportErrors([]);
    setImportPreview(null);
  };

  function edit(item: QuestionSetItem) {
    setEditingId(item._id);
    setLabel(item.label);
    setPhase(item.phase);
    setSlots(toSlots(item.questions));
    setPage(0);
    setMessage('');
    setImportErrors([]);
    setImportPreview(null);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function triggerImportFile() {
    setImportErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const result = validateQuestionImport(parsed);
        if (result.ok) {
          setImportPreview(result.questions);
          setImportErrors([]);
        } else {
          setImportErrors(result.errors);
          setImportPreview(null);
        }
      } catch (err) {
        setImportErrors(['File JSON không đúng định dạng cú pháp: ' + (err instanceof Error ? err.message : String(err))]);
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  }

  function handleExportTemplate() {
    const template = getQuestionImportTemplate();
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'question-set-template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function applyImport() {
    if (!importPreview) return;
    setSlots(toSlots(importPreview));
    setPage(0);
    setImportPreview(null);
    setImportErrors([]);
    if (!open) {
      setEditingId(null);
      setLabel(label.trim() ? label : 'Bộ câu hỏi đã nhập từ JSON');
      setPhase('MAIN');
      setOpen(true);
    }
    setMessage('Đã nạp 15 câu hỏi từ file JSON vào trình soạn thảo.');
  }

  async function call(body: Record<string, unknown>, failure: string): Promise<CallResult> {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMessage(describeError(d, failure));
        return { ok: false, data: null };
      }
      return { ok: true, data: d };
    } catch {
      setMessage(failure);
      return { ok: false, data: null };
    } finally {
      setBusy(false);
    }
  }

  async function save(publishAfter: boolean) {
    if (publishAfter && !window.confirm('Lưu và xuất bản bộ câu hỏi này? Bộ câu hỏi sẽ sẵn sàng để gán cho Study Run (dùng chung cho cả V1 và V2).')) return;
    const body = editingId
      ? { action: 'UPDATE', id: editingId, label, phase, questions: slots }
      : { action: 'CREATE_DRAFT', label, phase, questions: slots };
    let saved = await call(body, 'Lưu bộ câu hỏi thất bại.');
    if (!saved.ok) {
      if (saved.data && (saved.data as { requiresForce?: boolean }).requiresForce) {
        if (window.confirm('Bộ câu hỏi đã có dữ liệu làm bài từ người tham gia. Bạn có chắc chắn muốn ghi đè các thay đổi này không?')) {
          saved = await call({ ...body, force: true }, 'Lưu bộ câu hỏi thất bại.');
          if (!saved.ok) return;
        } else {
          return;
        }
      } else {
        return;
      }
    }
    const id = editingId ?? saved.data?.id ?? null;
    if (!editingId && id) setEditingId(id);
    if (publishAfter) {
      if (!id) {
        setMessage('Đã lưu nhưng không lấy được mã bộ câu hỏi để xuất bản. Hãy xuất bản từ danh sách bên dưới.');
        return;
      }
      const published = await call({ action: 'PUBLISH', id }, 'Xuất bản thất bại.');
      if (!published.ok) return;
    }
    window.location.reload();
  }

  async function publish(id: string) {
    if (!window.confirm('Xuất bản bộ câu hỏi này để sẵn sàng dùng cho Study Run chung (V1 và V2)?')) return;
    if ((await call({ action: 'PUBLISH', id }, 'Xuất bản thất bại.')).ok) window.location.reload();
  }

  async function archive(id: string) {
    if (!window.confirm('Lưu trữ bộ câu hỏi này? Bộ sẽ không được chọn cho lượt nghiên cứu mới; dữ liệu cũ không bị ảnh hưởng.')) return;
    if ((await call({ action: 'ARCHIVE', id }, 'Lưu trữ thất bại.')).ok) window.location.reload();
  }

  async function remove(id: string) {
    if (!window.confirm('Xóa bộ câu hỏi này? Nếu đã có dữ liệu nghiên cứu hoặc liên kết với bộ nội dung, hệ thống sẽ tự động chuyển sang lưu trữ an toàn.')) return;
    if ((await call({ action: 'DELETE', id }, 'Xóa thất bại.')).ok) window.location.reload();
  }

  return (
    <div className="stack">
      {/* Hidden file input for JSON import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Main card when editor is not open */}
      {canEdit && !open ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Bộ câu hỏi đọc hiểu (Dùng chung V1 & V2)</h2>
          <p className="help">
            Mỗi bộ gồm đúng {QUESTIONS_PER_TEST} câu (chia 5 nhóm × 3 câu/nhóm). Cả hai phiên bản trình bày V1 (Standard AI Output) và V2 (Accessible AI Output) sử dụng chung bộ câu hỏi này nhằm đảm bảo tính khách quan và so sánh chính xác kết quả đọc hiểu.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={startNew}>
              + Tạo bộ câu hỏi mới ({QUESTIONS_PER_TEST} câu)
            </button>
            <button type="button" className="btn btn-secondary" onClick={triggerImportFile}>
              Nhập JSON (Import JSON)
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleExportTemplate}>
              Tải file mẫu (Export Template)
            </button>
          </div>
        </section>
      ) : null}

      {/* Import Errors Alert */}
      {importErrors.length > 0 ? (
        <section className="card stack" style={{ border: '1px solid #f87171', background: '#fef2f2' }} role="alert">
          <strong style={{ color: '#b91c1c' }}>Lỗi kiểm tra cấu trúc dữ liệu JSON ({importErrors.length} lỗi):</strong>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#b91c1c', fontSize: '0.88rem' }}>
            {importErrors.slice(0, 10).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
            {importErrors.length > 10 && <li>...và {importErrors.length - 10} lỗi khác</li>}
          </ul>
          <div>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setImportErrors([])}>
              Đóng thông báo lỗi
            </button>
          </div>
        </section>
      ) : null}

      {/* Import Preview Section */}
      {importPreview ? (
        <section className="card stack" style={{ border: '2px solid #3b82f6', background: '#f8faff' }}>
          <div className="space-between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, color: '#1e40af' }}>Xem trước dữ liệu nhập ({importPreview.length} câu hỏi)</h3>
              <p className="help" style={{ margin: 0 }}>
                Xác thực cấu trúc thành công. Kiểm tra nội dung bên dưới rồi bấm &quot;Áp dụng&quot; để đưa vào trình soạn thảo.
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={applyImport}>
                Áp dụng vào trình soạn thảo
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>
                Hủy
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid #dbeafe', borderRadius: 8, padding: 12, background: '#fff' }}>
            <ol style={{ margin: 0, paddingLeft: 22 }}>
              {importPreview.map((q, idx) => (
                <li key={q.id} style={{ marginBottom: 12 }}>
                  <div>
                    <strong>Câu {idx + 1}: {q.prompt || '(chưa có nội dung)'}</strong>{' '}
                    <span className="badge" style={{ fontSize: '0.75rem' }}>{q.category}</span>
                  </div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {q.options.map((opt, oi) => (
                      <li
                        key={opt.id}
                        style={{
                          color: opt.isCorrect ? '#15803d' : 'inherit',
                          fontWeight: opt.isCorrect ? 600 : 'normal'
                        }}
                      >
                        {LETTERS[oi]}. {opt.text || '(trống)'} {opt.isCorrect ? '✓ (Đáp án đúng)' : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {/* Editor Form when open */}
      {canEdit && open ? (
        <section className="card stack">
          <div className="space-between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0 }}>{editingId ? 'Chỉnh sửa bộ câu hỏi' : 'Tạo bộ câu hỏi mới'}</h2>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-small" onClick={triggerImportFile}>
                Nhập JSON
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={handleExportTemplate}>
                Tải file mẫu JSON
              </button>
            </div>
          </div>

          <div className="notice notice-info" role="status">
            <strong>Bộ khảo sát dùng chung:</strong> Cả V1 (Standard AI Output) và V2 (Accessible AI Output) cùng trả lời bộ câu hỏi này. Không cần tạo câu hỏi riêng cho từng phiên bản.
          </div>
          <p className="help">
            Bước 1: đặt tên. Bước 2: điền {QUESTIONS_PER_TEST} câu bên dưới (5 câu mỗi trang). Bước 3: lưu nháp để làm tiếp sau, hoặc “Lưu và xuất bản” khi đã đủ.
          </p>

          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Tên bộ câu hỏi</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ví dụ: Bộ câu hỏi bài 1" />
            </label>
            <label className="field">
              <span>Giai đoạn</span>
              <select value={phase} onChange={(e) => setPhase(e.target.value as StudyPhase)} disabled={editingId !== null}>
                <option value="MAIN">MAIN</option>
                <option value="PILOT">PILOT</option>
              </select>
            </label>
          </div>

          <div aria-live="polite">
            <p style={{ margin: '0 0 6px' }}>
              <strong>Đã hoàn thành {done}/{QUESTIONS_PER_TEST} câu</strong>
            </p>
            <div style={{ height: 8, borderRadius: 4, background: 'rgba(128,128,128,0.25)', overflow: 'hidden' }}>
              <div style={{ width: `${(done / QUESTIONS_PER_TEST) * 100}%`, height: '100%', background: '#2f855a' }} />
            </div>
          </div>

          {/* Pagination Controls - Top */}
          <div
            className="row space-between"
            style={{
              alignItems: 'center',
              padding: '8px 12px',
              background: 'rgb(243 247 252 / 0.75)',
              borderRadius: 10,
              border: '1px solid rgb(172 195 222 / 0.35)',
              marginTop: 10
            }}
          >
            <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
              Câu {startIndex + 1}–{endIndex} của {slots.length}
            </span>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Trang trước
              </button>
              {Array.from({ length: totalPages }, (_, p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn btn-small ${page === p ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ minWidth: 32, fontWeight: page === p ? 750 : 500 }}
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Trang sau →
              </button>
            </div>
          </div>

          {/* Current Page Question Slots */}
          {pageSlots.map((q, i) => {
            const number = startIndex + i + 1;
            const currentCategory = q.category ?? 'CONCEPTUAL';
            const prevCategory = i > 0 ? pageSlots[i - 1]?.category : null;
            const showCategoryHeader = i === 0 || currentCategory !== prevCategory;
            const categoryIndex = QUESTION_CATEGORIES.indexOf(currentCategory);
            const groupCount = slots.filter((x) => x.category === currentCategory && isDone(x)).length;

            return (
              <div className="stack" key={q.id}>
                {showCategoryHeader && (
                  <div style={{ marginTop: i > 0 ? 16 : 6 }}>
                    <h3 style={{ margin: 0 }}>
                      Nhóm {categoryIndex + 1}/{QUESTION_CATEGORIES.length}: {CATEGORY_INFO[currentCategory].label} · {groupCount}/{QUESTIONS_PER_CATEGORY} câu
                    </h3>
                    <p className="help" style={{ margin: 0 }}>
                      {CATEGORY_INFO[currentCategory].hint}
                    </p>
                  </div>
                )}
                <fieldset className="card">
                  <legend>
                    <strong>Câu {number}</strong> {isDone(q) ? <span className="badge">Đã đủ</span> : <span className="help">· còn thiếu</span>}
                  </legend>
                  <label className="field">
                    <span>Nội dung câu hỏi</span>
                    <textarea
                      value={q.prompt}
                      onChange={(e) => patch(q.id, (x) => ({ ...x, prompt: e.target.value }))}
                    />
                  </label>
                  <p className="help" style={{ margin: '12px 0 4px' }}>
                    Điền 4 lựa chọn và chọn nút tròn ở đáp án đúng (mặc định là A).
                  </p>
                  <div className="stack">
                    {q.options.map((o, oi) => (
                      <div className="row" key={o.id}>
                        <input
                          aria-label={`Chọn lựa chọn ${LETTERS[oi]} là đáp án đúng của câu ${number}`}
                          type="radio"
                          name={`correct-${q.id}`}
                          checked={o.isCorrect}
                          onChange={() =>
                            patch(q.id, (x) => ({
                              ...x,
                              options: x.options.map((p, j) => ({ ...p, isCorrect: j === oi }))
                            }))
                          }
                        />
                        <label className="field" style={{ flex: 1 }}>
                          <span>
                            Lựa chọn {LETTERS[oi]}
                            {o.isCorrect ? ' (đáp án đúng)' : ''}
                          </span>
                          <input
                            value={o.text}
                            onChange={(e) =>
                              patch(q.id, (x) => ({
                                ...x,
                                options: x.options.map((p, j) => (j === oi ? { ...p, text: e.target.value } : p))
                              }))
                            }
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              </div>
            );
          })}

          {/* Pagination Controls - Bottom */}
          <div
            className="row space-between"
            style={{
              alignItems: 'center',
              padding: '8px 12px',
              background: 'rgb(243 247 252 / 0.75)',
              borderRadius: 10,
              border: '1px solid rgb(172 195 222 / 0.35)',
              margin: '8px 0'
            }}
          >
            <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
              Câu {startIndex + 1}–{endIndex} của {slots.length}
            </span>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Trang trước
              </button>
              {Array.from({ length: totalPages }, (_, p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn btn-small ${page === p ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ minWidth: 32, fontWeight: page === p ? 750 : 500 }}
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Trang sau →
              </button>
            </div>
          </div>

          {!complete ? (
            <p className="help">
              Chưa thể xuất bản: {[...(label.trim() ? [] : ['Chưa đặt tên bộ câu hỏi.']), ...blockers].slice(0, 4).join(' ')}
              {blockers.length > 3 ? ' …' : ''}
            </p>
          ) : (
            <p className="help">Đã đủ điều kiện xuất bản.</p>
          )}

          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => save(false)} disabled={busy || !label.trim()}>
              Lưu nháp
            </button>
            <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={busy || !complete}>
              Lưu và xuất bản
            </button>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              Đóng
            </button>
          </div>
        </section>
      ) : null}

      {message ? <p className="error" role="alert">{message}</p> : null}

      {/* List of existing question sets */}
      {items.map((item) => {
        const itemBlockers = item.status === 'DRAFT' ? questionSetBlockers(item.questions) : [];
        const itemDone = item.questions.filter(isDone).length;
        const isOld = item.questions.length !== QUESTIONS_PER_TEST;
        return (
          <section className="card stack" key={item._id}>
            <div className="space-between">
              <div>
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <h2 style={{ margin: 0 }}>Phiên bản {item.revision}: {item.label}</h2>
                  <span className="badge">Dùng chung V1 & V2</span>
                  {item.status === 'PUBLISHED' ? (
                    <span className="badge" style={{ background: '#2f855a', color: '#fff' }}>
                      Đã xuất bản
                    </span>
                  ) : (
                    <span className="badge">Bản nháp</span>
                  )}
                </div>
                <p className="help">
                  {item.phase} · {item.archivedAt ? 'Đã lưu trữ · ' : ''}
                  {isOld && item.status === 'PUBLISHED'
                    ? `${item.questions.length} câu (bộ cũ, không dùng cho lượt nghiên cứu mới)`
                    : `${itemDone}/${QUESTIONS_PER_TEST} câu đã hoàn thành`}
                </p>
              </div>
              {canEdit ? (
                <div className="row">
                  <button className="btn btn-secondary" onClick={() => edit(item)} disabled={busy}>
                    {item.status === 'DRAFT' ? 'Sửa' : 'Sửa câu hỏi'}
                  </button>
                  {item.status === 'DRAFT' ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => publish(item._id)}
                      disabled={busy || itemBlockers.length > 0}
                      title={itemBlockers.join('\n') || undefined}
                    >
                      Xuất bản
                    </button>
                  ) : null}
                  {!item.archivedAt ? (
                    <button className="btn btn-secondary" onClick={() => archive(item._id)} disabled={busy}>
                      Lưu trữ
                    </button>
                  ) : null}
                  <button className="btn btn-danger" onClick={() => remove(item._id)} disabled={busy}>
                    Xóa
                  </button>
                </div>
              ) : null}
            </div>
            {itemBlockers.length > 0 ? (
              <p className="help">
                Chưa thể xuất bản: {itemBlockers.slice(0, 3).join(' ')}
                {itemBlockers.length > 3 ? ' … Bấm “Sửa” để hoàn thiện.' : ' Bấm “Sửa” để hoàn thiện.'}
              </p>
            ) : null}
            <details>
              <summary>Xem nội dung</summary>
              <ol>
                {item.questions.map((q) => (
                  <li key={q.id}>
                    <p>
                      <strong>{q.prompt || '(chưa có nội dung)'}</strong>{' '}
                      {q.category ? <em>({CATEGORY_INFO[q.category].label})</em> : null}
                    </p>
                    <ul>
                      {q.options.map((o) => (
                        <li key={o.id}>
                          {o.text || '(trống)'} {o.isCorrect ? <strong>(đáp án đúng)</strong> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </details>
          </section>
        );
      })}
    </div>
  );
}
