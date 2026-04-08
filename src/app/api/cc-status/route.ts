import { NextResponse } from 'next/server';
import { getClaudeCodeStatus } from '@/lib/claude-reader';

export async function GET() {
  try {
    const status = await getClaudeCodeStatus();
    return NextResponse.json({
      active: status.active,
      sessions: status.activeSessions,
      lastActivity: status.lastActivity,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check Claude Code status' }, { status: 500 });
  }
}
