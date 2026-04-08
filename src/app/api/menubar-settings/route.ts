import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SETTINGS_DIR = path.join(os.homedir(), '.claude-usage-dashboard');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'menubar-settings.json');

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
    if (!fs.existsSync(SETTINGS_FILE)) {
      return DEFAULT_SETTINGS;
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(data: typeof DEFAULT_SETTINGS) {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
