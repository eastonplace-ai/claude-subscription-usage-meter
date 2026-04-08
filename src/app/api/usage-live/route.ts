import { NextResponse } from 'next/server';
import { getLiveUsage, getTokenLog } from '@/lib/claude-reader';

// Cached reads don't count toward rate limits. Only input + output + cache_write do.
// We back-calculate the budget from usage % and weighted token sum.
function computeTokenBudgets(tokenLog: any[], fiveHourPct: number, sevenDayPct: number) {
  const now = Date.now();
  const fiveHourCutoff = now - 5 * 3600_000;
  const sevenDayCutoff = now - 7 * 86400_000;

  let weighted5h = 0;
  let weighted7d = 0;

  for (const e of tokenLog) {
    const ts = new Date(e.timestamp).getTime();
    if (isNaN(ts)) continue;
    // Weighted tokens = input + output + cache_write (cache reads are free)
    const w = (e.input_tokens ?? 0) + (e.output_tokens ?? 0) + (e.cache_write_tokens ?? 0);
    if (ts >= fiveHourCutoff) weighted5h += w;
    if (ts >= sevenDayCutoff) weighted7d += w;
  }

  // Back-calculate budget: if we used W tokens and that's P%, budget = W / (P/100)
  const budget5h = fiveHourPct > 0 ? Math.round(weighted5h / (fiveHourPct / 100)) : 0;
  const budget7d = sevenDayPct > 0 ? Math.round(weighted7d / (sevenDayPct / 100)) : 0;
  const remaining5h = budget5h > 0 ? budget5h - weighted5h : 0;
  const remaining7d = budget7d > 0 ? budget7d - weighted7d : 0;

  return {
    tokenBudget: {
      fiveHour: { used: weighted5h, budget: budget5h, remaining: remaining5h },
      sevenDay: { used: weighted7d, budget: budget7d, remaining: remaining7d },
    },
  };
}

export async function GET() {
  try {
    const data = await getLiveUsage() as any;
    const tokenLog = await getTokenLog();

    let fiveHour = 0, sevenDay = 0, overage = 0, ts = new Date().toISOString(), source = 'none';

    // getLiveUsage() returns camelCase: { fiveHour, sevenDay, sevenDaySonnet, ts, source }
    if (data && (data.fiveHour != null || data.sevenDay != null)) {
      fiveHour = data.fiveHour ?? 0;
      sevenDay = data.sevenDay ?? 0;
      overage = data.sevenDaySonnet ?? 0;
      ts = data.ts || ts;
      source = data.source || 'live';
    } else {
      // Fallback: use latest token-log entry with non-zero pct values
      const withPct = tokenLog.filter(
        (e: any) => (e.five_hour_pct && e.five_hour_pct > 0) || (e.seven_day_pct && e.seven_day_pct > 0)
      );
      if (withPct.length > 0) {
        const latest = withPct[withPct.length - 1];
        fiveHour = latest.five_hour_pct ?? 0;
        sevenDay = latest.seven_day_pct ?? 0;
        ts = latest.timestamp || ts;
        source = 'token-log';
      }
    }

    if (fiveHour === 0 && sevenDay === 0 && overage === 0) {
      return NextResponse.json(null);
    }

    const { tokenBudget } = computeTokenBudgets(tokenLog, fiveHour, sevenDay);

    return NextResponse.json({
      ts,
      fiveHour,
      sevenDay,
      overage,
      fiveHourResetsAt: '',
      sevenDayResetsAt: '',
      source,
      tokenBudget,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
