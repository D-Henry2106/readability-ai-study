import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Group A (A2/A4): one parser for filters, and deprecated aliases that run the canonical handler.
const requireAdmin = vi.fn();
vi.mock('@/lib/auth/admin-session', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a), getAdminSession: vi.fn() }));
const exportCalls: unknown[][] = [];
vi.mock('@/lib/services/export.service', () => ({
  ExportService: class { async paired(...a: unknown[]) { exportCalls.push(a); return 'csv'; } async wide(...a: unknown[]) { exportCalls.push(a); return 'csv'; } }
}));
vi.mock('@/lib/services/audit.service', () => ({ AuditService: class { async record() { /* no-op */ } } }));
vi.mock('@/lib/repositories/research.repository', () => ({
  ResearchRepository: class { async getConfig() { return { phase: 'PILOT' }; } async listSessions() { return { items: [], total: 0 }; } }
}));

import { parseSessionListQuery } from '@/lib/services/research-filters';
import { deprecatedAlias } from '@/lib/http';

const researcherOnly = (roles?: string[]) => { if (roles && !roles.includes('SUPERVISOR')) throw new Error('FORBIDDEN'); return { username: 'sup', role: 'SUPERVISOR', exp: 0 }; };
const anonymous = () => { throw new Error('UNAUTHORIZED'); };
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
const ctx = { params: Promise.resolve({ id: 'abc' }) };

beforeEach(() => { requireAdmin.mockReset(); exportCalls.length = 0; });

describe('parseSessionListQuery', () => {
  it('treats empty strings as absent and defaults phase to the configured one', () => {
    const r = parseSessionListQuery({ group: '', package: '', status: '', phase: '' }, 'PILOT');
    expect(r).toMatchObject({ ok: true, value: { phase: 'PILOT', page: 1, pageSize: 25, sort: 'newest' } });
  });
  it('uses the same normalisation as statistics/export (package upper-cased, revision numeric)', () => {
    const r = parseSessionListQuery({ group: 'B', package: 'pkg_01', revision: '3', phase: 'MAIN' }, 'PILOT');
    expect(r).toMatchObject({ ok: true, value: { groupCode: 'B', packageCode: 'PKG_01', revision: 3, phase: 'MAIN' } });
  });
  it.each([
    { group: 'C' }, { package: 'x' }, { revision: '0' }, { revision: '1.5' }, { phase: 'ALL' }, { status: 'BOGUS' },
    { validity: 'MAYBE' }, { page: '0' }, { page: 'NaN' }, { pageSize: '-1' }, { search: 'x'.repeat(101) }
  ])('rejects an invalid supplied filter instead of broadening: %j', (q) => {
    expect(parseSessionListQuery(q, 'MAIN').ok).toBe(false);
  });
  it('clamps pageSize to 100', () => {
    expect(parseSessionListQuery({ pageSize: '5000' }, 'MAIN')).toMatchObject({ ok: true, value: { pageSize: 100 } });
  });
});

describe('deprecatedAlias', () => {
  it('keeps status/body and adds Deprecation + successor Link', async () => {
    const wrapped = deprecatedAlias(async () => Response.json({ a: 1 }, { status: 201 }), '/api/admin/x');
    const res = await wrapped();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/admin/x>; rel="successor-version"');
  });
});

describe('legacy aliases cannot bypass auth or roles (they run the canonical handler)', () => {
  const cases: Array<[string, () => Promise<Response>]> = [];
  beforeEach(async () => {
    cases.length = 0;
    const config = await import('@/app/api/config/route');
    const sessions = await import('@/app/api/sessions/route');
    const sessionById = await import('@/app/api/sessions/[id]/route');
    const validity = await import('@/app/api/sessions/[id]/validity/route');
    const packages = await import('@/app/api/packages/route');
    const exportRoute = await import('@/app/api/export/route');
    cases.push(
      ['GET /api/config', () => config.GET()],
      ['POST /api/config', () => config.POST(req('/api/config', 'POST', {}))],
      ['GET /api/sessions', () => sessions.GET(req('/api/sessions'))],
      ['GET /api/sessions/[id]', () => sessionById.GET(req('/api/sessions/abc'), ctx)],
      ['POST /api/sessions/[id]/validity', () => validity.POST(req('/api/sessions/abc/validity', 'POST', { validityFlag: 'VALID', reason: null }), ctx)],
      ['GET /api/packages', () => packages.GET()],
      ['POST /api/packages', () => packages.POST(req('/api/packages', 'POST', {}))],
      ['GET /api/export', () => exportRoute.GET(req('/api/export?format=paired&phase=MAIN'))]
    );
  });

  it('returns 401 plus deprecation headers for anonymous callers', async () => {
    requireAdmin.mockImplementation(anonymous);
    for (const [name, call] of cases) {
      const res = await call();
      expect(res.status, name).toBe(401);
      expect(res.headers.get('Deprecation'), name).toBe('true');
    }
  });

  it('returns 403 for a SUPERVISOR on every state-changing or export alias', async () => {
    requireAdmin.mockImplementation(researcherOnly);
    const mutating = cases.filter(([n]) => n.startsWith('POST') || n.includes('export'));
    expect(mutating.length).toBeGreaterThanOrEqual(4);
    for (const [name, call] of mutating) expect((await call()).status, name).toBe(403);
  });
});

describe('export default phase matches the dashboard', () => {
  it('uses the configured phase when none is supplied, and never exports PILOT+MAIN together', async () => {
    requireAdmin.mockResolvedValue({ username: 'r', role: 'RESEARCHER', exp: 0 });
    const { GET } = await import('@/app/api/admin/export/route');
    const res = await GET(req('/api/admin/export?format=paired&group=A&package=pkg_01&revision=2'));
    expect(res.status).toBe(200);
    expect(exportCalls[0][0]).toBe('PILOT');
    expect(exportCalls[0][1]).toEqual({ group: 'A', packageCode: 'PKG_01', revision: 2 });
    expect(res.headers.get('content-disposition')).toContain('research-pilot-paired.csv');
  });
  it('rejects an invalid phase with 400 rather than falling back', async () => {
    requireAdmin.mockResolvedValue({ username: 'r', role: 'RESEARCHER', exp: 0 });
    const { GET } = await import('@/app/api/admin/export/route');
    expect((await GET(req('/api/admin/export?phase=ALL'))).status).toBe(400);
    expect(exportCalls).toHaveLength(0);
  });
});
