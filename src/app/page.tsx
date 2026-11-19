import Link from 'next/link';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';

/**
 * Public page. Participants join only through the personal link they were sent (/i/...), so this page has no
 * "start" button. It only helps someone who already began (continue) or already finished (status).
 */
export default async function HomePage() {
  const id = await getParticipantSessionId();
  let resume: string | null = null;
  let terminal: 'COMPLETED' | 'DECLINED' | 'WITHDRAWN' | 'INCOMPLETE' | null = null;

  if (id) {
    const repo = new ResearchRepository();
    const session = await repo.getSession(id).catch(() => null);
    if (session?.status === 'ACTIVE') resume = new ExperimentStateService(repo).routeFor(session);
    else if (session?.status === 'COMPLETED') terminal = 'COMPLETED';
    else if (session?.status === 'DECLINED' || session?.status === 'WITHDRAWN' || session?.status === 'INCOMPLETE') terminal = session.status;
  }

  return (
    <main className="narrow home-page">
      <article className="card home-study stack">
        <header className="home-header stack-sm">
          <h1 className="home-title">Nghiên cứu về cách trình bày bài đọc trên web</h1>
          <p className="home-lead">
            Bạn sẽ đọc một bài ngắn, rồi trả lời các câu hỏi đọc hiểu. Toàn bộ mất khoảng 10 phút.
          </p>
        </header>

        <section className="study-overview stack-sm">
          <h2>Bạn sẽ làm gì</h2>
          <ul className="study-overview-list">
            <li className="study-overview-item">
              <strong>Đọc thông tin</strong>
              <span>Bạn đọc thông tin nghiên cứu và tự quyết định có tham gia hay không.</span>
            </li>
            <li className="study-overview-item">
              <strong>Đọc một bài</strong>
              <span>Bạn đọc một bài, không bị ngắt quãng.</span>
            </li>
            <li className="study-overview-item">
              <strong>Trả lời câu hỏi</strong>
              <span>Sau khi đọc xong, bạn trả lời các câu hỏi về bài vừa đọc.</span>
            </li>
          </ul>
        </section>

        <section className="home-action stack-sm">
          {terminal ? (
            <>
              <h2>Phiên của bạn đã kết thúc</h2>
              <div className="notice" role="status">
                <p>
                  {terminal === 'COMPLETED'
                    ? 'Bạn đã hoàn thành nghiên cứu. Cảm ơn bạn đã tham gia.'
                    : 'Phiên của bạn đã kết thúc. Nếu cần hỗ trợ, hãy liên hệ nhà nghiên cứu.'}
                </p>
                {terminal === 'COMPLETED' ? <Link href="/complete">Xem lời cảm ơn</Link> : null}
              </div>
            </>
          ) : resume ? (
            <>
              <h2>Tiếp tục phiên của bạn</h2>
              <p className="home-action-copy">Bạn đã bắt đầu. Bấm nút bên dưới để quay lại đúng bước đang làm.</p>
              <Link className="btn btn-primary" href={resume}>
                Tiếp tục
              </Link>
            </>
          ) : (
            <>
              <h2>Cách tham gia</h2>
              <div className="notice notice-info stack-sm">
                <strong>Bạn cần link riêng để tham gia.</strong>
                <span>
                  Nhà nghiên cứu gửi link này trực tiếp cho từng người. Hãy mở link đó để bắt đầu. Nếu chưa nhận được
                  link, hãy liên hệ nhà nghiên cứu.
                </span>
              </div>
            </>
          )}
        </section>
      </article>
    </main>
  );
}
