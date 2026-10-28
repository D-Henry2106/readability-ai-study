import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Nghiên cứu đọc hiểu', template: '%s | Nghiên cứu đọc hiểu' },
  description: 'Nền tảng nghiên cứu đọc hiểu trực tuyến có kiểm soát.',
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body><div className="site-shell">{children}</div></body>
    </html>
  );
}
