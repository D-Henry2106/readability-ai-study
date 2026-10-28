export function Progress({ step, total = 9 }: { step: number; total?: number }) {
  const safeTotal = Math.max(1, total);
  const safeStep = Math.max(1, Math.min(step, safeTotal));
  const percent = (safeStep / safeTotal) * 100;

  return (
    <div
      aria-label={`Bước ${safeStep} / ${safeTotal}`}
      className="progress-shell stack-sm"
    >
      <div className="space-between">
        <strong>
          Bước {safeStep} / {safeTotal}
        </strong>
        <span className="help">Tiến độ nghiên cứu</span>
      </div>

      <div
        className="progress"
        role="progressbar"
        aria-label="Tiến độ nghiên cứu"
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-valuenow={safeStep}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}