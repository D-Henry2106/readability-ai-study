import { Progress } from './Progress';
import { WithdrawButton } from './WithdrawButton';

export function ParticipantShell({
  step,
  title,
  children,
  allowWithdraw = true,
  wide = false
}: { 
  step: number;
  title: string;
  children: React.ReactNode;
  allowWithdraw?: boolean;
  wide?: boolean;
}) {
  return (
    <main className={`${wide ? 'reading-container' : 'narrow'} participant-shell`}>
      <header className="participant-topbar">
        <div className="participant-brand">
          <span className="brand-mark" aria-hidden="true">
            RS
          </span>
          <span>Nghiên cứu đọc hiểu</span>
        </div>

        {allowWithdraw ? (
          <div className="participant-withdraw">
            <WithdrawButton />
          </div>
        ) : null}
      </header>

      <div className="participant-layout stack">
        <Progress step={step} />

        <section className="card participant-card stack">
          <header className="participant-heading">
            <h1 className="participant-title">{title}</h1>
          </header>

          {children}
        </section>
      </div>
    </main>
  );
}
