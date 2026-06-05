# CLAUDE.md - AI Agent Guide for monit_api (Groupy Proxy)

## Project Overview

monit_api is an AI request interception, routing engine, and management system. It is a monorepo with three main packages:

- **proxy** (packages/proxy/): Hono/Node.js API gateway that routes AI requests to upstream providers
- **bot** (packages/bot/): Discord.js bot for user management and administration
- **dashboard** (packages/dashboard/): React/Vite dashboard for visualization and configuration

## Quick Start

`ash
pnpm install
pnpm --filter proxy dev
pnpm --filter dashboard dev
pnpm --filter bot dev
`

## Git Workflow

`ash
git add .
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m 'description of changes'
git push origin main
node scripts/deploy.mjs
`

## Server Deployment

- Server: root@146.190.102.65
- Deploy script: node scripts/deploy.mjs
- Manual rebuild: cd /root/proxy-log && git pull && pnpm --filter proxy build && pm2 restart proxy-api

## Documentation

All documentation is in the docs/ folder:
- docs/architecture/ - System design and component breakdowns
- docs/database/ - Schema and model documentation
- docs/features/ - Feature deep dives
- docs/scripts_and_ops/ - Deployment and maintenance guides

## Stack

- Backend: Hono + Drizzle ORM + PostgreSQL
- Frontend: React + Vite + Recharts + Tailwind CSS
- Bot: Discord.js
- Database: PostgreSQL at localhost:5432, db=monit_api, user=monit_api

## Key Files

- packages/proxy/src/routes/proxy.ts - Main proxy route handler
- packages/proxy/src/utils/model-catalog.ts - Model catalog and routing
- packages/proxy/src/utils/model-metadata-fallback.ts - Model metadata fallback data
- packages/proxy/src/db/schema.ts - Database schema
- packages/bot/src/index.js - Discord bot
- packages/dashboard/src/components/ProvidersManager.tsx - Provider management UI

## Common Tasks

### Adding a new provider
1. Go to Dashboard > Settings > Upstream Providers
2. Fill in Name, Endpoint URL, Type, Priority, API Key
3. Click Add

### Adding a custom model to a provider
1. Go to Dashboard > Settings > Upstream Providers
2. Expand the provider
3. Click Custom Models to expand
4. Fill in Model ID, Display Name, Context Length, Pricing
5. Click Add

### Deploying changes
`ash
git add .
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m 'description'
git push origin main
node scripts/deploy.mjs
`

## Conventions

- Use TypeScript for all backend code
- Use React functional components with hooks
- Use Tailwind CSS for styling
- Follow existing code patterns in the codebase
- All database migrations use Drizzle ORM schema definitions
- API endpoints follow REST conventions

## Important Notes

- The proxy handles both OpenAI and Anthropic API formats
- Model routing uses provider prefixes (e.g., tokito/glm-5.1)
- Custom models can be added per provider via the dashboard
- The Discord bot shows model status and allows user management
- All requests are logged to PostgreSQL for analytics
