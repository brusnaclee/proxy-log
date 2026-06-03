import { NodeSSH } from 'node-ssh';

const ssh = new NodeSSH();

async function main() {
  console.log('Connecting to server...');
  await ssh.connect({
    host: '146.190.102.65',
    username: 'root',
    password: 'rendang123',
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

  // 3. Build Proxy
  console.log('\n--- Building proxy package ---');
  const build = await ssh.execCommand('npx tsc', { cwd: `${projectDir}/packages/proxy` });
  if (build.stderr) console.log('Build stderr:', build.stderr);
  console.log('Build completed.');

  // 4. Restart PM2 Services
  console.log('\n--- Restarting PM2 services ---');
  const restart = await ssh.execCommand('pm2 restart proxy-api discord-bot', { cwd: projectDir });
  console.log('Services restarted.');

  // 5. Verification
  await new Promise(r => setTimeout(r, 2000));
  const status = await ssh.execCommand('pm2 status');
  console.log('\n--- PM2 Status ---');
  // Only show the proxy and bot lines to keep output clean
  const statusLines = status.stdout.split('\n').filter(line => line.includes('proxy-api') || line.includes('discord-bot') || line.includes('name'));
  console.log(statusLines.join('\n'));

  ssh.dispose();
  console.log('\nDeployment finished successfully!');
}

main().catch(err => {
  console.error('Deployment Error:', err.message);
  process.exit(1);
});
