'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogoutButton } from './LogoutButton';
import { UiIcon, type UiIconName } from './UiIcon';

interface NavLink {
  href: string;
  label: string;
  icon: UiIconName;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

const sections: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    links: [
      { href: '/admin', label: 'Bảng điều khiển', icon: 'layers' }
    ]
  },
  {
    title: 'QUẢN LÝ NỘI DUNG',
    links: [
      { href: '/admin/questions', label: 'Bộ câu hỏi (15 câu)', icon: 'list' },
      { href: '/admin/content', label: 'Bộ nội dung (V1/V2)', icon: 'book' }
    ]
  },
  {
    title: 'VẬN HÀNH NGHIÊN CỨU',
    links: [
      { href: '/admin/study-runs', label: 'Study Runs', icon: 'play' },
      { href: '/admin/invitations', label: 'Lời mời / Invitations', icon: 'mail' },
      { href: '/admin/sessions', label: 'Người tham gia & Phiên', icon: 'users' },
      { href: '/admin/statistics', label: 'Thống kê kết quả', icon: 'barChart' },
      { href: '/admin/exports', label: 'Xuất dữ liệu nghiên cứu', icon: 'download' }
    ]
  },
  {
    title: 'HỆ THỐNG',
    links: [
      { href: '/admin/config', label: 'Cấu hình nghiên cứu', icon: 'settings' }
    ]
  }
];

export function AdminSidebar({ username, role }: { username: string; role: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="admin-mobile-top">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="brand-mark" aria-hidden="true">CRP</span>
          <strong>Quản trị nghiên cứu</strong>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          aria-controls="admin-side"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Đóng menu' : '☰ Menu'}
        </button>
      </div>

      {open && (
        <button
          className="admin-overlay"
          onClick={() => setOpen(false)}
          aria-label="Đóng menu điều hướng"
        />
      )}

      <aside id="admin-side" className={`admin-side ${open ? 'admin-side-open' : ''}`}>
        <div className="admin-side-brand">
          <span className="brand-mark" aria-hidden="true">CRP</span>
          <div>
            <strong>Quản lý nghiên cứu</strong>
            <small style={{ display: 'block', color: 'var(--text-muted, #718096)', fontSize: '0.75rem' }}>
              Readability Study Panel
            </small>
          </div>
        </div>

        <nav aria-label="Điều hướng quản trị" className="admin-nav-scroll">
          {sections.map((section) => (
            <div className="admin-nav-group" key={section.title}>
              <p className="admin-nav-heading">{section.title}</p>
              {section.links.map((link) => {
                const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`admin-nav-link ${isActive ? 'is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <UiIcon name={link.icon} width={16} height={16} />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="admin-side-footer">
          <div className="admin-user-info">
            <span className="admin-user-avatar">{username.slice(0, 2).toUpperCase()}</span>
            <div className="admin-user-details">
              <strong>{username}</strong>
              <small>{role === 'RESEARCHER' ? 'Nhà nghiên cứu' : 'Người giám sát'}</small>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}
