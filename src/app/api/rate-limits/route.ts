import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getLiveUsage, getTokenLog, computeEntryCost } from '@/lib/claude-reader';

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
      overage_pct: (liveRaw as any)?.sevenDaySonnet ?? (liveRaw as any)?.overage_pct ?? 0,
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
        cost_usd: computeEntryCost(e),
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

    // ── Token Budget Estimation ──────────────────────────────────────────────
    // Use ALL token-log entries (unfiltered) to compute split ratios,
    // then back-calculate the total budget from current window percentages.
    const allEntries = (tokenLog || []) as any[];

    function computeBudgetWindow(
      entries: any[],
      pct: number,
      windowLabel: string
    ) {
      if (entries.length === 0 || pct <= 0) {
        return {
          usedTokens: 0,
          percentage: pct,
          estimatedTotal: null,
          remaining: null,
          split: { input: 0, output: 0, cached: 0 },
        };
      }

      const totals = entries.reduce(
        (acc: any, e: any) => {
          acc.input += e.input_tokens ?? 0;
          acc.output += e.output_tokens ?? 0;
          acc.cached += e.cached_tokens ?? 0;
          return acc;
        },
        { input: 0, output: 0, cached: 0 }
      );

      // Cached input tokens count at 1/10th rate for budget math
      const effectiveCached = totals.cached * 0.1;
      const total = totals.input + totals.output + effectiveCached;
      const splitInput = total > 0 ? totals.input / total : 0;
      const splitOutput = total > 0 ? totals.output / total : 0;
      const splitCached = total > 0 ? effectiveCached / total : 0;

      // Back-calculate: if we used `total` effective tokens and that's `pct`% of budget
      const estimatedTotal = pct > 0 ? Math.round(total / (pct / 100)) : null;
      const remaining = estimatedTotal !== null ? Math.max(0, estimatedTotal - total) : null;

      return {
        usedTokens: Math.round(total),
        percentage: pct,
        estimatedTotal,
        remaining,
        split: {
          input: Math.round(splitInput * 100),
          output: Math.round(splitOutput * 100),
          cached: Math.round(splitCached * 100),
        },
      };
    }

    const sonnetEntries = allEntries.filter((e: any) =>
      (e.model ?? '').toLowerCase().includes('sonnet')
    );

    const tokenBudget = {
      fiveHour: computeBudgetWindow(allEntries, current.five_hour_pct, '5h'),
      sevenDay: computeBudgetWindow(allEntries, current.seven_day_pct, '7d'),
      sonnet: {
        fiveHour: computeBudgetWindow(sonnetEntries, current.five_hour_pct, '5h'),
        sevenDay: computeBudgetWindow(sonnetEntries, current.overage_pct, '7d'),
      },
    };

    return NextResponse.json({ current, history, breakdown, tokenBudget, notes: { cachedWeight: 'Cached tokens weighted at 1/10th (Anthropic cache billing rate)' } });
  } catch (error) {
    console.error('rate-limits API error:', error);
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
