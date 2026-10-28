'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogoutButton } from './LogoutButton';
const sections=[
 {title:'Tổng quan',links:[['/admin','Tổng quan']]},
 {title:'Quản lý nghiên cứu',links:[['/admin/config','Cấu hình nghiên cứu'],['/admin/content','Bộ nội dung thực nghiệm'],['/admin/sessions','Phiên tham gia'],['/admin/questions','Bộ câu hỏi (cũ)']]},
 {title:'Dữ liệu và phân tích',links:[['/admin/statistics','Thống kê'],['/admin/exports','Xuất dữ liệu']]}
];
export function AdminSidebar({ username,role }: {username:string;role:string}) {
 const pathname=usePathname();const [open,setOpen]=useState(false);
 return <><div className="admin-mobile-top"><strong>Quản trị nghiên cứu</strong><button type="button" className="btn btn-secondary" aria-controls="admin-side" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{open?'Đóng menu':'☰ Menu'}</button></div>
 {open&&<button className="admin-overlay" onClick={()=>setOpen(false)} aria-label="Đóng menu điều hướng" />}
 <aside id="admin-side" className={`admin-side ${open?'admin-side-open':''}`}><div className="admin-side-brand"><span className="brand-mark" aria-hidden="true">CRP</span><strong>Quản lý nghiên cứu</strong></div>
 <nav aria-label="Điều hướng quản trị">{sections.map(section=><div className="admin-nav-group" key={section.title}><p>{section.title}</p>{section.links.map(([href,label])=><Link key={href} href={href} onClick={()=>setOpen(false)} className={`admin-nav-link ${pathname===href?'is-active':''}`} aria-current={pathname===href?'page':undefined}>{label}</Link>)}</div>)}</nav>
 <div className="admin-side-footer"><p className="help">Tài khoản: {username} · {role==='RESEARCHER'?'Nhà nghiên cứu':'Người giám sát'}</p><LogoutButton/></div></aside></>;
}
