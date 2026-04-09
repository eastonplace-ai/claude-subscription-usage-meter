const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.default = async function notarize(context) {
  if (process.platform !== 'darwin') return;
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    console.log(
      '[notarize] Skipping notarization. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to enable it.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.log(`[notarize] Skipping notarization because ${appPath} was not found.`);
    return;
  }

  const zipPath = path.join(os.tmpdir(), `${appName}-${Date.now()}.zip`);

  console.log(`[notarize] Creating notarization archive for ${appPath}`);
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], {
    stdio: 'inherit',
  });

  console.log('[notarize] Submitting archive to Apple notary service');
  execFileSync(
    'xcrun',
    [
      'notarytool',
      'submit',
      zipPath,
      '--apple-id',
      appleId,
      '--password',
      applePassword,
      '--team-id',
      teamId,
      '--wait',
    ],
    { stdio: 'inherit' },
  );

  console.log('[notarize] Stapling notarization ticket');
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
};
