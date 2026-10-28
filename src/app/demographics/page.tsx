import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { DemographicsForm } from '@/components/participant/DemographicsForm';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
export const metadata: Metadata = { title: 'Thông tin chung', robots: { index: false, follow: false } };
export default async function Page() { await requireParticipantPage('DEMOGRAPHICS'); return <ParticipantShell step={3} title="Thông tin người tham gia"><p>Chỉ cung cấp thông tin chung dưới đây. Hệ thống không yêu cầu dữ liệu nhận diện trực tiếp.</p><DemographicsForm /></ParticipantShell>; }
