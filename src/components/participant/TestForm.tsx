'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Question = { id: string; prompt: string; options: Array<{ id: string; text: string }> };

export function TestForm({ questions }: { questions: Question[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timerReady, setTimerReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetch('/api/test/start', { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Không thể ghi nhận thời điểm bắt đầu câu hỏi.');
        if (active) setTimerReady(true);
      })
      .catch(() => { if (active) setError('Không thể bắt đầu thời gian làm bài. Kiểm tra kết nối và tải lại trang.'); });
    return () => { active = false; };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const answers = questions.map((q) => ({ questionId: q.id, selectedOptionId: form.get(q.id) ? String(form.get(q.id)) : null }));
    const unanswered = answers.filter((a) => a.selectedOptionId === null).length;
    if (unanswered > 0 && !window.confirm(`Bạn còn ${unanswered} câu chưa trả lời. Có thể quay lại hoặc nộp bài.`)) return;

    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/test/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Không thể nộp bài. Các lựa chọn vẫn được giữ trên trang.');
        return;
      }
      router.push(d.nextRoute ?? '/');
    } catch {
      setError('Kết nối gián đoạn. Các lựa chọn vẫn được giữ, hãy thử nộp lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {questions.map((q, i) => (
        <fieldset key={q.id} className="card question-card">
          <legend><strong>{i + 1}. {q.prompt}</strong></legend>
          <div className="choice-list">
            {q.options.map((o) => (
              <label key={o.id} className="choice-option">
                <input type="radio" name={q.id} value={o.id} />
                <span>{o.text}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button className="btn btn-primary" disabled={busy || !timerReady}>{busy ? 'Đang nộp…' : timerReady ? 'Nộp câu trả lời' : 'Đang kết nối máy chủ…'}</button>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </form>
  );
}
