import { ObjectId } from 'mongodb';
import type {
  PresentationProfileDraftUpdate,
  PresentationProfileStore
} from '@/lib/repositories/presentation-profile.repository';
import type { PresentationProfileDoc } from '@/types/presentation-profile';

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

/**
 * In-memory PresentationProfileStore with the exact compare-and-set semantics of the MongoDB repository.
 * `writes` records every mutation operation for write-surface assertions.
 */
export class FakePresentationProfileStore implements PresentationProfileStore {
  readonly docs = new Map<string, PresentationProfileDoc>();
  readonly writes: string[] = [];

  async insert(doc: PresentationProfileDoc): Promise<ObjectId> {
    for (const existing of this.docs.values()) {
      if (existing.contentRevisionId.equals(doc.contentRevisionId) && existing.version === doc.version) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
    }
    const _id = doc._id ?? new ObjectId();
    this.docs.set(_id.toHexString(), clone({ ...doc, _id }));
    this.writes.push('insert');
    return _id;
  }

  async getById(id: ObjectId): Promise<PresentationProfileDoc | null> {
    const doc = this.docs.get(id.toHexString());
    return doc ? clone(doc) : null;
  }

  async getByContentAndVersion(contentRevisionId: ObjectId, version: number): Promise<PresentationProfileDoc | null> {
    for (const doc of this.docs.values()) {
      if (doc.contentRevisionId.equals(contentRevisionId) && doc.version === version) return clone(doc);
    }
    return null;
  }

  async listByContent(contentRevisionId: ObjectId): Promise<PresentationProfileDoc[]> {
    return [...this.docs.values()]
      .filter((d) => d.contentRevisionId.equals(contentRevisionId))
      .sort((a, b) => b.version - a.version)
      .map(clone);
  }

  async nextVersion(contentRevisionId: ObjectId): Promise<number> {
    let max = 0;
    for (const doc of this.docs.values()) {
      if (doc.contentRevisionId.equals(contentRevisionId) && doc.version > max) max = doc.version;
    }
    return max + 1;
  }

  async updateIfEditable(id: ObjectId, update: PresentationProfileDraftUpdate): Promise<PresentationProfileDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || (doc.status !== 'DRAFT' && doc.status !== 'CONFIRMED')) return null;
    const next: PresentationProfileDoc = {
      ...doc,
      emphasis: clone(update.emphasis),
      segmentation: clone(update.segmentation),
      style: clone(update.style),
      status: 'DRAFT',
      editRevision: doc.editRevision + 1,
      previewedBy: null,
      previewedAt: null,
      previewedRevision: null,
      confirmedBy: null,
      confirmedAt: null,
      updatedAt: clone(update.updatedAt)
    };
    this.docs.set(id.toHexString(), next);
    this.writes.push('updateIfEditable');
    return clone(next);
  }

  async markPreviewedIfEditable(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || (doc.status !== 'DRAFT' && doc.status !== 'CONFIRMED') || doc.editRevision !== expectedRevision) return null;
    const next: PresentationProfileDoc = { ...doc, previewedBy: by, previewedAt: clone(at), previewedRevision: expectedRevision, updatedAt: clone(at) };
    this.docs.set(id.toHexString(), next);
    this.writes.push('markPreviewedIfEditable');
    return clone(next);
  }

  async confirmIfPreviewed(id: ObjectId, expectedRevision: number, by: string, at: Date): Promise<PresentationProfileDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (
      !doc ||
      (doc.status !== 'DRAFT' && doc.status !== 'CONFIRMED') ||
      doc.editRevision !== expectedRevision ||
      doc.previewedRevision !== expectedRevision
    ) return null;
    const next: PresentationProfileDoc = { ...doc, status: 'CONFIRMED', confirmedBy: by, confirmedAt: clone(at), updatedAt: clone(at) };
    this.docs.set(id.toHexString(), next);
    this.writes.push('confirmIfPreviewed');
    return clone(next);
  }

  async lockIfConfirmed(id: ObjectId, at: Date): Promise<PresentationProfileDoc | null> {
    const doc = this.docs.get(id.toHexString());
    if (!doc || doc.status !== 'CONFIRMED') return null;
    const next: PresentationProfileDoc = { ...doc, status: 'LOCKED', lockedAt: clone(at), updatedAt: clone(at) };
    this.docs.set(id.toHexString(), next);
    this.writes.push('lockIfConfirmed');
    return clone(next);
  }
}
