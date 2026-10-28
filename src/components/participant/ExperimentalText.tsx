import { accessibleVisualBlocks } from '@/lib/experiment/presentation';

export function ExperimentalText({ rawContent, presentation }: { rawContent: string; presentation: 'V1' | 'V2' }) {
  if (presentation === 'V1') {
    return <div className="experimental-text reader-v1">{rawContent}</div>;
  }

  const blocks = accessibleVisualBlocks(rawContent);
  return (
    <div className="experimental-text reader-v2">
      {blocks.map((block, index) => (
        <span className="accessible-block" key={`${index}-${block.length}`}>{block}</span>
      ))}
    </div>
  );
}
