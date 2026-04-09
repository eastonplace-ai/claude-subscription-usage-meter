import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getAppConfig, getAppConfigHealth } from '@/lib/app-config';

interface BrainLogEntry {
  timestamp: string;
  source: string;
  event: string;
  query?: string;
  files_matched?: string[];
  files_injected?: number;
  bytes_injected?: number;
  latency_ms?: number;
  khoj_used?: boolean;
  khoj_results?: number;
  khoj_latency_ms?: number;
}

export async function GET() {
  try {
    const config = await getAppConfig();
    const health = await getAppConfigHealth(config);
    const logPath = config.workspaceDir
      ? path.join(config.workspaceDir, '.claude/agents/second-brain-log.jsonl')
      : '';

    // Read telemetry log
    let entries: BrainLogEntry[] = [];
    if (logPath && fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
      entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as BrainLogEntry[];
    }

    // Vault stats
    const vaultDir = health.obsidianVaultPath.available ? config.obsidianVaultPath : '';
    const vaultNotes = vaultDir ? countFiles(vaultDir, '.md') : 0;
    const vaultDecisions = vaultDir ? countFiles(path.join(vaultDir, 'Decisions'), '.md') : 0;
    const vaultSessions = vaultDir ? countFiles(path.join(vaultDir, 'Sessions'), '.md') : 0;
    const vaultProjects = vaultDir ? countFiles(path.join(vaultDir, 'Projects'), '.md') : 0;

    // Graphify stats
    const graphPath = config.graphifyDir ? path.join(config.graphifyDir, 'graph.json') : '';
    let graphNodes = 0, graphEdges = 0, graphCommunities = 0;
    if (graphPath && fs.existsSync(graphPath)) {
      try {
        const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
        graphNodes = g.nodes?.length ?? 0;
        graphEdges = g.links?.length ?? g.edges?.length ?? 0;
        graphCommunities = new Set(g.nodes?.map((n: { community?: unknown }) => n.community).filter((c: unknown) => c != null)).size;
      } catch {}
    }

    const khojOnline = health.khoj.online;

    // Aggregate telemetry
    const now = Date.now();
    const last24h = entries.filter(e => new Date(e.timestamp).getTime() > now - 86400000);
    const last7d = entries.filter(e => new Date(e.timestamp).getTime() > now - 7 * 86400000);

    const obsidianEvents = entries.filter(e => e.source === 'obsidian-turn-lookup' || e.source === 'obsidian-session-start' || e.source === 'obsidian');
    const khojEvents = entries.filter(e => e.source === 'khoj');
    const graphifyEvents = entries.filter(e => e.source === 'graphify');
    // Combined entries (summary per turn) — don't double count
    const combinedEntries = entries.filter(e => e.source === 'combined');

    const avgLatency = obsidianEvents.length > 0
      ? obsidianEvents.reduce((s, e) => s + (e.latency_ms ?? 0), 0) / obsidianEvents.length
      : 0;

    const khojWithLatency = khojEvents.filter(e => (e.khoj_latency_ms ?? e.latency_ms) != null);
    const avgKhojLatencyMs = khojWithLatency.length > 0
      ? khojWithLatency.reduce((s, e) => s + (e.khoj_latency_ms ?? e.latency_ms ?? 0), 0) / khojWithLatency.length
      : 0;
    const totalKhojResults = khojEvents.reduce((s, e) => s + (e.khoj_results ?? 0), 0);

    const totalInjections = entries.filter(e => e.event === 'context_injected').length;
    const totalNoMatch = entries.filter(e => e.event === 'no_match').length;
    const hitRate = (totalInjections + totalNoMatch) > 0
      ? (totalInjections / (totalInjections + totalNoMatch)) * 100
      : 0;

    const totalBytesInjected = entries.reduce((s, e) => s + (e.bytes_injected ?? 0), 0);
    const totalFilesInjected = entries.reduce((s, e) => s + (e.files_injected ?? 0), 0);

    const obsidianBytes = entries.filter(e => e.source === 'obsidian' || e.source === 'obsidian-turn-lookup' || e.source === 'obsidian-session-start').reduce((s, e) => s + (e.bytes_injected ?? 0), 0);
    const khojBytes = entries.filter(e => e.source === 'khoj').reduce((s, e) => s + (e.bytes_injected ?? 0), 0);
    const graphifyBytes = entries.filter(e => e.source === 'graphify').reduce((s, e) => s + (e.bytes_injected ?? 0), 0);

    // Hourly activity for chart (last 48 hours)
    const hourlyActivity: { hour: string; obsidian: number; khoj: number; graphify: number }[] = [];
    for (let i = 47; i >= 0; i--) {
      const hourStart = new Date(now - i * 3600000);
      const hourEnd = new Date(now - (i - 1) * 3600000);
      const hourStr = hourStart.toISOString().slice(0, 13) + ':00';
      const hourEntries = entries.filter(e => {
        const t = new Date(e.timestamp).getTime();
        return t >= hourStart.getTime() && t < hourEnd.getTime();
      });
      hourlyActivity.push({
        hour: hourStr,
        obsidian: hourEntries.filter(e => e.source?.startsWith('obsidian') || e.source === 'obsidian').length,
        khoj: hourEntries.filter(e => e.source === 'khoj').length,
        graphify: hourEntries.filter(e => e.source === 'graphify').length,
      });
    }

    // Top matched files
    const fileCounts: Record<string, number> = {};
    entries.forEach(e => {
      (e.files_matched ?? []).forEach(f => {
        const short = f.split('/').slice(-2).join('/');
        fileCounts[short] = (fileCounts[short] ?? 0) + 1;
      });
    });
    const topFiles = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    return NextResponse.json({
      integrations: {
        workspace: health.workspaceDir,
        obsidian: health.obsidianVaultPath,
        graphify: health.graphifyDir,
        khoj: health.khoj,
      },
      vault: { notes: vaultNotes, decisions: vaultDecisions, sessions: vaultSessions, projects: vaultProjects },
      graphify: { nodes: graphNodes, edges: graphEdges, communities: graphCommunities },
      khoj: { online: khojOnline, avgLatencyMs: Math.round(avgKhojLatencyMs), totalResults: totalKhojResults },
      telemetry: {
        totalEntries: entries.length,
        last24h: last24h.length,
        last7d: last7d.length,
        hitRate,
        avgLatencyMs: Math.round(avgLatency),
        totalInjections,
        totalNoMatch,
        totalBytesInjected,
        totalFilesInjected,
        obsidianBytesInjected: obsidianBytes,
        khojBytesInjected: khojBytes,
        graphifyBytesInjected: graphifyBytes,
        contextTokens: {
          obsidian: Math.ceil(obsidianBytes / 4),
          khoj: Math.ceil(khojBytes / 4),
          graphify: Math.ceil(graphifyBytes / 4),
          total: Math.ceil((obsidianBytes + khojBytes + graphifyBytes) / 4),
        },
        obsidianEvents: obsidianEvents.length,
        obsidianHitRate: obsidianEvents.length > 0 ? Math.round(obsidianEvents.filter(e => e.event === 'context_injected').length / obsidianEvents.length * 100) : 0,
        khojEvents: khojEvents.length,
        khojHitRate: khojEvents.length > 0 ? Math.round(khojEvents.filter(e => e.event === 'context_injected').length / khojEvents.length * 100) : 0,
        graphifyEvents: graphifyEvents.length,
        graphifyHitRate: graphifyEvents.length > 0 ? Math.round(graphifyEvents.filter(e => e.event === 'context_injected').length / graphifyEvents.length * 100) : 0,
      },
      hourlyActivity,
      topFiles,
    });
  } catch (error) {
    console.error('second-brain API error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

function countFiles(dir: string, ext: string): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) walk(path.join(d, entry.name));
        else if (entry.isFile() && entry.name.endsWith(ext)) count++;
      }
    };
    walk(dir);
    return count;
  } catch { return 0; }
}
