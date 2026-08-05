# Monit API Documentation Index

Welcome to the comprehensive documentation for the Monit API, an AI request interception, routing engine, and management system.

## For AI Agents

**Start here**: [CLAUDE.md](../CLAUDE.md) - Quick reference guide for AI agents working on this project.

## Project Structure
This project is a monorepo consisting of three main packages:
- **`proxy`**: The core Hono/Node.js API gateway.
- **`bot`**: The Discord.js bot for user management and administration.
- **`dashboard`**: A React/Vite dashboard for visualization and configuration.

## Documentation Directory

### Architecture (`/architecture`)
High-level system designs and component breakdowns.
- [System Overview](architecture/system_overview.md)
- [Discord Bot Architecture](architecture/discord_bot.md)
- [Dashboard Architecture](architecture/dashboard.md)
- [_Template](architecture/_template.md)

### Database (`/database`)
Details about the SQLite schema, models, and data flows.
- [Schema and Models](database/schema_and_models.md)
- [_Template](database/_template.md)

### Features (`/features`)
Deep dives into specific functionalities and integrations.
- [Discord Bot Integration](features/discord_bot_integration.md)
- [Rate Limiting and Tokens](features/rate_limiting_and_tokens.md)
- [Usage Display Sync (shared vs per-key)](features/usage_display_sync.md)
- [Key Access Lifecycle (Phantom / Pro / Add-on)](features/key_access_lifecycle.md)
- [Reset Timestamp Display Sync](features/reset_timestamp_display.md)
- [Token Input Modes (peak / full / billable)](features/token_input_modes.md)
- [Custom Models per Provider](features/custom_models.md)
- [Quota Guard](features/quota_guard.md)
- [_Template](features/_template.md)

### Scripts and Operations (`/scripts_and_ops`)
Guides for deploying, maintaining, and developing the application.
- [Deployment Guide](scripts_and_ops/deployment_guide.md)
- [Deployment Script](scripts_and_ops/deploy_script.md)
- [Maintenance and Background Tasks](scripts_and_ops/maintenance.md)
- [_Template](scripts_and_ops/_template.md)