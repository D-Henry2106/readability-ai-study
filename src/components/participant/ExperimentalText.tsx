import { accessibleVisualBlocks } from '@/lib/experiment/presentation';
import { buildV2VisualBlocks } from '@/lib/study-run/presentation-blocks';
import { isHtml, sanitizeHtml, splitHtmlIntoBlocks } from '@/lib/sanitize-html';
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
  const contentIsHtml = isHtml(rawContent);

  if (presentation === 'V1') {
    if (contentIsHtml) {
      return (
        <div
          className="experimental-text reader-v1"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(rawContent) }}
        />
      );
    }
    return <div className="experimental-text reader-v1">{rawContent}</div>;
  }

  // V2 Presentation with study-run emphasis spans
  if (emphasis && emphasis.length > 0) {
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

  // V2 Presentation with rich text HTML content
  if (contentIsHtml) {
    const sanitized = sanitizeHtml(rawContent);
    const blocks = splitHtmlIntoBlocks(sanitized);
    return (
      <div className="experimental-text reader-v2">
        {blocks.map((block, index) => (
          <div
            className="accessible-block"
            key={`${index}`}
            dangerouslySetInnerHTML={{ __html: block }}
          />
        ))}
      </div>
    );
  }

  // V2 Presentation baseline plain text
  const blocks = accessibleVisualBlocks(rawContent, sentencesPerBlock);
  return (
    <div className="experimental-text reader-v2">
      {blocks.map((block, index) => (
        <span className="accessible-block" key={`${index}-${block.length}`}>{block}</span>
      ))}
    </div>
  );
}
