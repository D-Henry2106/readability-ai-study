import Link from 'next/link';
import { StartButton } from '@/components/participant/StartButton';
import { PilotRestartButton } from '@/components/participant/PilotRestartButton';
import { ReadinessService } from '@/lib/services/readiness.service';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';

export default async function HomePage() {
  const readiness = await new ReadinessService()
    .check()
    .catch(() => ({
      ready: false,
      missing: ['DATABASE_OR_CONFIGURATION_UNAVAILABLE'],
      checks: []
    }));

  const id = await getParticipantSessionId();
  let resume: string | null = null;
  let terminal: 'COMPLETED' | 'DECLINED' | 'WITHDRAWN' | 'INCOMPLETE' | null = null;
  let pilotCanRestart = false;

  if (id) {
    const repo = new ResearchRepository();
    const session = await repo.getSession(id).catch(() => null);

    if (session?.status === 'ACTIVE') resume = new ExperimentStateService(repo).routeFor(session);
    else if (session?.status) { terminal = session.status === 'COMPLETED' ? 'COMPLETED' : session.status === 'DECLINED' || session.status === 'WITHDRAWN' || session.status === 'INCOMPLETE' ? session.status : null;
      if (terminal && session.phase === 'PILOT') { const cfg = await repo.getConfig(); pilotCanRestart = cfg.phase === 'PILOT' && cfg.studyPublished === true && cfg.allowPilotRetakes === true && !session.pilotRestartedAt && terminal !== 'INCOMPLETE'; }
    }
  }

  return (
    <main className="narrow home-page">
      <article className="card home-study stack">
        <header className="home-header stack-sm">
          <p className="home-kicker">Nghiên cứu khoa học</p>

          <h1 className="home-title">
            Trình bày nội dung web dễ tiếp cận và khả năng đọc hiểu
          </h1>

          <p className="home-lead">
            Nghiên cứu này tìm hiểu ảnh hưởng của cách trình bày nội dung web đến khả năng đọc hiểu
            thông qua hoạt động đọc và trả lời câu hỏi trực tuyến.
          </p>
        </header>

        <section className="study-overview stack-sm">
          <h2>Thông tin tổng quan</h2>

          <ul className="study-overview-list">
            <li className="study-overview-item">
              <strong>Thông tin trước khi tham gia</strong>
              <span>
                Bạn sẽ được đọc thông tin nghiên cứu trước khi quyết định
                có đồng ý tham gia hay không.
              </span>
            </li>

            <li className="study-overview-item">
              <strong>Hai lượt đọc</strong>
              <span>
                Nghiên cứu có hai lượt đọc với thời gian nghỉ bắt buộc
                ở giữa.
              </span>
            </li>

            <li className="study-overview-item">
              <strong>Câu hỏi đọc hiểu</strong>
              <span>
                Sau mỗi lượt đọc là năm câu hỏi kiểm tra đọc hiểu.
              </span>
            </li>
          </ul>
        </section>

        <section className="home-action stack-sm">
          <h2>
            {terminal
              ? 'Trạng thái tham gia của bạn'
              : resume
              ? 'Tiếp tục phiên nghiên cứu'
              : readiness.ready
                ? 'Tham gia nghiên cứu'
                : 'Trạng thái nghiên cứu'}
          </h2>

          {terminal ? (
            <div className="notice" role="status"><p>{terminal === 'COMPLETED' ? 'Bạn đã hoàn thành nghiên cứu. Phiên này không được tạo lại tự động.' : 'Phiên trước đã kết thúc. Vui lòng liên hệ nhà nghiên cứu nếu cần hỗ trợ theo chính sách tham gia.'}</p>{terminal === 'COMPLETED' ? <Link href="/complete">Xem phần hoàn thành</Link> : null}{pilotCanRestart ? <PilotRestartButton /> : null}</div>
          ) : resume ? (
            <>
              <p className="home-action-copy">
                Phiên nghiên cứu đã được tạo. Hãy tiếp tục từ
                bước hiện tại.
              </p>

              <Link className="btn btn-primary" href={resume}>
                Tiếp tục phiên hiện tại
              </Link>
            </>
          ) : readiness.ready ? (
            <>
              <p className="home-action-copy">
                Trước hết, bạn sẽ đọc bản thông tin dành cho người tham gia.
              </p>

              <StartButton />
            </>
          ) : (
            <div className="notice notice-warning stack-sm">
              <strong>Nghiên cứu hiện chưa mở.</strong>
              <span>Vui lòng quay lại sau khi người nghiên cứu hoàn tất và công bố tài liệu đã phê duyệt.</span>
            </div>
          )}
        </section>
      </article>
    </main>
  );
}