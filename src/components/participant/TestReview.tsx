'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TestReview({ roundNo }: { roundNo: 1 | 2 }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function begin() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/test/review', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? 'Không thể tiếp tục đến câu hỏi.');
        return;
      }
      router.push('/experiment/test');
    } catch {
      setError('Không thể tiếp tục. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-screen stack">
      <div className="review-success" aria-hidden="true">
        <span>✓</span>
      </div>
      <div className="review-intro stack-sm">
        <span className="badge badge-success">Lượt đọc {roundNo} hoàn thành</span>
        <h2>Bạn đã sẵn sàng trả lời câu hỏi đọc hiểu?</h2>
        <p className="help review-lead">Vui lòng đọc hướng dẫn trước khi bắt đầu.</p>
      </div>

      <div className="review-grid" aria-label="Hướng dẫn trả lời câu hỏi">
        <article className="review-item">
          <span className="review-number">01</span>
          <div><strong>Năm câu hỏi</strong><p>Trả lời năm câu hỏi dựa trên nội dung vừa đọc.</p></div>
        </article>
        <article className="review-item">
          <span className="review-number">02</span>
          <div><strong>Sử dụng kiến thức đã hiểu</strong><p>Bài đọc sẽ không hiển thị khi làm câu hỏi. Chọn phương án phù hợp nhất với những gì bạn hiểu.</p></div>
        </article>
        <article className="review-item">
          <span className="review-number">03</span>
          <div><strong>Chưa hiển thị điểm</strong><p>Đáp án và điểm được ẩn trong thời gian nghiên cứu để tránh ảnh hưởng đến lượt sau.</p></div>
        </article>
        <article className="review-item">
          <span className="review-number">04</span>
          <div><strong>Nộp bài khi hoàn tất</strong><p>Bạn có thể để trống câu hỏi; hãy kiểm tra kỹ trước khi nộp.</p></div>
        </article>
      </div>

      <div className="review-action stack-sm">
        <button className="btn btn-primary review-start" type="button" onClick={begin} disabled={busy}>
          {busy ? 'Đang chuẩn bị câu hỏi…' : 'Bắt đầu trả lời'}
        </button>
        <p className="help">Khi bắt đầu, hệ thống sẽ chuyển sang bước tiếp theo do máy chủ kiểm soát.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
