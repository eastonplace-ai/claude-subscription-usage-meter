import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getHistory } from '@/lib/claude-reader';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '0');
    const cutoffMs = hours > 0 ? Date.now() - hours * 3600000 : null;
    let data = await getHistory();
    if (cutoffMs) {
      data = data.filter((e) => e.timestamp && e.timestamp > cutoffMs);
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
