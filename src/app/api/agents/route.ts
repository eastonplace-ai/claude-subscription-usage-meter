import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getTokenLog, computeEntryCost } from '@/lib/claude-reader';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '0');
    const cutoff = hours > 0 ? new Date(Date.now() - hours * 3600000) : null;
    let data = await getTokenLog();
    if (cutoff) {
      data = data.filter((e) => e.timestamp && new Date(e.timestamp) > cutoff);
    }
    // Use original cost_usd from token-log; only recalculate if missing
    data = data.map((e: any) => ({
      ...e,
      cost_usd: e.cost_usd != null && e.cost_usd > 0 ? e.cost_usd : computeEntryCost(e),
    }));
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
