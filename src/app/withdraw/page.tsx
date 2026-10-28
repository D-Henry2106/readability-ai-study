import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Rút lui', robots: { index: false, follow: false } };
export default function Page() { return <main className="narrow" style={{ paddingBlock: 56 }}><section className="card stack"><h1>Bạn đã rút khỏi nghiên cứu</h1><p>Bạn không cần nêu lý do. Phiên nghiên cứu đã kết thúc.</p></section></main>; }
