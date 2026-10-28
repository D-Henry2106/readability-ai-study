import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { InformationContinue } from '@/components/participant/InformationContinue';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { ResearchRepository } from '@/lib/repositories/research.repository';

export const metadata: Metadata = {
  title: 'Thông tin dành cho người tham gia',
  robots: { index: false, follow: false }
};

function ProtocolText({ text }: { text: string }) {
  const sections = text.split(/\r?\n(?:[ \t]*\r?\n)+/);

  return (
    <div className="protocol-text">
      {sections.map((section, index) => (
        <p className="protocol-section" key={index}>
          {section}
        </p>
      ))}
    </div>
  );
}

export default async function Page() {
  const session = await requireParticipantPage('INFORMATION');

  const config = session.informationTextSnapshot
    ? null
    : await new ResearchRepository().getConfig();

  const informationText =
    session.informationTextSnapshot ?? config?.informationText ?? '';

  return (
    <ParticipantShell step={1} title="Thông tin dành cho người tham gia">
      <div className="information-content">
        <ProtocolText text={informationText} />
      </div>

      <InformationContinue />
    </ParticipantShell>
  );
}