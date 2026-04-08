import { NextResponse } from 'next/server';
import { getProjects } from '@/lib/claude-reader';

export async function GET() {
  try {
    const data = await getProjects();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
