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

  // 2. Install dependencies (optional but safe)
  console.log('\n--- Checking dependencies ---');
  const pnpmInstall = await ssh.execCommand('pnpm install', { cwd: projectDir });
  if (pnpmInstall.stderr && !pnpmInstall.stderr.includes('WARN')) {
    // Ignore typical pnpm warnings
  } else {
    console.log('Dependencies up to date.');
  }

  // 3. Build Proxy & Dashboard
  console.log('\n--- Building proxy package ---');
  const build = await ssh.execCommand('npx tsc', { cwd: `${projectDir}/packages/proxy` });
  if (build.stderr) console.log('Build stderr:', build.stderr);
  console.log('Build completed.');

  console.log('\n--- Building dashboard ---');
  const buildDash = await ssh.execCommand('pnpm --filter dashboard build', { cwd: projectDir });
  if (buildDash.stderr) console.log('Dashboard build stderr:', buildDash.stderr);
  console.log('Dashboard build completed.');

  // 4. Update server .env RECAP_CHANNEL_ID
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

  // 5. Update DB admin_config agverif_channel_id (for bot dashboard settings)
  console.log('\n--- Updating DB admin_config ---');
  const dbUpdate = await ssh.execCommand(
    "sudo -u postgres psql -d monit_api -c \"UPDATE admin_config SET agverif_channel_id='1507648903900565514' WHERE id=1\" 2>&1"
  );
  console.log(dbUpdate.stdout || dbUpdate.stderr || 'No DB update output');

  // 6. Restart PM2 Services
  console.log('\n--- Restarting PM2 services ---');
  const restart = await ssh.execCommand('pm2 restart proxy-api discord-bot dashboard', { cwd: projectDir });
  console.log('Services restarted.');

  // 7. Verification
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
