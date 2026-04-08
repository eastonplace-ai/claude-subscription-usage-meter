import { NextResponse } from 'next/server';
import { getToolUsage } from '@/lib/claude-reader';

export async function GET() {
  try {
    const data = await getToolUsage();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
