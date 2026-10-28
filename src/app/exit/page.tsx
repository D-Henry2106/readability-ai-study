import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Rời nghiên cứu', robots: { index: false, follow: false } };
export default function Page() { return <main className="narrow" style={{ paddingBlock: 56 }}><section className="card stack"><h1>Đã rời nghiên cứu</h1><p>Bạn đã dừng việc tham gia nghiên cứu.</p></section></main>; }
