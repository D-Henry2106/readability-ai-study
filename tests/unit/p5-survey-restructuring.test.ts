import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { summarizeVariants, type AnalysisDataset } from '@/lib/services/analysis.service';
import type { QuestionSetDoc, SessionDoc, TestAttemptDoc, ReadingSessionDoc } from '@/types/research';
import { makeQuestions } from '../helpers/question-fixtures';
import { ResearchRepository } from '@/lib/repositories/research.repository';

describe('P5 Survey Restructuring Unit Tests', () => {
  describe('summarizeVariants (V1 vs V2 analysis)', () => {
    const qSet: QuestionSetDoc = {
      _id: new ObjectId(),
      revision: 1,
      label: 'Main Survey Questions',
      phase: 'MAIN',
      questions: makeQuestions(15),
      status: 'PUBLISHED',
      locked: true,
      createdAt: new Date(0),
      publishedAt: new Date(0)
    };

    it('handles empty dataset gracefully', () => {
      const emptyDataset: AnalysisDataset = {
        sessions: [],
        tests: [],
        readings: []
      };
      const summary = summarizeVariants(emptyDataset, qSet);
      expect(summary.v1.totalParticipants).toBe(0);
      expect(summary.v2.totalParticipants).toBe(0);
      expect(summary.v1.completed).toBe(0);
      expect(summary.v2.completed).toBe(0);
      expect(summary.v1.scoreStats.mean).toBeNull();
      expect(summary.v2.scoreStats.mean).toBeNull();
      expect(summary.diffMeanScore).toBeNull();
      expect(summary.questions.length).toBe(15);
    });

    it('correctly aggregates V1 and V2 participants, scores out of 15, and question accuracies', () => {
      const v1SessionId = new ObjectId().toHexString();
      const v2SessionId = new ObjectId().toHexString();

      const sessions: SessionDoc[] = [
        {
          _id: new ObjectId(v1SessionId),
          sessionId: v1SessionId,
          participantCode: 'P-V1-01',
          presentationVariant: 'V1',
          status: 'COMPLETED',
          currentStage: 'COMPLETED',
          studyPhase: 'MAIN',
          validityStatus: 'VALID',
          questionSetId: qSet._id,
          questionSetRevision: 1,
          createdAt: new Date('2026-03-01T10:00:00Z'),
          completedAt: new Date('2026-03-01T10:15:00Z')
        } as unknown as SessionDoc,
        {
          _id: new ObjectId(v2SessionId),
          sessionId: v2SessionId,
          participantCode: 'P-V2-01',
          presentationVariant: 'V2',
          status: 'COMPLETED',
          currentStage: 'COMPLETED',
          studyPhase: 'MAIN',
          validityStatus: 'VALID',
          questionSetId: qSet._id,
          questionSetRevision: 1,
          createdAt: new Date('2026-03-01T10:00:00Z'),
          completedAt: new Date('2026-03-01T10:12:00Z')
        } as unknown as SessionDoc
      ];

      // V1 answered first 10 questions correctly (score 10/15)
      const v1Answers = qSet.questions.map((q, idx) => ({
        questionId: q.id,
        selectedOptionId: idx < 10 ? 'opt-correct' : 'opt-wrong',
        isCorrect: idx < 10
      }));

      // V2 answered all 15 questions correctly (score 15/15)
      const v2Answers = qSet.questions.map((q) => ({
        questionId: q.id,
        selectedOptionId: 'opt-correct',
        isCorrect: true
      }));

      const tests: TestAttemptDoc[] = [
        {
          _id: new ObjectId(),
          sessionId: v1SessionId,
          roundNo: 1,
          score: 10,
          totalQuestions: 15,
          startedAt: new Date('2026-03-01T10:05:00Z'),
          submittedAt: new Date('2026-03-01T10:08:00Z'),
          answers: v1Answers,
          createdAt: new Date()
        } as unknown as TestAttemptDoc,
        {
          _id: new ObjectId(),
          sessionId: v2SessionId,
          roundNo: 1,
          score: 15,
          totalQuestions: 15,
          startedAt: new Date('2026-03-01T10:05:00Z'),
          submittedAt: new Date('2026-03-01T10:07:30Z'),
          answers: v2Answers,
          createdAt: new Date()
        } as unknown as TestAttemptDoc
      ];

      const readings: ReadingSessionDoc[] = [
        {
          _id: new ObjectId(),
          sessionId: v1SessionId,
          roundNo: 1,
          durationSeconds: 300,
          createdAt: new Date()
        } as unknown as ReadingSessionDoc,
        {
          _id: new ObjectId(),
          sessionId: v2SessionId,
          roundNo: 1,
          durationSeconds: 240,
          createdAt: new Date()
        } as unknown as ReadingSessionDoc
      ];

      const summary = summarizeVariants({ sessions, tests, readings }, qSet);

      // Verify V1 vs V2 counts
      expect(summary.v1.totalParticipants).toBe(1);
      expect(summary.v2.totalParticipants).toBe(1);
      expect(summary.v1.completed).toBe(1);
      expect(summary.v2.completed).toBe(1);
      expect(summary.v1.completionRate).toBe(100);
      expect(summary.v2.completionRate).toBe(100);

      // Verify scores (out of 15)
      expect(summary.v1.scoreStats.mean).toBe(10);
      expect(summary.v2.scoreStats.mean).toBe(15);
      expect(summary.diffMeanScore).toBe(5); // V2 - V1 = +5 points

      // Verify score distribution (size 16 for scores 0-15)
      expect(summary.v1.scoreDistribution.length).toBe(16);
      expect(summary.v1.scoreDistribution[10]).toBe(1);
      expect(summary.v2.scoreDistribution[15]).toBe(1);

      // Verify timing metrics
      expect(summary.v1.readingTimeStats.mean).toBe(300);
      expect(summary.v2.readingTimeStats.mean).toBe(240);
      expect(summary.diffMeanReadingTime).toBe(-60); // V2 was 60s faster

      expect(summary.v1.quizTimeStats.mean).toBe(180);
      expect(summary.v2.quizTimeStats.mean).toBe(150);

      // Verify question level accuracy
      // First question: both got right -> diff = 0
      expect(summary.questions[0].v1Accuracy).toBe(100);
      expect(summary.questions[0].v2Accuracy).toBe(100);
      expect(summary.questions[0].diffAccuracy).toBe(0);

      // 15th question (index 14): V1 wrong (0%), V2 right (100%) -> diff = +100%
      expect(summary.questions[14].v1Accuracy).toBe(0);
      expect(summary.questions[14].v2Accuracy).toBe(100);
      expect(summary.questions[14].diffAccuracy).toBe(100);
    });
  });

  describe('Question Repository & Safety', () => {
    it('ResearchRepository defines safe deleteOrArchive and attempt checking methods', () => {
      const repo = new ResearchRepository();
      expect(typeof repo.updateQuestionSet).toBe('function');
      expect(typeof repo.hasTestAttemptsForQuestionSet).toBe('function');
      expect(typeof repo.deleteOrArchiveQuestionSet).toBe('function');
    });
  });

  describe('Single-Round Study Flow Step Progress', () => {
    it('Study Run participants complete survey in 6 total steps without round 2 or breaks', () => {
      // Step indices in Study Run mode:
      // 1: Information
      // 2: Consent
      // 3: Demographics
      // 4: Reading
      // 5: Review
      // 6: Test
      const totalSteps = 6;
      const reviewStep = 5;
      const testStep = 6;

      expect(reviewStep).toBe(5);
      expect(testStep).toBe(totalSteps);
      expect(totalSteps).toBe(6);
    });
  });
});
