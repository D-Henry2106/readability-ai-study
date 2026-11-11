import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { ExperimentalText } from '@/components/participant/ExperimentalText';
import { contentHash } from '@/lib/experiment/content-integrity';
import { ReadingService } from '@/lib/services/reading.service';
import { ScoringService } from '@/lib/services/scoring.service';
import {
  buildV2VisualBlocks,
  extractTextContentFromHtml,
  hasForbiddenReaderCssContent,
  renderPresentationV1,
  renderPresentationV2,
  validateEmphasisSpans,
  verifyPresentationV2Integrity
} from '@/lib/study-run/presentation-profile';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';
import type { PresentationEmphasisSpan } from '@/types/presentation-profile';
import type { QuestionSetDoc, ReadingSessionDoc, SessionDoc } from '@/types/research';
import { DEVICE, expectCode, makeRedeemHarness } from '../helpers/invitation-fakes';
import { expectStudyRunError, FIXTURE_RAW_CONTENT, makeHarness, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';

function spanOf(rawContent: string, phrase: string, fromIndex = 0): PresentationEmphasisSpan {
  const start = rawContent.indexOf(phrase, fromIndex);
  if (start < 0) throw new Error(`Phrase not found: ${phrase}`);
  return { start, end: start + phrase.length, text: phrase };
}

/** Extracts textContent from a React element tree returned by ExperimentalText. */
function reactNodeText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join('');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return reactNodeText(props?.children);
  }
  return '';
}

/** Collects every element tag and text of `<strong>` nodes from a React element tree. */
function inspectReactTree(node: unknown, out: { tags: string[]; strongs: string[] } = { tags: [], strongs: [] }) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) inspectReactTree(child, out);
    return out;
  }
  if ('type' in (node as Record<string, unknown>)) {
    const el = node as { type: unknown; props?: { children?: unknown } };
    if (typeof el.type === 'string') {
      out.tags.push(el.type);
      if (el.type === 'strong') out.strongs.push(reactNodeText(el.props?.children));
    }
    inspectReactTree(el.props?.children, out);
  }
  return out;
}

describe('AC-11: V1 unchanged; V1 and V2 share content revision, question set, scoring and timer', () => {
  it('renders V1 identically to the existing baseline (exact class, textContent and React element structure)', () => {
    const raw = FIXTURE_RAW_CONTENT;
    const v1 = renderPresentationV1(raw);
    expect(v1.className).toBe('experimental-text reader-v1');
    expect(v1.textContent).toBe(raw);
    expect(v1.boldSegments).toEqual([]);
    expect(extractTextContentFromHtml(v1.html)).toBe(raw);
    const tree = ExperimentalText({ rawContent: raw, presentation: 'V1', emphasis: [spanOf(raw, 'fixture passage')] });
    expect(reactNodeText(tree)).toBe(raw);
    const inspected = inspectReactTree(tree);
    expect(inspected.tags).toEqual(['div']);
    expect(inspected.strongs).toEqual([]);
  });

  it('V1 and V2 Study Run sessions share the exact contentRevisionId, questionSetId, timer, question order and scoring', async () => {
    const h = makeRedeemHarness();
    const { runId, profileId } = await h.openRun();
    const [invV1] = await h.issue(runId, 'V1', 1);
    const [invV2] = await h.issue(runId, 'V2', 1);
    const r1 = await h.redemption().redeem({ token: invV1.token, deviceType: DEVICE, cookieSessionId: null });
    const r2 = await h.redemption().redeem({ token: invV2.token, deviceType: DEVICE, cookieSessionId: null });
    const s1 = h.sessions.get(r1.sessionId)!;
    const s2 = h.sessions.get(r2.sessionId)!;

    expect(s1.presentationVariant).toBe('V1');
    expect(s2.presentationVariant).toBe('V2');
    expect(s1.presentationProfileId).toBeUndefined();
    expect(s2.presentationProfileId?.toHexString()).toBe(profileId);
    expect(s1.contentRevisionId.equals(s2.contentRevisionId)).toBe(true);
    expect(s1.questionSetId.equals(s2.questionSetId)).toBe(true);
    expect(s1.assignedPackageId!.equals(s2.assignedPackageId!)).toBe(true);
    expect(s1.minimumReadingSeconds).toBe(s2.minimumReadingSeconds);

    const questionSet: QuestionSetDoc = {
      _id: s1.questionSetId,
      revision: 1,
      label: 'Shared Set',
      phase: 'MAIN',
      status: 'PUBLISHED',
      locked: true,
      createdAt: new Date(0),
      publishedAt: new Date(0),
      questions: Array.from({ length: 5 }, (_, i) => ({
        id: `q${i + 1}`,
        prompt: `Question ${i + 1}?`,
        options: Array.from({ length: 4 }, (_, j) => ({ id: `q${i + 1}o${j + 1}`, text: `Option ${j + 1}`, isCorrect: j === 0 }))
      }))
    };
    const answers = questionSet.questions.map((q, idx) => ({ questionId: q.id, selectedOptionId: idx < 3 ? q.options[0].id : q.options[1].id }));
    const scoreV1 = new ScoringService().score(questionSet, answers);
    const scoreV2 = new ScoringService().score(questionSet, answers);
    expect(scoreV1).toEqual(scoreV2);
    expect(scoreV1.score).toBe(3);
  });

  it('ReadingService.start uses session.presentationVariant for Study Run sessions and keeps presentationForRound for legacy sessions', async () => {
    const created: ReadingSessionDoc[] = [];
    const repo = {
      createReadingIfMissing: async (doc: ReadingSessionDoc) => {
        created.push(doc);
        return doc;
      }
    };
    const svc = new ReadingService(repo as never);
    const baseSession = {
      id: 's-1',
      status: 'ACTIVE',
      currentStage: 'READING_1',
      groupCode: null,
      contentRevisionId: new ObjectId(),
      questionSetId: new ObjectId(),
      informationVersion: 'v1',
      consentVersion: 'v1',
      debriefVersion: 'v1',
      phase: 'MAIN',
      deviceType: 'desktop',
      validityFlag: 'REVIEW_REQUIRED',
      validityReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      withdrawnAt: null
    } satisfies SessionDoc;

    await svc.start({ ...baseSession, id: 'run-v1', studyRunId: new ObjectId(), presentationVariant: 'V1' });
    await svc.start({ ...baseSession, id: 'run-v2', studyRunId: new ObjectId(), presentationVariant: 'V2' });
    await svc.start({ ...baseSession, id: 'legacy-a', groupCode: 'A' });
    await svc.start({ ...baseSession, id: 'legacy-b', groupCode: 'B' });

    expect(created.map((r) => [r.sessionId, r.presentation])).toEqual([
      ['run-v1', 'V1'],
      ['run-v2', 'V2'],
      ['legacy-a', 'V1'],
      ['legacy-b', 'V2']
    ]);
  });
});

describe('AC-12: V2 textContent equals rawContent character-for-character; no added labels or CSS content', () => {
  const passages = [
    FIXTURE_RAW_CONTENT,
    'Đoạn văn tiếng Việt có dấu câu! Câu thứ hai?  Khoảng trắng kép.\nXuống dòng giữ nguyên.',
    'Special HTML chars: 1 < 2 & 3 > 1, "quoted" and \'single-quoted\' tokens. Done! Next sentence.',
    'Unicode emoji 🧪🔬 inside sentence one. Sentence two keeps offsets exact! Sentence three continues.'
  ];

  it('preserves every character, space, newline and HTML special character with 0, 1 or multiple emphasis spans', () => {
    for (const raw of passages) {
      const emptyCheck = verifyPresentationV2Integrity(raw, { emphasis: [] });
      expect(emptyCheck.ok).toBe(true);
      expect(emptyCheck.v2.textContent).toBe(raw);
      expect(extractTextContentFromHtml(emptyCheck.v2.html)).toBe(raw);

      const firstWordEnd = raw.indexOf(' ');
      const lastDot = raw.lastIndexOf('.');
      const spans: PresentationEmphasisSpan[] = [
        { start: 0, end: firstWordEnd, text: raw.slice(0, firstWordEnd) },
        { start: lastDot - 4, end: lastDot, text: raw.slice(lastDot - 4, lastDot) }
      ];
      const withEmphasis = verifyPresentationV2Integrity(raw, { emphasis: spans });
      expect(withEmphasis.ok).toBe(true);
      expect(withEmphasis.v2.textContent).toBe(raw);
      expect(extractTextContentFromHtml(withEmphasis.v2.html)).toBe(raw);
      expect(withEmphasis.contentHash).toBe(contentHash(raw));

      const tree = ExperimentalText({ rawContent: raw, presentation: 'V2', emphasis: spans });
      expect(reactNodeText(tree)).toBe(raw);
      const inspected = inspectReactTree(tree);
      expect(inspected.tags.every((t) => t === 'div' || t === 'span' || t === 'strong')).toBe(true);
      expect(inspected.strongs).toEqual(spans.map((s) => s.text));
    }
  });

  it('preserves exact textContent even when an emphasis span crosses a visual block boundary', () => {
    const raw = FIXTURE_RAW_CONTENT;
    const blocksNoEmphasis = buildV2VisualBlocks(raw);
    expect(blocksNoEmphasis.length).toBe(2);
    const boundary = blocksNoEmphasis[0].end;
    const crossSpan: PresentationEmphasisSpan = {
      start: boundary - 6,
      end: boundary + 5,
      text: raw.slice(boundary - 6, boundary + 5)
    };
    const rendered = renderPresentationV2(raw, { emphasis: [crossSpan] });
    expect(rendered.textContent).toBe(raw);
    expect(extractTextContentFromHtml(rendered.html)).toBe(raw);
    expect(rendered.boldSegments.join('')).toBe(crossSpan.text);
  });

  it('globals.css contains no ::before/::after or content: rules on .reader-v1, .reader-v2, .accessible-block or .experimental-text', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(hasForbiddenReaderCssContent(css)).toBe(false);
    expect(hasForbiddenReaderCssContent('.reader-v2::before { content: "Topic:"; }')).toBe(true);
    expect(hasForbiddenReaderCssContent('.accessible-block { content: "x"; }')).toBe(true);
  });
});

describe('AC-13: manual emphasis only; valid offsets, non-overlapping; empty selection produces no bold tags', () => {
  const raw = FIXTURE_RAW_CONTENT;

  it('when no emphasis is selected, V2 has zero <strong> tags in both HTML and React tree', () => {
    const rendered = renderPresentationV2(raw, { emphasis: [] });
    expect(rendered.boldSegments).toEqual([]);
    expect(rendered.html.includes('<strong')).toBe(false);
    const tree = ExperimentalText({ rawContent: raw, presentation: 'V2', emphasis: [] });
    expect(inspectReactTree(tree).strongs).toEqual([]);
    const treeDefault = ExperimentalText({ rawContent: raw, presentation: 'V2' });
    expect(inspectReactTree(treeDefault).strongs).toEqual([]);
  });

  it('accepts valid non-overlapping manual spans (including adjacent spans) and canonicalizes their order', () => {
    const s1 = spanOf(raw, 'fixture passage');
    const s2 = spanOf(raw, 'first block');
    const s3 = spanOf(raw, '. ', s2.end - 1);
    const adjacent = spanOf(raw, 'Third', s2.end);
    void s3;
    const result = validateEmphasisSpans(raw, [adjacent, s1, s2]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spans.map((s) => s.text)).toEqual(['fixture passage', 'first block', 'Third']);
    }
    // Contiguous back-to-back spans [0,5) and [5,6) do not overlap
    const backToBack = validateEmphasisSpans(raw, [
      { start: 0, end: 5, text: raw.slice(0, 5) },
      { start: 5, end: 14, text: raw.slice(5, 14) }
    ]);
    expect(backToBack.ok).toBe(true);
  });

  it('rejects out-of-range offsets, reversed/empty offsets, surrogate splits, text mismatches, blank spans and overlaps', () => {
    expect(validateEmphasisSpans(raw, [{ start: -1, end: 5, text: 'First' }]).ok).toBe(false);
    expect(validateEmphasisSpans(raw, [{ start: 0, end: raw.length + 1, text: raw + 'x' }]).ok).toBe(false);
    expect(validateEmphasisSpans(raw, [{ start: 5, end: 5, text: '' }]).ok).toBe(false);
    expect(validateEmphasisSpans(raw, [{ start: 8, end: 5, text: 'abc' }]).ok).toBe(false);

    const mismatch = validateEmphasisSpans(raw, [{ start: 0, end: 5, text: 'Wrong' }]);
    expect(mismatch).toMatchObject({ ok: false, code: 'PRESENTATION_EMPHASIS_TEXT_MISMATCH' });

    const blankIdx = raw.indexOf(' ');
    const blank = validateEmphasisSpans(raw, [{ start: blankIdx, end: blankIdx + 1, text: ' ' }]);
    expect(blank).toMatchObject({ ok: false, code: 'PRESENTATION_EMPHASIS_BLANK_SPAN' });

    const overlap = validateEmphasisSpans(raw, [
      spanOf(raw, 'First sentence'),
      spanOf(raw, 'sentence of the')
    ]);
    expect(overlap).toMatchObject({ ok: false, code: 'PRESENTATION_EMPHASIS_OVERLAP' });

    const duplicate = validateEmphasisSpans(raw, [
      spanOf(raw, 'fixture passage'),
      spanOf(raw, 'fixture passage')
    ]);
    expect(duplicate).toMatchObject({ ok: false, code: 'PRESENTATION_EMPHASIS_OVERLAP' });

    const emojiText = 'A 🧪 B';
    // '🧪' is at UTF-16 code units [2, 4); splitting at 3 splits the surrogate pair
    const splitSurrogate = validateEmphasisSpans(emojiText, [{ start: 0, end: 3, text: emojiText.slice(0, 3) }]);
    expect(splitSurrogate).toMatchObject({ ok: false, code: 'PRESENTATION_EMPHASIS_OFFSET_OUT_OF_RANGE' });
  });
});

describe('AC-14 & §6.5: PresentationProfileService preview, confirmation, StudyRun readiness and locking on first invitation', () => {
  it('creates a DRAFT profile (version 1, empty emphasis by default) and requires Preview before Confirm', async () => {
    const h = makeHarness();
    const { profile } = await h.profileService.create(RESEARCHER, { contentRevisionId: h.contentId.toHexString() });
    expect(profile.version).toBe(1);
    expect(profile.variant).toBe('V2');
    expect(profile.status).toBe('DRAFT');
    expect(profile.emphasis).toEqual([]);
    expect(profile.previewedAt).toBeNull();
    expect(profile.confirmedAt).toBeNull();
    expect(profile.lockedAt).toBeNull();

    // Cannot confirm before preview
    await expectStudyRunError(
      h.profileService.confirm(RESEARCHER, profile._id!.toHexString()),
      'PRESENTATION_PROFILE_PREVIEW_REQUIRED',
      409
    );

    // SUPERVISOR preview is read-only and does NOT satisfy the RESEARCHER preview requirement
    const supPreview = await h.profileService.preview(SUPERVISOR, profile._id!.toHexString());
    expect(supPreview.profile.previewedAt).toBeNull();
    await expectStudyRunError(
      h.profileService.confirm(RESEARCHER, profile._id!.toHexString()),
      'PRESENTATION_PROFILE_PREVIEW_REQUIRED',
      409
    );

    // RESEARCHER preview records previewedBy/previewedAt and returns V1 + V2 + integrity
    const previewed = await h.profileService.preview(RESEARCHER, profile._id!.toHexString());
    expect(previewed.profile.previewedBy).toBe('researcher');
    expect(previewed.profile.previewedAt === null).toBe(false);
    expect(previewed.integrity.exactTextMatch).toBe(true);
    expect(previewed.v1.textContent).toBe(h.state.rawContent);
    expect(previewed.v2.textContent).toBe(h.state.rawContent);

    // Confirm succeeds after preview
    const confirmed = await h.profileService.confirm(RESEARCHER, profile._id!.toHexString());
    expect(confirmed.profile.status).toBe('CONFIRMED');
    expect(confirmed.profile.confirmedBy).toBe('researcher');
    expect(confirmed.profile.confirmedAt === null).toBe(false);
  });

  it('editing a CONFIRMED profile (before lock) resets it to DRAFT and requires a fresh Preview + Confirm', async () => {
    const h = makeHarness();
    const { profile } = await h.profileService.create(RESEARCHER, { contentRevisionId: h.contentId.toHexString() });
    const pid = profile._id!.toHexString();
    await h.profileService.preview(RESEARCHER, pid);
    await h.profileService.confirm(RESEARCHER, pid);

    const span = spanOf(h.state.rawContent, 'fixture passage');
    const updated = await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis: [span] });
    expect(updated.profile.status).toBe('DRAFT');
    expect(updated.profile.previewedAt).toBeNull();
    expect(updated.profile.confirmedAt).toBeNull();
    expect(updated.profile.emphasis).toEqual([span]);

    await expectStudyRunError(h.profileService.confirm(RESEARCHER, pid), 'PRESENTATION_PROFILE_PREVIEW_REQUIRED', 409);
    const preview2 = await h.profileService.preview(RESEARCHER, pid);
    expect(preview2.v2.boldSegments).toEqual(['fixture passage']);
    const confirmed2 = await h.profileService.confirm(RESEARCHER, pid);
    expect(confirmed2.profile.status).toBe('CONFIRMED');
  });

  it('enforces RESEARCHER role on all profile writes; SUPERVISOR is FORBIDDEN', async () => {
    const h = makeHarness();
    const { profile } = await h.profileService.create(RESEARCHER, { contentRevisionId: h.contentId.toHexString() });
    const pid = profile._id!.toHexString();
    await h.profileService.preview(RESEARCHER, pid);

    const calls: Array<() => Promise<unknown>> = [
      () => h.profileService.create(SUPERVISOR, { contentRevisionId: h.contentId.toHexString() }),
      () => h.profileService.updateEmphasis(SUPERVISOR, pid, { emphasis: [] }),
      () => h.profileService.confirm(SUPERVISOR, pid)
    ];
    for (const call of calls) await expectStudyRunError(call(), 'FORBIDDEN');
    expect((await h.profileService.get(SUPERVISOR, pid)).status).toBe('DRAFT');
    expect(await h.profileService.listByContent(SUPERVISOR, h.contentId.toHexString())).toHaveLength(1);
  });

  it('Study Run cannot OPEN without a CONFIRMED/LOCKED V2 profile, nor if the bound profile was edited back to DRAFT', async () => {
    const h = makeHarness();
    let run = (await h.service.create(RESEARCHER, {
      code: 'RUN-P3',
      name: 'Run P3',
      phase: 'MAIN',
      packageId: h.packageId.toHexString(),
      targetSampleSize: 30
    })).run;
    const runId = run._id!.toHexString();
    run = (await h.service.confirmQuota(RESEARCHER, runId, { expectedVersion: run.version, quotaPerArm: 15 })).run;
    run = (await h.service.confirmEntryPolicy(RESEARCHER, runId, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
    run = (await h.service.confirmInfoConsentReview(RESEARCHER, runId, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;

    // No profile bound yet
    expect((await h.service.checkOpenReadiness(RESEARCHER, runId)).missing).toEqual(['PRESENTATION_PROFILE_NOT_CONFIRMED']);
    await expectStudyRunError(h.service.transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY', 409);

    // Cannot bind a DRAFT profile
    const { profile } = await h.profileService.create(RESEARCHER, { contentRevisionId: h.contentId.toHexString() });
    const pid = profile._id!.toHexString();
    await expectStudyRunError(
      h.service.confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: run.version, profileId: pid }),
      'PRESENTATION_PROFILE_NOT_CONFIRMED',
      409
    );

    // Preview + confirm + bind
    await h.profileService.preview(RESEARCHER, pid);
    await h.profileService.confirm(RESEARCHER, pid);
    run = (await h.service.confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: run.version, profileId: pid })).run;
    expect(run.presentation).toEqual({ V1: { version: 1 }, V2: { profileId: profile._id, version: 1 } });

    // If edited back to DRAFT before OPEN, readiness blocks OPEN again
    await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis: [spanOf(h.state.rawContent, 'First sentence')] });
    expect((await h.service.checkOpenReadiness(RESEARCHER, runId)).missing).toEqual(['PRESENTATION_PROFILE_NOT_CONFIRMED']);

    // Re-preview and re-confirm -> OPEN succeeds
    await h.profileService.preview(RESEARCHER, pid);
    await h.profileService.confirm(RESEARCHER, pid);
    run = (await h.service.transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'OPEN' })).run;
    expect(run.status).toBe('OPEN');
  });

  it('first invitation atomically locks both the Study Run and the V2 profile; once LOCKED every edit returns 409', async () => {
    const h = makeRedeemHarness();
    const { runId, profileId } = await h.openRun();
    expect((await h.profileService.get(RESEARCHER, profileId)).status).toBe('CONFIRMED');
    expect((await h.service.get(RESEARCHER, runId)).locked).toBe(false);

    // Issue first invitation (even for V1) -> locks both run and V2 profile
    await h.issue(runId, 'V1', 1);
    const lockedProfile = await h.profileService.get(RESEARCHER, profileId);
    const lockedRun = await h.service.get(RESEARCHER, runId);
    expect(lockedProfile.status).toBe('LOCKED');
    expect(lockedProfile.lockedAt === null).toBe(false);
    expect(lockedRun.locked).toBe(true);

    // Further invitations do not re-lock or emit duplicate lock audits
    await h.issue(runId, 'V2', 2);
    expect(h.audits.filter((a) => a.action === 'PRESENTATION_PROFILE_LOCKED')).toHaveLength(1);
    expect(h.audits.filter((a) => a.action === 'STUDY_RUN_LOCKED')).toHaveLength(1);

    // Any modification of a LOCKED profile returns 409 PRESENTATION_PROFILE_LOCKED
    await expectStudyRunError(
      h.profileService.updateEmphasis(RESEARCHER, profileId, { emphasis: [] }),
      'PRESENTATION_PROFILE_LOCKED',
      409
    );
    await expectStudyRunError(
      h.profileService.confirm(RESEARCHER, profileId),
      'PRESENTATION_PROFILE_LOCKED',
      409
    );

    // Pausing the run still cannot swap its profile once locked
    await h.setRunStatus(runId, 'PAUSED');
    const paused = await h.service.get(RESEARCHER, runId);
    await expectStudyRunError(
      h.service.confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: paused.version, profileId }),
      'STUDY_RUN_LOCKED',
      409
    );

    // To change V2 emphasis, Admin creates a new profile version (version 2) for a new Study Run
    const v2Profile = await h.profileService.create(RESEARCHER, {
      contentRevisionId: h.contentId.toHexString(),
      emphasis: [spanOf(h.state.rawContent, 'second block')]
    });
    expect(v2Profile.profile.version).toBe(2);
    expect(v2Profile.profile.status).toBe('DRAFT');
    expect((await h.profileService.get(RESEARCHER, profileId)).status).toBe('LOCKED');
  });

  it('refuses to issue invitations if the run has no confirmed V2 profile', async () => {
    const h = makeRedeemHarness();
    const run = (await h.service.create(RESEARCHER, {
      code: 'RUN-UNCONFIRMED',
      name: 'Unconfirmed',
      phase: 'MAIN',
      packageId: h.packageId.toHexString(),
      targetSampleSize: 20
    })).run;
    await expectCode(
      h.admin.create(RESEARCHER, { studyRunId: run._id!.toHexString(), variant: 'V1', count: 1 }),
      'PRESENTATION_PROFILE_NOT_CONFIRMED',
      409
    );
    expect(h.invitations.docs.size).toBe(0);
  });
});
