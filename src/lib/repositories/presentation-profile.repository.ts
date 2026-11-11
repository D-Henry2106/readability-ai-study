import type { ObjectId } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { ensureIndexes } from '@/lib/db/indexes';
import type {
  PresentationEmphasisSpan,
  PresentationProfileDoc,
  PresentationProfileSegmentation,
  PresentationProfileStyle
} from '@/types/presentation-profile';

export interface PresentationProfileDraftUpdate {
  emphasis: PresentationEmphasisSpan[];
  segmentation: PresentationProfileSegmentation;
  style: PresentationProfileStyle;
  updatedAt: Date;
}

/**
 * Admin-only persistence port for `presentation_profiles` (architecture §2.4, §5, §6.5, AC-14).
 * There is no general update method and no participant write method.
 * Once a profile is `LOCKED`, no repository operation can mutate it.
 */
export interface PresentationProfileStore {
  insert(doc: PresentationProfileDoc): Promise<ObjectId>;
  getById(id: ObjectId): Promise<PresentationProfileDoc | null>;
  getByContentAndVersion(contentRevisionId: ObjectId, version: number): Promise<PresentationProfileDoc | null>;
  listByContent(contentRevisionId: ObjectId): Promise<PresentationProfileDoc[]>;
  nextVersion(contentRevisionId: ObjectId): Promise<number>;
  /**
   * CAS: updates emphasis/segmentation/style ONLY when status is DRAFT or CONFIRMED (never LOCKED).
   * Increments `editRevision`, resets status to DRAFT and clears the preview/confirmation marks, so the edited profile
   * must be previewed and confirmed again.
   */
  updateIfEditable(id: ObjectId, update: PresentationProfileDraftUpdate): Promise<PresentationProfileDoc | null>;
  /**
   * CAS: records that the Admin previewed exactly `expectedRevision` (only while DRAFT or CONFIRMED, never LOCKED).
   * Returns null when the profile was edited since it was read (`editRevision` differs) or is LOCKED.
   */
  markPreviewedIfEditable(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null>;
  /**
   * CAS: transitions DRAFT/CONFIRMED -> CONFIRMED only when `expectedRevision` is still the current `editRevision` AND it is
   * the revision that was previewed. Returns null otherwise (edited since, never previewed, or LOCKED).
   */
  confirmIfPreviewed(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null>;
  /** CAS: transitions CONFIRMED -> LOCKED when the first invitation of a Study Run using this profile is issued. */
  lockIfConfirmed(id: ObjectId, at: Date): Promise<PresentationProfileDoc | null>;
}

export class PresentationProfileRepository implements PresentationProfileStore {
  async insert(doc: PresentationProfileDoc): Promise<ObjectId> {
    await ensureIndexes();
    const { presentationProfiles } = await collections();
    return (await presentationProfiles.insertOne(doc)).insertedId;
  }

  async getById(id: ObjectId): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOne({ _id: id });
  }

  async getByContentAndVersion(contentRevisionId: ObjectId, version: number): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOne({ contentRevisionId, version });
  }

  async listByContent(contentRevisionId: ObjectId): Promise<PresentationProfileDoc[]> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.find({ contentRevisionId }).sort({ version: -1 }).toArray();
  }

  async nextVersion(contentRevisionId: ObjectId): Promise<number> {
    const { presentationProfiles } = await collections();
    const latest = await presentationProfiles.find({ contentRevisionId }).sort({ version: -1 }).limit(1).next();
    return (latest?.version ?? 0) + 1;
  }

  async updateIfEditable(id: ObjectId, update: PresentationProfileDraftUpdate): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOneAndUpdate(
      { _id: id, status: { $in: ['DRAFT', 'CONFIRMED'] } },
      {
        $set: {
          emphasis: update.emphasis,
          segmentation: update.segmentation,
          style: update.style,
          status: 'DRAFT',
          previewedBy: null,
          previewedAt: null,
          previewedRevision: null,
          confirmedBy: null,
          confirmedAt: null,
          updatedAt: update.updatedAt
        },
        $inc: { editRevision: 1 }
      },
      { returnDocument: 'after' }
    );
  }

  async markPreviewedIfEditable(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOneAndUpdate(
      { _id: id, status: { $in: ['DRAFT', 'CONFIRMED'] }, editRevision: expectedRevision },
      { $set: { previewedBy: by, previewedAt: at, previewedRevision: expectedRevision, updatedAt: at } },
      { returnDocument: 'after' }
    );
  }

  async confirmIfPreviewed(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['DRAFT', 'CONFIRMED'] },
        editRevision: expectedRevision,
        previewedRevision: expectedRevision
      },
      { $set: { status: 'CONFIRMED', confirmedBy: by, confirmedAt: at, updatedAt: at } },
      { returnDocument: 'after' }
    );
  }

  async lockIfConfirmed(id: ObjectId, at: Date): Promise<PresentationProfileDoc | null> {
    const { presentationProfiles } = await collections();
    return presentationProfiles.findOneAndUpdate(
      { _id: id, status: 'CONFIRMED' },
      { $set: { status: 'LOCKED', lockedAt: at, updatedAt: at } },
      { returnDocument: 'after' }
    );
  }
}
