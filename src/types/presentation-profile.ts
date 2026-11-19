import type { ObjectId } from 'mongodb';

export type PresentationProfileStatus = 'DRAFT' | 'CONFIRMED' | 'LOCKED';

/**
 * Manual emphasis span (architecture §5, §6.6, AC-13).
 * Offsets are 0-based UTF-16 code-unit indices in `rawContent`: `rawContent.slice(start, end) === text`.
 */
export interface PresentationEmphasisSpan {
  start: number;
  end: number;
  text: string;
}

export interface PresentationProfileSegmentation {
  mode: 'SENTENCE_BLOCKS';
  sentencesPerBlock: number;
}

export interface PresentationProfileStyle {
  preset: 'READER_V2_ACCESSIBLE';
}

/**
 * Presentation profile for V2 (architecture §5, D7, AC-11..AC-14).
 * Once `LOCKED` (when the first invitation of a Study Run using this profile is issued), every edit returns 409;
 * changing emphasis requires creating a new profile version and a new Study Run.
 */
export interface PresentationProfileDoc {
  _id?: ObjectId;
  contentRevisionId: ObjectId;
  contentHash: string;
  variant: 'V2';
  version: number;
  status: PresentationProfileStatus;
  segmentation: PresentationProfileSegmentation;
  style: PresentationProfileStyle;
  emphasis: PresentationEmphasisSpan[];
  /**
   * Edit revision of `emphasis`/`segmentation`/`style`: starts at 1 and is incremented by every edit.
   * Preview and confirmation are compare-and-set on it, so a Preview can never vouch for content it did not render (AC-14).
   */
  editRevision: number;
  /** Set when an Admin previews the current draft; reset to null whenever the profile is edited (AC-14). */
  previewedBy: string | null;
  previewedAt: Date | null;
  /** The `editRevision` that was actually rendered by the Preview; the profile can only be confirmed while it equals `editRevision`. */
  previewedRevision: number | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  lockedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
