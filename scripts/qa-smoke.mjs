import process from 'process';

const args = new Set(process.argv.slice(2));
const scenarioArg = process.argv.find((value) => value.startsWith('--scenario='));
const scenarioIndex = process.argv.indexOf('--scenario');
const scenario =
  scenarioArg
    ? scenarioArg.split('=')[1]
    : scenarioIndex >= 0 && process.argv[scenarioIndex + 1]
      ? process.argv[scenarioIndex + 1]
      : 'current';
const baseUrl =
  process.env.QA_BASE_URL || `http://127.0.0.1:${process.env.CLAUDE_USAGE_PORT || '3099'}`;

const endpoints = [
  '/',
  '/activity',
  '/agents',
  '/history',
  '/plans',
  '/projects',
  '/rate-limits',
  '/second-brain',
  '/sessions',
  '/settings',
  '/tools',
  '/menubar',
  '/api/app-settings',
  '/api/activity',
  '/api/agents?hours=5',
  '/api/cc-status',
  '/api/costs',
  '/api/history',
  '/api/menubar-settings',
  '/api/plans',
  '/api/projects',
  '/api/rate-limits',
  '/api/second-brain',
  '/api/sessions',
  '/api/settings',
  '/api/tools',
  '/api/usage-live',
];

async function fetchWithTiming(endpoint) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${endpoint}`);
  const elapsedMs = performance.now() - startedAt;
  return { endpoint, response, elapsedMs };
}

async function main() {
  console.log(`[qa] Scenario: ${scenario}`);
  console.log(`[qa] Base URL: ${baseUrl}`);

  let hasFailure = false;
  for (const endpoint of endpoints) {
    try {
      const { response, elapsedMs } = await fetchWithTiming(endpoint);
      const ok = response.ok;
      const prefix = ok ? 'PASS' : 'FAIL';
      console.log(
        `[qa] ${prefix.padEnd(4)} ${String(Math.round(elapsedMs)).padStart(5)}ms ${endpoint}`,
      );
      if (!ok) {
        hasFailure = true;
      }
    } catch (error) {
      hasFailure = true;
      console.log(
        `[qa] FAIL ${endpoint} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  try {
    const response = await fetch(`${baseUrl}/api/app-settings`);
    if (response.ok) {
      const payload = await response.json();
      const health = payload.health ?? {};
      const heavyEndpoints = ['/api/projects', '/api/tools'];
      console.log('[qa] Health summary:');
      for (const [label, value] of Object.entries(health)) {
        if (!value || typeof value !== 'object') continue;
        const status =
          'available' in value
            ? value.available
              ? 'ready'
              : value.configured
                ? 'missing'
                : 'off'
            : value.online
              ? 'online'
              : value.configured
                ? 'offline'
                : 'off';
        console.log(`[qa]   ${label}: ${status}`);
      }
      console.log(`[qa] Heavy endpoints monitored: ${heavyEndpoints.join(', ')}`);
    }
  } catch {
    // ignore secondary reporting errors
  }

  if (args.has('--strict') && hasFailure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[qa] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
