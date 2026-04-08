import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getActivity } from '@/lib/claude-reader';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '0');
    const data = await getActivity();
    if (hours <= 0) return NextResponse.json(data);

    const cutoff = new Date(Date.now() - hours * 3600000);
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    // Filter daily map to only days on or after cutoff
    const filteredDaily: typeof data.daily = {};
    for (const [key, val] of Object.entries(data.daily)) {
      if (key >= cutoffKey) filteredDaily[key] = val;
    }

    return NextResponse.json({ ...data, daily: filteredDaily });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
