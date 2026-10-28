import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { configSchema } from '@/lib/validation/schemas';
import { updateResearchConfig } from '@/lib/services/config-update.service';
import { jsonError } from '@/lib/http';

export async function GET() {
  try { await requireAdmin(); return NextResponse.json(await new ResearchRepository().getConfig()); }
  catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const input = configSchema.parse(await request.json());
    const result = await updateResearchConfig(input, admin);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return jsonError(error); }
}
