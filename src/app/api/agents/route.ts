import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getTokenLog } from '@/lib/claude-reader';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '0');
    const cutoff = hours > 0 ? new Date(Date.now() - hours * 3600000) : null;
    let data = await getTokenLog();
    if (cutoff) {
      data = data.filter((e) => e.timestamp && new Date(e.timestamp) > cutoff);
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
