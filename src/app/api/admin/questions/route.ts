import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { QuestionService } from '@/lib/services/question.service';
import { AuditService } from '@/lib/services/audit.service';
import { questionSetSchema } from '@/lib/validation/schemas';
import { jsonError } from '@/lib/http';
const idSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);
export async function GET() { try { await requireAdmin(); return NextResponse.json(await new ResearchRepository().listQuestionSets()); } catch (e) { return jsonError(e); } }
export async function POST(request: NextRequest) { try { const admin = await requireAdmin(['RESEARCHER']); const body = await request.json() as Record<string, unknown>; const repo = new ResearchRepository(); const service = new QuestionService(repo); if (body.action === 'CREATE_DRAFT') { const input = questionSetSchema.parse(body); const id = await service.createDraft(input); return NextResponse.json({ ok: true, id: id.toHexString() }); } if (body.action === 'UPDATE_DRAFT') { const id = idSchema.parse(body.id); const input = questionSetSchema.parse(body); const updated = await service.updateDraft(id, input); if (!updated) return NextResponse.json({ error: 'Không tìm thấy bản nháp hoặc phiên bản đã bị khóa.' }, { status: 409 }); return NextResponse.json({ ok: true }); } if (body.action === 'PUBLISH') { const id = idSchema.parse(body.id); const published = await service.publish(id); if (!published) return NextResponse.json({ error: 'Không tìm thấy bản nháp hoặc phiên bản đã bị khóa.' }, { status: 409 }); await new AuditService(repo).record({ username: admin.username, role: admin.role, action: 'QUESTIONS_PUBLISHED', targetType: 'question_set', targetId: id }); return NextResponse.json({ ok: true }); } return NextResponse.json({ error: 'Thao tác không được hỗ trợ.' }, { status: 400 }); } catch (e) { return jsonError(e); } }
