import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { BreakClient } from '@/components/participant/BreakClient';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
export const metadata: Metadata = { title: 'Nghỉ giải lao', robots: { index: false, follow: false } };
export default async function Page() {
  await requireParticipantPage('BREAK');
  return (
    <ParticipantShell step={6} title="Thời gian nghỉ bắt buộc">
      <BreakClient />
    </ParticipantShell>
  );
}
