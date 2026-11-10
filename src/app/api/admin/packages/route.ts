import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { PackageService } from '@/lib/services/package.service';
import { AuditService } from '@/lib/services/audit.service';
import { jsonError } from '@/lib/http';
import { ObjectId } from 'mongodb';
import { ensureIndexes } from '@/lib/db/indexes';
const actionSchema = z.object({ action: z.enum(['PUBLISH', 'ARCHIVE', 'CLONE', 'UPDATE']), id: z.string().regex(/^[a-fA-F0-9]{24}$/) });
export async function GET() {
  try {
    await requireAdmin();
    const repo = new ResearchRepository();
    const packages = await repo.listPackages();
    return NextResponse.json(await Promise.all(packages.map(async pkg => {
      const [content, set] = await Promise.all([repo.getContentById(pkg.contentRevisionId), repo.getQuestionSetById(pkg.questionSetId)]);
      return { ...pkg, rawContent: content?.rawContent ?? '', contentRevision: content?.revision ?? null, questions: set?.questions ?? [], questionRevision: set?.revision ?? null, validation: await new PackageService(repo).checklist(pkg) };
    })));
  } catch (e) { return jsonError(e); }
}
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    await ensureIndexes();
    const data: unknown = await req.json();
    const repo = new ResearchRepository();
    const service = new PackageService(repo);
    if (typeof data === 'object' && data !== null && 'action' in data && (data as {action: unknown}).action === 'CREATE') {
      const id = await service.createDraft(data);
      await new AuditService(repo).record({ username: admin.username, role: admin.role, action: 'PACKAGE_DRAFT_CREATED', targetType: 'content_package', targetId: id.toHexString() });
      return NextResponse.json({ ok: true, id: id.toHexString() }, { status: 201 });
    }
    if (typeof data === 'object' && data !== null && 'action' in data && (data as {action: unknown}).action === 'UPDATE') {
      const id = z.string().regex(/^[a-fA-F0-9]{24}$/).parse((data as {id?:unknown}).id);
      await service.updateDraft(id, data);
      await new AuditService(repo).record({ username: admin.username, role: admin.role, action: 'PACKAGE_DRAFT_UPDATED', targetType: 'content_package', targetId: id });
      return NextResponse.json({ ok: true });
    }
    const { action, id } = actionSchema.parse(data);
    const pkg = await repo.getPackageById(new ObjectId(id));
    if (!pkg) return NextResponse.json({ error: 'Không tìm thấy bộ nội dung.' }, { status: 404 });
    if (action === 'PUBLISH') await service.publish(id);
    if (action === 'ARCHIVE') {
      if (!await repo.archivePackage(new ObjectId(id))) return NextResponse.json({ error: 'Chỉ được lưu trữ bộ đã xuất bản.' }, { status: 409 });
    }
    if (action === 'CLONE') {
      const [content, set] = await Promise.all([repo.getContentById(pkg.contentRevisionId), repo.getQuestionSetById(pkg.questionSetId)]);
      if (!content || !set) return NextResponse.json({ error: 'Thiếu dữ liệu phiên bản cũ.' }, { status: 409 });
      const cloned = await service.createDraft({ code: pkg.code, title: pkg.title, topic: pkg.topic, description: pkg.description, phase: pkg.phase, rawContent: content.rawContent, questions: set.questions, aiSource: pkg.aiSource });
      return NextResponse.json({ ok: true, id: cloned.toHexString() });
    }
    await new AuditService(repo).record({ username: admin.username, role: admin.role, action: `PACKAGE_${action}`, targetType: 'content_package', targetId: id });
    return NextResponse.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
