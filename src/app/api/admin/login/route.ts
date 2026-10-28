import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { collections } from '@/lib/db/collections';
import { verifyPassword } from '@/lib/security/password';
import { setAdminSession } from '@/lib/auth/admin-session';
import { jsonError } from '@/lib/http';
const schema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(500) });
export async function POST(request: NextRequest) { try { const input = schema.parse(await request.json()); const { admins } = await collections(); const admin = await admins.findOne({ username: input.username }); if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 }); await setAdminSession(admin.username, admin.role); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
