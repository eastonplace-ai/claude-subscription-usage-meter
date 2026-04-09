import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

export const APP_SUPPORT_DIR =
  process.env.CLAUDE_USAGE_CONFIG_DIR || path.join(os.homedir(), '.claude-usage-dashboard');
export const APP_SETTINGS_FILE = path.join(APP_SUPPORT_DIR, 'app-settings.json');
export const MENUBAR_SETTINGS_FILE = path.join(APP_SUPPORT_DIR, 'menubar-settings.json');
export const SECRET_MASK = '••••••••';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_KHOJ_URL = 'http://localhost:42110';
const DISABLE_ENV_FALLBACK = process.env.CLAUDE_USAGE_DISABLE_ENV_FALLBACK === '1';

export interface StoredAppConfig {
  workspaceDir?: string;
  obsidianVaultPath?: string;
  khojUrl?: string;
  khojApiKey?: string;
  tokenLogPath?: string;
  usageCachePath?: string;
  graphifyDir?: string;
  lastMigratedAt?: string;
  migrationSources?: string[];
}

export interface AppConfig {
  workspaceDir: string;
  obsidianVaultPath: string;
  khojUrl: string;
  khojApiKey: string;
  tokenLogPath: string;
  usageCachePath: string;
  graphifyDir: string;
  lastMigratedAt?: string;
  migrationSources?: string[];
}

export interface PublicAppConfig {
  workspaceDir: string;
  obsidianVaultPath: string;
  khojUrl: string;
  khojApiKey: string;
  tokenLogPath: string;
  usageCachePath: string;
  graphifyDir: string;
}

export interface PathHealth {
  configured: boolean;
  available: boolean;
  path: string;
  details: string;
}

export interface UrlHealth {
  configured: boolean;
  online: boolean;
  url: string;
  details: string;
}

export interface AppConfigHealth {
  workspaceDir: PathHealth;
  tokenLogPath: PathHealth;
  usageCachePath: PathHealth;
  obsidianVaultPath: PathHealth;
  graphifyDir: PathHealth;
  khoj: UrlHealth;
}

export interface AppConfigResponse {
  config: PublicAppConfig;
  health: AppConfigHealth;
  supportDir: string;
  settingsFile: string;
  migrated: boolean;
}

function normalizeValue(value: string | undefined): string {
  return (value ?? '').trim();
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = normalizeValue(value);
    if (normalized) return normalized;
  }
  return '';
}

function parseEnvLines(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function pathExists(targetPath: string): Promise<boolean> {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureSupportDir(): Promise<void> {
  await fs.mkdir(APP_SUPPORT_DIR, { recursive: true });
}

async function readStoredAppConfig(): Promise<StoredAppConfig> {
  try {
    const raw = await fs.readFile(APP_SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw) as StoredAppConfig;
  } catch {
    return {};
  }
}

async function readDotEnvLocal(): Promise<Record<string, string>> {
  if (DISABLE_ENV_FALLBACK) return {};
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, '.env.local'), 'utf-8');
    return parseEnvLines(raw);
  } catch {
    return {};
  }
}

async function readLegacyWorkspaceDir(): Promise<string> {
  const candidates = [
    path.join(PROJECT_ROOT, 'src/lib/claude-reader.ts'),
    path.join(PROJECT_ROOT, 'lib/claude-reader.ts'),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const match = raw.match(/const WORKSPACE_DIR\s*=\s*['"]([^'"]+)['"]/);
      if (match?.[1]) return match[1];
    } catch {
      // ignore
    }
  }

  return '';
}

async function choosePreferredPath(...candidates: Array<string | undefined>): Promise<string> {
  const normalized = candidates.map((candidate) => normalizeValue(candidate)).filter(Boolean);
  for (const candidate of normalized) {
    if (await pathExists(candidate)) return candidate;
  }
  return normalized[0] ?? '';
}

function normalizeStoredConfig(config: StoredAppConfig): StoredAppConfig {
  const normalized: StoredAppConfig = {};
  const keys: Array<keyof StoredAppConfig> = [
    'workspaceDir',
    'obsidianVaultPath',
    'khojUrl',
    'khojApiKey',
    'tokenLogPath',
    'usageCachePath',
    'graphifyDir',
    'lastMigratedAt',
  ];

  for (const key of keys) {
    const value = normalizeValue(config[key] as string | undefined);
    if (value) normalized[key] = value as never;
  }

  if (config.migrationSources?.length) {
    normalized.migrationSources = [...new Set(config.migrationSources.filter(Boolean))];
  }

  return normalized;
}

async function deriveResolvedConfig(stored: StoredAppConfig): Promise<{
  config: AppConfig;
  migrated: boolean;
}> {
  const envFile = await readDotEnvLocal();
  const legacyWorkspaceDir = await readLegacyWorkspaceDir();
  const migrationSources = new Set<string>(stored.migrationSources ?? []);

  const envWorkspaceDir = DISABLE_ENV_FALLBACK
    ? ''
    : firstNonEmpty(process.env.WORKSPACE_DIR, envFile.WORKSPACE_DIR);
  const workspaceDir = firstNonEmpty(stored.workspaceDir, envWorkspaceDir, legacyWorkspaceDir);
  if (workspaceDir) {
    if (stored.workspaceDir) migrationSources.add('app-settings');
    else if (envWorkspaceDir) migrationSources.add('env');
    else if (legacyWorkspaceDir) migrationSources.add('legacy-source');
  }

  const obsidianVaultPath = firstNonEmpty(
    stored.obsidianVaultPath,
    DISABLE_ENV_FALLBACK ? '' : process.env.OBSIDIAN_VAULT_PATH,
    envFile.OBSIDIAN_VAULT_PATH,
  );
  if (obsidianVaultPath) {
    migrationSources.add(stored.obsidianVaultPath ? 'app-settings' : 'env');
  }

  const khojUrl = firstNonEmpty(
    stored.khojUrl,
    DISABLE_ENV_FALLBACK ? '' : process.env.KHOJ_URL,
    envFile.KHOJ_URL,
    DEFAULT_KHOJ_URL,
  );
  const khojApiKey = firstNonEmpty(
    stored.khojApiKey,
    DISABLE_ENV_FALLBACK ? '' : process.env.KHOJ_API_KEY,
    envFile.KHOJ_API_KEY,
  );

  const homeClaudeAgentsDir = path.join(os.homedir(), '.claude', 'agents');
  const workspaceAgentsDir = workspaceDir ? path.join(workspaceDir, '.claude', 'agents') : '';
  const tokenLogPath = await choosePreferredPath(
    stored.tokenLogPath,
    DISABLE_ENV_FALLBACK ? '' : process.env.TOKEN_LOG_PATH,
    envFile.TOKEN_LOG_PATH,
    workspaceAgentsDir ? path.join(workspaceAgentsDir, 'token-log.jsonl') : '',
    path.join(homeClaudeAgentsDir, 'token-log.jsonl'),
  );

  const usageCachePath = await choosePreferredPath(
    stored.usageCachePath,
    path.dirname(tokenLogPath || workspaceAgentsDir || homeClaudeAgentsDir)
      ? path.join(path.dirname(tokenLogPath || path.join(homeClaudeAgentsDir, 'token-log.jsonl')), 'usage-pct-cache.json')
      : '',
    workspaceAgentsDir ? path.join(workspaceAgentsDir, 'usage-pct-cache.json') : '',
    path.join(homeClaudeAgentsDir, 'usage-pct-cache.json'),
  );

  const graphifyDir = firstNonEmpty(
    stored.graphifyDir,
    path.join(PROJECT_ROOT, 'graphify-out'),
  );

  const baseConfig: AppConfig = {
    workspaceDir,
    obsidianVaultPath,
    khojUrl,
    khojApiKey,
    tokenLogPath,
    usageCachePath,
    graphifyDir,
    migrationSources: Array.from(migrationSources),
  };

  const normalizedStored = normalizeStoredConfig(stored);
  const normalizedBase = normalizeStoredConfig(baseConfig);
  const needsMigration = JSON.stringify(normalizedStored) !== JSON.stringify(normalizedBase);
  const nextConfig: AppConfig = {
    ...baseConfig,
    lastMigratedAt: needsMigration
      ? new Date().toISOString()
      : stored.lastMigratedAt,
  };
  const normalizedNext = normalizeStoredConfig(nextConfig);
  const migrated = JSON.stringify(normalizedStored) !== JSON.stringify(normalizedNext);

  if (migrated) {
    await ensureSupportDir();
    await fs.writeFile(APP_SETTINGS_FILE, `${JSON.stringify(normalizedNext, null, 2)}\n`, 'utf-8');
  }

  return { config: nextConfig, migrated };
}

export async function getAppConfig(): Promise<AppConfig> {
  const stored = await readStoredAppConfig();
  const { config } = await deriveResolvedConfig(stored);
  return config;
}

export async function updateAppConfig(nextValues: Partial<StoredAppConfig>): Promise<AppConfig> {
  const current = await readStoredAppConfig();
  const merged: StoredAppConfig = { ...current };

  for (const [key, value] of Object.entries(nextValues) as Array<[keyof StoredAppConfig, string | undefined]>) {
    const normalized = normalizeValue(value);
    if (key === 'khojApiKey' && normalized === SECRET_MASK) {
      continue;
    }
    if (normalized) {
      merged[key] = normalized as never;
    } else {
      delete merged[key];
    }
  }

  await ensureSupportDir();
  await fs.writeFile(
    APP_SETTINGS_FILE,
    `${JSON.stringify(normalizeStoredConfig(merged), null, 2)}\n`,
    'utf-8',
  );

  return getAppConfig();
}

function maskSecret(value: string): string {
  return value ? SECRET_MASK : '';
}

export function toPublicAppConfig(config: AppConfig): PublicAppConfig {
  return {
    workspaceDir: config.workspaceDir,
    obsidianVaultPath: config.obsidianVaultPath,
    khojUrl: config.khojUrl,
    khojApiKey: maskSecret(config.khojApiKey),
    tokenLogPath: config.tokenLogPath,
    usageCachePath: config.usageCachePath,
    graphifyDir: config.graphifyDir,
  };
}

function describePathHealth(label: string, configured: boolean, available: boolean): string {
  if (!configured) return `${label} is not configured`;
  if (!available) return `${label} was configured but not found`;
  return `${label} is available`;
}

async function buildPathHealth(targetPath: string, label: string): Promise<PathHealth> {
  const configured = Boolean(normalizeValue(targetPath));
  const available = configured ? await pathExists(targetPath) : false;
  return {
    configured,
    available,
    path: targetPath,
    details: describePathHealth(label, configured, available),
  };
}

async function checkKhoj(url: string, apiKey: string): Promise<UrlHealth> {
  const configured = Boolean(normalizeValue(url));
  if (!configured) {
    return {
      configured: false,
      online: false,
      url,
      details: 'Khoj is not configured',
    };
  }

  try {
    const healthResponse = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (healthResponse.ok) {
      return {
        configured: true,
        online: true,
        url,
        details: 'Khoj responded to /api/health',
      };
    }
  } catch {
    // fall through to authenticated probe
  }

  try {
    const response = await fetch(`${url}/api/config/data/default`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(2000),
    });
    return {
      configured: true,
      online: response.ok,
      url,
      details: response.ok
        ? 'Khoj responded to config probe'
        : `Khoj returned HTTP ${response.status}`,
    };
  } catch {
    return {
      configured: true,
      online: false,
      url,
      details: 'Khoj did not respond',
    };
  }
}

export async function getAppConfigHealth(config?: AppConfig): Promise<AppConfigHealth> {
  const resolved = config ?? (await getAppConfig());
  const [workspaceDir, tokenLogPath, usageCachePath, obsidianVaultPath, graphifyDir, khoj] =
    await Promise.all([
      buildPathHealth(resolved.workspaceDir, 'Workspace directory'),
      buildPathHealth(resolved.tokenLogPath, 'Token log'),
      buildPathHealth(resolved.usageCachePath, 'Usage cache'),
      buildPathHealth(resolved.obsidianVaultPath, 'Obsidian vault'),
      buildPathHealth(resolved.graphifyDir, 'Graphify output'),
      checkKhoj(resolved.khojUrl, resolved.khojApiKey),
    ]);

  return {
    workspaceDir,
    tokenLogPath,
    usageCachePath,
    obsidianVaultPath,
    graphifyDir,
    khoj,
  };
}

export async function getAppConfigResponse(): Promise<AppConfigResponse> {
  const stored = await readStoredAppConfig();
  const { config, migrated } = await deriveResolvedConfig(stored);
  const health = await getAppConfigHealth(config);

  return {
    config: toPublicAppConfig(config),
    health,
    supportDir: APP_SUPPORT_DIR,
    settingsFile: APP_SETTINGS_FILE,
    migrated,
  };
}
