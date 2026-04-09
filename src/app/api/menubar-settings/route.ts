import { NextResponse } from 'next/server';
import fs from 'fs';

function getSettingsDir() {
  const configuredDir = process.env.CLAUDE_USAGE_CONFIG_DIR?.trim();
  if (configuredDir) return configuredDir;

  const homeDir = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || '';
  return homeDir ? `${homeDir}/.claude-usage-dashboard` : '.claude-usage-dashboard';
}

function getSettingsFile() {
  return `${getSettingsDir()}/menubar-settings.json`;
}

const DEFAULT_SETTINGS = {
  enabled: true,
  showInMenubar: true,
  showFiveHour: true,
  showSevenDay: true,
  showSonnet: true,
  showCost: true,
  refreshInterval: 60,
};

function readSettings() {
  try {
    const settingsFile = getSettingsFile();
    if (!fs.existsSync(settingsFile)) {
      return DEFAULT_SETTINGS;
    }
    const raw = fs.readFileSync(settingsFile, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(data: typeof DEFAULT_SETTINGS) {
  const settingsDir = getSettingsDir();
  const settingsFile = getSettingsFile();
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET() {
  try {
    return NextResponse.json(readSettings());
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read menubar settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const current = readSettings();
    const updated = { ...current, ...body };
    writeSettings(updated);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save menubar settings' }, { status: 500 });
  }
}
