import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { selectPackage, PackageService, validatePresentation } from '@/lib/services/package.service';
import { contentHash } from '@/lib/experiment/content-integrity';
import type { ResearchRepository } from '@/lib/repositories/research.repository';

function makeTestRepo() {
  const contentDocs = new Map<string, any>();
  const packageDocs = new Map<string, any>();

  const repo = {
    async nextContentRevision() { return contentDocs.size + 1; },
    async insertContent(doc: any) {
      const id = new ObjectId();
      const stored = { _id: id, ...doc };
      contentDocs.set(id.toHexString(), stored);
      return id;
    },
    async getContentById(id: ObjectId) {
      return contentDocs.get(id.toHexString()) ?? null;
    },
    async publishContent(id: ObjectId) {
      const doc = contentDocs.get(id.toHexString());
      if (doc) {
        doc.status = 'PUBLISHED';
        doc.locked = true;
        doc.publishedAt = new Date();
      }
      return doc;
    },
    async updateDraftContent(id: ObjectId, update: any) {
      const doc = contentDocs.get(id.toHexString());
      if (doc && doc.status === 'DRAFT') {
        Object.assign(doc, update);
        return doc;
      }
      return null;
    },
    async nextPackageRevision() { return packageDocs.size + 1; },
    async insertPackage(doc: any) {
      const id = new ObjectId();
      const stored = { _id: id, ...doc };
      packageDocs.set(id.toHexString(), stored);
      return id;
    },
    async getPackageById(id: ObjectId) {
      return packageDocs.get(id.toHexString()) ?? null;
    },
    async publishPackage(id: ObjectId) {
      const doc = packageDocs.get(id.toHexString());
      if (doc && doc.status === 'DRAFT') {
        doc.status = 'PUBLISHED';
        doc.publishedAt = new Date();
        return doc;
      }
      return null;
    },
    async updateDraftPackage(id: ObjectId, update: any) {
      const doc = packageDocs.get(id.toHexString());
      if (doc && doc.status === 'DRAFT') {
        Object.assign(doc, update);
        return doc;
      }
      return null;
    },
    async listEligiblePackages(phase: any) {
      return Array.from(packageDocs.values()).filter(p => p.phase === phase && p.status === 'PUBLISHED' && p.enabled);
    }
  } as unknown as ResearchRepository;

  return { repo, contentDocs, packageDocs };
}

const contentId = new ObjectId(), pkgId = new ObjectId();
const rawText = 'The model learns from data. This is valid text.';
const staticPkg = {
  _id: pkgId,
  code: 'AI_01',
  title: 'AI overview',
  topic: 'AI',
  description: '',
  phase: 'PILOT' as const,
  contentRevisionId: contentId,
  status: 'PUBLISHED' as const,
  enabled: true,
  revision: 1,
  aiSource: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  publishedAt: new Date(),
  archivedAt: null
};

const staticRepo = ({
  getContentById: async () => ({
    _id: contentId,
    phase: 'PILOT',
    status: 'PUBLISHED',
    rawContent: rawText,
    contentHash: contentHash(rawText)
  }),
  listEligiblePackages: async () => [staticPkg],
  getPackageById: async () => staticPkg
} as unknown as ResearchRepository);

describe('content package integrity and assignment', () => {
  it('V1/V2 keep identical lexical content', () => {
    expect(validatePresentation('Title. First sentence. Second sentence.')).toBe(true);
  });

  it('rejects random assignment with no eligible packages', () => {
    expect(() => selectPackage([], 'RANDOM', null)).toThrow('NO_ELIGIBLE_PACKAGE');
  });

  it('selects configured published package deterministically when fixed', () => {
    expect(selectPackage([staticPkg], 'FIXED', pkgId.toHexString())).toBe(staticPkg);
  });

  it('never allows a different fixed package to be assigned', () => {
    expect(() => selectPackage([staticPkg], 'FIXED', new ObjectId().toHexString())).toThrow('FIXED_PACKAGE_REQUIRED');
  });

  it('allows a valid locked package for PILOT', async () => {
    expect(await new PackageService(staticRepo).eligible('PILOT')).toHaveLength(1);
  });

  it('blocks MAIN random until protocol approval', async () => {
    await expect(
      new PackageService(staticRepo).choose({
        phase: 'MAIN',
        assignmentMode: 'RANDOM',
        mainRandomApproved: false
      } as never)
    ).rejects.toThrow('MAIN_RANDOM_NOT_APPROVED');
  });

  it('creates a package draft without questionSetId', async () => {
    const { repo, packageDocs } = makeTestRepo();
    const service = new PackageService(repo);
    const id = await service.createDraft({
      code: 'AI_01',
      title: 'AI Package',
      topic: 'AI Topic',
      phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.'
    });
    expect(id).toBeInstanceOf(ObjectId);
    const pkg = packageDocs.get(id.toHexString());
    expect(pkg).toBeDefined();
    expect(pkg.questionSetId).toBeNull();
    expect(pkg.status).toBe('DRAFT');
  });

  it('publishes a package without questionSetId', async () => {
    const { repo, contentDocs } = makeTestRepo();
    const service = new PackageService(repo);
    const id = await service.createDraft({
      code: 'AI_01',
      title: 'AI Package',
      topic: 'AI Topic',
      phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.'
    });
    const published = await service.publish(id.toHexString());
    expect(published.status).toBe('PUBLISHED');
    expect(published.questionSetId).toBeNull();
    const content = contentDocs.get(published.contentRevisionId.toHexString());
    expect(content.status).toBe('PUBLISHED');
    expect(content.locked).toBe(true);
  });

  it('accepts a V2 that only changes formatting and stores sanitized content', async () => {
    const { repo, contentDocs } = makeTestRepo();
    const service = new PackageService(repo);
    const id = await service.createDraft({
      code: 'AI_02', title: 'AI Package', topic: 'AI Topic', phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.',
      v2Content: '<h2>Title.</h2><p onclick="x()">First <strong>sentence.</strong></p><script>x()</script><p>Second sentence.</p>'
    });
    const published = await service.publish(id.toHexString());
    const content = contentDocs.get(published.contentRevisionId.toHexString());
    expect(content.v2Content).not.toMatch(/script|onclick/i);
    expect(content.status).toBe('PUBLISHED');
  });

  it('rejects creating or publishing a V2 whose wording differs from V1', async () => {
    const { repo, contentDocs } = makeTestRepo();
    const service = new PackageService(repo);
    await expect(service.createDraft({
      code: 'AI_03', title: 'AI Package', topic: 'AI Topic', phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.',
      v2Content: '<p>Title. First sentence. Third sentence.</p>'
    })).rejects.toThrow('LEXICAL_INTEGRITY_FAILED');

    const id = await service.createDraft({
      code: 'AI_04', title: 'AI Package', topic: 'AI Topic', phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.',
      v2Content: '<p>Title. First sentence. Second sentence.</p>'
    });
    const pkg = (await repo.getPackageById(id))!;
    const content = contentDocs.get(pkg.contentRevisionId.toHexString());
    content.v2Content = '<p>Title. First sentence. Changed.</p>'; // simulate tampering after save
    await expect(service.publish(id.toHexString())).rejects.toThrow('PACKAGE_INVALID:V1_V2_TEXT_MISMATCH');
  });

  it('rejects invalid content during verify and creation', async () => {
    const { repo } = makeTestRepo();
    const service = new PackageService(repo);

    // Invalid content during create (e.g. invalid code or metadata)
    await expect(service.createDraft({
      code: 'X', // invalid: must be 2-40 characters
      title: 'AI Package',
      topic: 'AI Topic',
      phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.'
    })).rejects.toThrow();

    // Missing content in verifyPackage -> INVALID_CONTENT
    const badPkg = {
      _id: new ObjectId(),
      code: 'AI_01',
      title: 'AI',
      topic: 'AI',
      description: '',
      phase: 'PILOT' as const,
      contentRevisionId: new ObjectId(),
      status: 'DRAFT' as const,
      enabled: true,
      revision: 1,
      aiSource: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: null,
      archivedAt: null
    };
    const problems = await service.verifyPackage(badPkg);
    expect(problems).toContain('INVALID_CONTENT');
  });

  it('ensures published packages remain immutable', async () => {
    const { repo } = makeTestRepo();
    const service = new PackageService(repo);
    const id = await service.createDraft({
      code: 'AI_01',
      title: 'AI Package',
      topic: 'AI Topic',
      phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.'
    });
    await service.publish(id.toHexString());

    // Updating published package throws PACKAGE_NOT_EDITABLE
    await expect(service.updateDraft(id.toHexString(), {
      code: 'AI_01',
      title: 'Updated AI',
      topic: 'AI Topic',
      phase: 'PILOT',
      rawContent: 'Title. First sentence. Second sentence.'
    })).rejects.toThrow('PACKAGE_NOT_EDITABLE');

    // Publishing again throws PACKAGE_NOT_EDITABLE
    await expect(service.publish(id.toHexString())).rejects.toThrow('PACKAGE_NOT_EDITABLE');
  });
});
