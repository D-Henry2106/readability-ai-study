import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { validitySchema } from '@/lib/validation/schemas';
import { reviewSessionValidity } from '@/lib/services/validity-review.service';
import { jsonError } from '@/lib/http';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const { id } = await params;
    const input = validitySchema.parse(await request.json());
    const result = await reviewSessionValidity(id, input, admin);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { return jsonError(error); }
}
