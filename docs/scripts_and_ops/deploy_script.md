# Deployment Guide

## Overview

This project uses an automated deployment script (`scripts/deploy.mjs`) that handles the full deployment pipeline via SSH.

## Prerequisites

- Node.js 18+ with npm/pnpm installed
- SSH access to the production server (`root@146.190.102.65`)
- Dependencies installed: `node-ssh`, `ssh2` (already in root `package.json`)

## Complete Deployment Workflow

### Step 1: Make Changes
Edit the code in your local development environment.

### Step 2: Test Locally
```bash
# Run proxy in development mode
pnpm --filter proxy dev

# Run dashboard in development mode
pnpm --filter dashboard dev
```

### Step 3: Commit Changes
```bash
git add .
git commit -m "description of changes"
```

### Step 4: Push to GitHub
```bash
git push origin main
```

### Step 5: Deploy to Server
```bash
node scripts/deploy.mjs
```

The script will:
1. Connect to server via SSH
2. Git sync (fetch + reset hard to match main)
3. Install dependencies (`pnpm install`)
4. Build proxy package (`npx tsc`)
5. Restart PM2 services (`pm2 restart proxy-api discord-bot`)
6. Display PM2 status

### Step 6: Verify Deployment
Check that both services are online:
```bash
ssh root@146.190.102.65 "pm2 status"
```

## Manual Deployment (Alternative)

If the automated script fails, you can deploy manually:

```bash
# SSH into server
ssh root@146.190.102.65

# Navigate to project
cd /root/proxy-log

# Pull latest changes
git fetch --all
git reset --hard origin/main

# Install dependencies
pnpm install

# Build proxy
pnpm --filter proxy build

# Restart services
pm2 restart proxy-api discord-bot

# Verify
pm2 status
```

## Quick Rebuild (No Git Pull)

If you just need to rebuild without pulling new changes:

```bash
ssh root@146.190.102.65 "cd /root/proxy-log && pnpm --filter proxy build && pm2 restart proxy-api discord-bot"
```

## Database Migrations

If you've added new tables or changed the schema:

```bash
# SSH into server
ssh root@146.190.102.65

# Navigate to project
cd /root/proxy-log

# Run Drizzle migration
pnpm --filter proxy db:push
```

## Troubleshooting

### Build Fails
- Check TypeScript errors: `pnpm --filter proxy build` locally
- Verify all imports are correct

### Services Won't Start
- Check PM2 logs: `pm2 logs proxy-api --lines 50`
- Verify PostgreSQL is running: `systemctl status postgresql`

### SSH Connection Issues
- Verify server IP and credentials
- Check if SSH key auth is configured
- Try manual SSH: `ssh root@146.190.102.65`

### Deployment Script Hangs
- The script uses SSH which may timeout on slow connections
- Try running commands manually via SSH instead