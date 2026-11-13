import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { QuestionService } from '@/lib/services/question.service';
import { AuditService } from '@/lib/services/audit.service';
import { questionSetDraftSchema } from '@/lib/validation/schemas';
import { jsonError } from '@/lib/http';
const idSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);
export async function GET() { try { await requireAdmin(); return NextResponse.json(await new ResearchRepository().listQuestionSets()); } catch (e) { return jsonError(e); } }
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const body = (await request.json()) as Record<string, unknown>;
    const repo = new ResearchRepository();
    const service = new QuestionService(repo);

    if (body.action === 'CREATE_DRAFT') {
      const input = questionSetDraftSchema.parse(body);
      const id = await service.createDraft(input);
      await new AuditService(repo).record({
        username: admin.username,
        role: admin.role,
        action: 'QUESTIONS_DRAFT_CREATED',
        targetType: 'question_set',
        targetId: id.toHexString()
      });
      return NextResponse.json({ ok: true, id: id.toHexString() });
    }

    if (body.action === 'UPDATE_DRAFT' || body.action === 'UPDATE') {
      const id = idSchema.parse(body.id);
      if (await repo.isRevisionOwnedByPackage('questions', new ObjectId(id))) {
        return NextResponse.json(
          {
            code: 'PACKAGE_OWNED_REVISION',
            message: 'Phiên bản thuộc một bộ nội dung; chỉ được thay đổi qua luồng Package.',
            error: 'Phiên bản thuộc một bộ nội dung; chỉ được thay đổi qua luồng Package.'
          },
          { status: 409 }
        );
      }
      const input = questionSetDraftSchema.parse(body);
      const force = Boolean(body.force);

      try {
        const updated = await service.update(id, input, { force });
        if (!updated) {
          return NextResponse.json({ error: 'Không tìm thấy bộ câu hỏi.' }, { status: 404 });
        }
        await new AuditService(repo).record({
          username: admin.username,
          role: admin.role,
          action: 'QUESTIONS_UPDATED',
          targetType: 'question_set',
          targetId: id
        });
        return NextResponse.json({ ok: true, updated });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'QUESTION_SET_HAS_ATTEMPTS') {
          return NextResponse.json(
            {
              error: 'Bộ câu hỏi đã có dữ liệu làm bài từ người tham gia. Chỉnh sửa có thể ảnh hưởng đến kết quả đã chấm.',
              code: 'QUESTION_SET_HAS_ATTEMPTS',
              requiresForce: true
            },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    if (body.action === 'PUBLISH') {
      const id = idSchema.parse(body.id);
      if (await repo.isRevisionOwnedByPackage('questions', new ObjectId(id))) {
        return NextResponse.json(
          {
            code: 'PACKAGE_OWNED_REVISION',
            message: 'Phiên bản thuộc một bộ nội dung; chỉ được thay đổi qua luồng Package.',
            error: 'Phiên bản thuộc một bộ nội dung; chỉ được thay đổi qua luồng Package.'
          },
          { status: 409 }
        );
      }
      const published = await service.publish(id);
      if (!published) return NextResponse.json({ error: 'Không tìm thấy bản nháp hoặc xuất bản thất bại.' }, { status: 409 });
      await new AuditService(repo).record({
        username: admin.username,
        role: admin.role,
        action: 'QUESTIONS_PUBLISHED',
        targetType: 'question_set',
        targetId: id
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'ARCHIVE') {
      const id = idSchema.parse(body.id);
      const archived = await service.archive(id, admin.username);
      if (!archived) return NextResponse.json({ error: 'Không tìm thấy bộ câu hỏi hoặc đã được lưu trữ.' }, { status: 409 });
      await new AuditService(repo).record({
        username: admin.username,
        role: admin.role,
        action: 'QUESTIONS_ARCHIVED',
        targetType: 'question_set',
        targetId: id
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'DELETE') {
      const id = idSchema.parse(body.id);
      const result = await service.deleteOrArchive(id, admin.username);
      await new AuditService(repo).record({
        username: admin.username,
        role: admin.role,
        action: result.deleted ? 'QUESTIONS_DELETED' : 'QUESTIONS_ARCHIVED',
        targetType: 'question_set',
        targetId: id
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: 'Thao tác không được hỗ trợ.' }, { status: 400 });
  } catch (e) {
    return jsonError(e);
  }
}
