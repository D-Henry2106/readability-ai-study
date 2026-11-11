import { accessibleVisualBlocks } from '@/lib/experiment/presentation';
import { buildV2VisualBlocks } from '@/lib/study-run/presentation-blocks';
import type { PresentationEmphasisSpan } from '@/types/presentation-profile';

export function ExperimentalText({
  rawContent,
  presentation,
  emphasis,
  sentencesPerBlock
}: {
  rawContent: string;
  presentation: 'V1' | 'V2';
  emphasis?: readonly PresentationEmphasisSpan[];
  sentencesPerBlock?: number;
}) {
  if (presentation === 'V1') {
    return <div className="experimental-text reader-v1">{rawContent}</div>;
  }

  if (!emphasis || emphasis.length === 0) {
    const blocks = accessibleVisualBlocks(rawContent, sentencesPerBlock);
    return (
      <div className="experimental-text reader-v2">
        {blocks.map((block, index) => (
          <span className="accessible-block" key={`${index}-${block.length}`}>{block}</span>
        ))}
      </div>
    );
  }

  const blocks = buildV2VisualBlocks(rawContent, { emphasis, sentencesPerBlock });
  return (
    <div className="experimental-text reader-v2">
      {blocks.map((block) => (
        <span className="accessible-block" key={`${block.index}-${block.text.length}`}>
          {block.segments.map((seg) =>
            seg.emphasized ? <strong key={`${seg.start}-${seg.end}`}>{seg.text}</strong> : seg.text
          )}
        </span>
      ))}
    </div>
  );
}
