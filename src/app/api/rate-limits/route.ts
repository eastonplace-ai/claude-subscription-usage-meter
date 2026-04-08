import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getLiveUsage, getTokenLog } from '@/lib/claude-reader';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '0');
    const cutoff = hours > 0 ? new Date(Date.now() - hours * 3600000) : null;

    const [liveRaw, tokenLog] = await Promise.all([
      getLiveUsage(),
      getTokenLog(),
    ]);

    // Current window percentages
    const current = {
      five_hour_pct: (liveRaw as any)?.five_hour_pct ?? (liveRaw as any)?.fiveHour ?? 0,
      seven_day_pct: (liveRaw as any)?.seven_day_pct ?? (liveRaw as any)?.sevenDay ?? 0,
      overage_pct: (liveRaw as any)?.overage_pct ?? 0,
      updated_at: (liveRaw as any)?.updated_at ?? new Date().toISOString(),
      source: (liveRaw as any)?.source ?? 'unknown',
    };

    // Historical entries from token-log with rate limit fields
    const history = (tokenLog || [])
      .filter((e: any) => e.timestamp && (!cutoff || new Date(e.timestamp) > cutoff))
      .map((e: any) => ({
        timestamp: e.timestamp,
        five_hour_pct: e.five_hour_pct ?? 0,
        seven_day_pct: e.seven_day_pct ?? 0,
        input_tokens: e.input_tokens ?? 0,
        output_tokens: e.output_tokens ?? 0,
        cached_tokens: e.cached_tokens ?? 0,
        cost_usd: e.cost_usd ?? 0,
        agent: e.agent ?? 'unknown',
        task: e.task ?? '',
      }))
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Token breakdown totals (filtered window)
    const breakdown = history.reduce(
      (acc: any, e: any) => {
        acc.input_total += e.input_tokens;
        acc.output_total += e.output_tokens;
        acc.cached_total += e.cached_tokens;
        acc.cost_total += e.cost_usd;
        return acc;
      },
      { input_total: 0, output_total: 0, cached_total: 0, cost_total: 0 }
    );

    return NextResponse.json({ current, history, breakdown });
  } catch (error) {
    console.error('rate-limits API error:', error);
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
