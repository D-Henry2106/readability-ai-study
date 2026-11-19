import type { Metadata } from 'next';
import { InvitationEntry } from '@/components/participant/InvitationEntry';

// Static page: no database access and no side effects on GET. The invitation token lives only in the URL fragment,
// which the browser never sends to the server; InvitationEntry reads it and removes it from the address bar.
export const metadata: Metadata = {
  title: 'Lời mời tham gia nghiên cứu',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

export default function InvitationPage() {
  return (
    <main className="narrow">
      <article className="card stack">
        <header className="stack-sm">
          <p className="home-kicker">Nghiên cứu khoa học</p>
          <h1 className="home-title">Lời mời tham gia nghiên cứu</h1>
          <p className="home-lead">
            Bạn đã nhận được liên kết mời từ nhà nghiên cứu. Trước hết, bạn sẽ đọc bản thông tin dành cho người tham gia
            và tự quyết định có đồng ý tham gia hay không.
          </p>
        </header>
        <InvitationEntry />
      </article>
    </main>
  );
}
