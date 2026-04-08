import { NextResponse } from 'next/server';
import { getSessionConversation } from '@/lib/claude-reader';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const turns = await getSessionConversation(id);
    return NextResponse.json(turns);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read session' }, { status: 500 });
  }
}
