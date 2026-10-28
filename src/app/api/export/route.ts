import { NextRequest } from 'next/server';
import { exportResearchCsv } from '@/lib/services/export-request.service';

export async function GET(request: NextRequest) { return exportResearchCsv(request); }
