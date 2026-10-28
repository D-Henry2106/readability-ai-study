import Link from 'next/link';
import type { Metadata } from 'next';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ReadinessService } from '@/lib/services/readiness.service';
import { AnalysisService } from '@/lib/services/analysis.service';
export const metadata: Metadata={title:'Tổng quan nghiên cứu',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{phase?:string}>}){
 const q=await searchParams;const repo=new ResearchRepository(); const activeConfig=await repo.getConfig(); const phase=q.phase==='PILOT'||q.phase==='MAIN'?q.phase:activeConfig.phase;
 const [config,ready,counts,published,analysis]=await Promise.all([repo.getConfig(),new ReadinessService(repo).check(),repo.dashboardCounts(phase),repo.countPublishedPackages(phase),new AnalysisService(repo).overview(phase)]);
 const progress=Math.min(100,Math.round(counts.valid/Math.max(1,config.minimumValidTarget)*100));
 return <div className="stack"><div className="space-between"><div><h1>Tổng quan nghiên cứu</h1><p className="help">Theo dõi trạng thái và dữ liệu thực tế, không sử dụng số liệu giả.</p></div><span className="badge">{ready.ready?'Sẵn sàng':'Chưa sẵn sàng'}</span></div>
 <form className="row card"><label className="field">Giai đoạn dữ liệu đang xem<select name="phase" defaultValue={phase}><option value="MAIN">MAIN — Chính thức</option><option value="PILOT">PILOT — Thử nghiệm</option></select></label><button className="btn btn-secondary">Áp dụng</button></form>
 <p className="help">Giai đoạn cấu hình: <strong>{config.phase}</strong> · Dữ liệu đang xem: <strong>{phase}</strong></p><section className="metric-grid">{([['Phiên bắt đầu',counts.started],['Đã đồng ý',counts.consented],['Đã hoàn thành',counts.completed],['Chờ xét duyệt',counts.review],['Đã đánh giá VALID',counts.valid],['Không hợp lệ',counts.invalid],['Cặp hợp lệ',analysis.analysis.validPairs],['Bộ đã xuất bản',published],['Nhóm A',counts.groupA],['Nhóm B',counts.groupB],['Điểm TB V1',analysis.analysis.v1.mean?.toFixed(2)??'—'],['Điểm TB V2',analysis.analysis.v2.mean?.toFixed(2)??'—']] as Array<[string,string|number]>).map(([label,n])=><div className="metric" key={label}><span className="help">{label}</span><strong>{n}</strong></div>)}</section>
 <section className="card stack"><div className="space-between"><h2>Kiểm tra điều kiện mở nghiên cứu</h2><Link href="/admin/config">Cấu hình nghiên cứu →</Link></div><ul className="readiness-list">{ready.checks.map(check=><li key={check.code}><strong>{check.status}</strong> · {check.label} · {check.status === 'PASS' ? 'Đã đạt' : check.detail} · <Link href={check.href}>Đi tới trang sửa</Link></li>)}</ul></section>
 <section className="card stack"><h2>Tiến độ tuyển người tham gia</h2><p>{counts.valid} phiên được đánh dấu hợp lệ / mục tiêu {config.minimumValidTarget}</p><div className="progress"><span style={{width:`${progress}%`}}/></div><p className="help">Các giá trị hiển thị theo giai đoạn {phase}; điểm trung bình không gộp các phiên bản khác nhau.</p></section></div>;
}
