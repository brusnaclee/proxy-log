import { NodeSSH } from 'node-ssh';

const ssh = new NodeSSH();

async function main() {
  console.log('Connecting to server...');
  const SSH_PASSWORD = process.env.DEPLOY_SSH_PASSWORD;
  if (!SSH_PASSWORD) {
    console.error('Error: DEPLOY_SSH_PASSWORD environment variable is required');
    process.exit(1);
  }
  await ssh.connect({
    host: process.env.DEPLOY_SSH_HOST || '146.190.102.65',
    username: process.env.DEPLOY_SSH_USER || 'root',
    password: SSH_PASSWORD,
  });
  console.log('Connected!');

  const projectDir = '/root/proxy-log';

  // 1. Git Pull / Sync with GitHub
  console.log('\n--- Syncing with GitHub ---');
  // We use fetch and reset --hard to ensure the server exactly matches the repo
  // and discards any local modifications on the server
  const gitPull = await ssh.execCommand('git fetch --all && git reset --hard origin/main', { cwd: projectDir });
  console.log(gitPull.stdout || gitPull.stderr);

  // 2. Install dependencies (including new packages from git pull)
  console.log('\n--- Installing dependencies ---');
  const pnpmInstall = await ssh.execCommand('pnpm install', { cwd: projectDir });
  if (pnpmInstall.stderr && !pnpmInstall.stderr.includes('WARN')) {
    console.log('pnpm install stderr:', pnpmInstall.stderr);
  } else {
    console.log('Dependencies installed.');
  }

  // 3. Build Proxy, Dashboard, and Portal
  console.log('\n--- Building proxy package ---');
  const build = await ssh.execCommand('npx tsc', { cwd: `${projectDir}/packages/proxy` });
  if (build.stderr) console.log('Build stderr:', build.stderr);
  console.log('Build completed.');

  console.log('\n--- Building dashboard ---');
  const buildDash = await ssh.execCommand('pnpm --filter dashboard build', { cwd: projectDir });
  if (buildDash.stderr) console.log('Dashboard build stderr:', buildDash.stderr);
  console.log('Dashboard build completed.');

  console.log('\n--- Building portal ---');
  const buildPortal = await ssh.execCommand('pnpm --filter portal build 2>&1', { cwd: projectDir });
  console.log('Portal build:', (buildPortal.stdout || buildPortal.stderr || 'no output').trim());
  // Verify dist exists
  const distCheck = await ssh.execCommand('ls /root/proxy-log/packages/portal/dist/ 2>&1 | head -5');
  console.log('Portal dist:', distCheck.stdout || distCheck.stderr || 'NOT FOUND');

  // 4. Copy portal build to proxy public directory
  console.log('\n--- Copying portal to proxy public directory ---');
  // Check if dist exists first
  const distExists = await ssh.execCommand('test -d /root/proxy-log/packages/portal/dist && echo "EXISTS" || echo "NOT_EXISTS"');
  if (distExists.stdout?.includes("EXISTS")) {
    const copyPortal = await ssh.execCommand(
      `mkdir -p /root/proxy-log/packages/proxy/public/portal && ` +
      `cp -r /root/proxy-log/packages/portal/dist/. /root/proxy-log/packages/proxy/public/portal/ && ` +
      `echo "Portal copied OK"`,
      { cwd: projectDir }
    );
    console.log('Portal copy:', copyPortal.stdout || copyPortal.stderr);
  } else {
    console.log('WARNING: portal dist not found — skipping copy. Portal SPA will not be served.');
  }

  // 5. Update server .env RECAP_CHANNEL_ID
  console.log('\n--- Updating server .env ---');

  // Check if RECAP_CHANNEL_ID exists in .env
  const checkEnv = await ssh.execCommand("grep -c 'RECAP_CHANNEL_ID' /root/proxy-log/.env || echo '0'");
  const recapEnvExists = parseInt(checkEnv.stdout?.trim() || '0') > 0;

  let envUpdate;
  if (recapEnvExists) {
    // Replace existing value
    envUpdate = await ssh.execCommand(
      "sed -i 's/RECAP_CHANNEL_ID=.*/RECAP_CHANNEL_ID=1470313934752972993/' /root/proxy-log/.env && " +
      "echo 'Updated RECAP_CHANNEL_ID in .env'"
    );
  } else {
    // Add new line if not exists
    envUpdate = await ssh.execCommand(
      "echo 'RECAP_CHANNEL_ID=1470313934752972993' >> /root/proxy-log/.env && " +
      "echo 'Added RECAP_CHANNEL_ID to .env'"
    );
  }
  console.log(envUpdate.stdout || envUpdate.stderr || 'No .env update output');

  // Preferred recap narrative model (reliable published model; not "auto")
  const recapModelUpdate = await ssh.execCommand(
    "grep -q '^RECAP_MODEL=' /root/proxy-log/.env && " +
      "sed -i 's|^RECAP_MODEL=.*|RECAP_MODEL=phantomv2/amanai/claude-haiku-4.5|' /root/proxy-log/.env || " +
      "echo 'RECAP_MODEL=phantomv2/amanai/claude-haiku-4.5' >> /root/proxy-log/.env; " +
      "echo 'Updated RECAP_MODEL'",
  );
  console.log(recapModelUpdate.stdout || recapModelUpdate.stderr || "");

  // Token multipliers: input 1x (full prompt), output 10x
  const multUpdate = await ssh.execCommand(
    "grep -q '^INPUT_TOKEN_MULTIPLIER=' /root/proxy-log/.env && " +
      "sed -i 's/^INPUT_TOKEN_MULTIPLIER=.*/INPUT_TOKEN_MULTIPLIER=1/' /root/proxy-log/.env || " +
      "echo 'INPUT_TOKEN_MULTIPLIER=1' >> /root/proxy-log/.env; " +
    "grep -q '^OUTPUT_TOKEN_MULTIPLIER=' /root/proxy-log/.env && " +
      "sed -i 's/^OUTPUT_TOKEN_MULTIPLIER=.*/OUTPUT_TOKEN_MULTIPLIER=10/' /root/proxy-log/.env || " +
      "echo 'OUTPUT_TOKEN_MULTIPLIER=10' >> /root/proxy-log/.env; " +
    "echo 'Updated token multipliers (in=1 out=10)'"
  );
  console.log(multUpdate.stdout || multUpdate.stderr || '');

  // Ensure token_input_mode=per_turn_peak in DB (fair agent accounting)
  const modeUpdate = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_input_mode text NOT NULL DEFAULT 'per_turn_peak'; UPDATE admin_config SET token_input_mode='per_turn_peak' WHERE id=1;\" 2>&1"
  );
  console.log(modeUpdate.stdout || modeUpdate.stderr || '');

  // Dual quotas + vibecode duration defaults + roles / trial mode migration
  const quotaUpdate = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_window_start text; ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_limit_weight_percent integer NOT NULL DEFAULT 10; ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS addon_required_models text NOT NULL DEFAULT '[]'; ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS pro_role_id text DEFAULT '1354682701453725857'; ALTER TABLE addons ADD COLUMN IF NOT EXISTS default_duration_days integer NOT NULL DEFAULT 0; UPDATE admin_config SET trial_model_selection_mode = 'all' WHERE trial_model_selection_mode = 'all_gpy'; UPDATE addons SET default_duration_days = 15 WHERE name = 'vibecode-5m' AND COALESCE(default_duration_days,0) = 0; UPDATE addons SET default_duration_days = 30 WHERE name = 'vibecode-10m' AND COALESCE(default_duration_days,0) = 0; UPDATE addons SET is_active = false WHERE name = 'vibecode-3m';\" 2>&1"
  );
  console.log(quotaUpdate.stdout || quotaUpdate.stderr || '');

  // Auth sessions table (admin + portal login; monit_api may lack CREATE privilege)
  const authSessionsSql = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"CREATE TABLE IF NOT EXISTS auth_sessions (id SERIAL PRIMARY KEY, session_hash TEXT NOT NULL, kind TEXT NOT NULL, discord_user_id TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(), ip TEXT, user_agent TEXT); CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions (session_hash); CREATE INDEX IF NOT EXISTS idx_auth_sessions_kind_user ON auth_sessions (kind, discord_user_id); CREATE INDEX IF NOT EXISTS idx_auth_sessions_created ON auth_sessions (created_at); GRANT ALL PRIVILEGES ON TABLE auth_sessions TO monit_api; GRANT USAGE, SELECT ON SEQUENCE auth_sessions_id_seq TO monit_api;\" 2>&1"
  );
  console.log(authSessionsSql.stdout || authSessionsSql.stderr || '');

  // 6. Update DB admin_config agverif_channel_id (for bot dashboard settings)
  console.log('\n--- Updating DB admin_config ---');
  const dbUpdate = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"UPDATE admin_config SET agverif_channel_id='1507648903900565514' WHERE id=1\" 2>&1"
  );
  console.log(dbUpdate.stdout || dbUpdate.stderr || 'No DB update output');

  // 6b. Fix gpy provider API key (prefer non-limited, else any active key)
  console.log('\n--- Fixing gpy provider API key ---');
  const gpyKeyUpdate = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"UPDATE providers SET api_key = COALESCE((SELECT api_key FROM provider_api_keys WHERE provider_id = (SELECT id FROM providers WHERE name='gpy') AND is_active = true AND is_limited = false ORDER BY request_count ASC LIMIT 1), (SELECT api_key FROM provider_api_keys WHERE provider_id = (SELECT id FROM providers WHERE name='gpy') AND is_active = true ORDER BY request_count ASC LIMIT 1), api_key) WHERE name = 'gpy'\" 2>&1"
  );
  console.log(gpyKeyUpdate.stdout || gpyKeyUpdate.stderr || 'No gpy key update output');

  // 7. Restart PM2 Services
  console.log('\n--- Restarting PM2 services ---');
  const restart = await ssh.execCommand('pm2 restart proxy-api discord-bot dashboard', { cwd: projectDir });
  console.log('Services restarted.');

  // 8. Verification
  await new Promise(r => setTimeout(r, 2000));
  const status = await ssh.execCommand('pm2 status');
  console.log('\n--- PM2 Status ---');
  // Only show the proxy and bot lines to keep output clean
  const statusLines = status.stdout.split('\n').filter(line => line.includes('proxy-api') || line.includes('discord-bot') || line.includes('dashboard') || line.includes('name'));
  console.log(statusLines.join('\n'));

  ssh.dispose();
  console.log('\nDeployment finished successfully!');
}

main().catch(err => {
  console.error('Deployment Error:', err.message);
  process.exit(1);
});
