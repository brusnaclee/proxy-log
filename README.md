# 🚀 Monit API — AI Proxy Gateway + Admin Dashboard + Discord Bot

> Self-hosted AI API proxy gateway dengan admin dashboard real-time, Discord bot verification, dan session/prompt tracking yang canggih.

## 📋 Daftar Isi

- [Architecture](#-architecture)
- [Features](#-features)
- [Quick Start (Local)](#-quick-start-local-development)
- [Environment Variables](#-environment-variables)
- [Hosting di VPS (Production)](#-hosting-di-vps-production-deployment)
- [Admin Dashboard Guide](#-admin-dashboard-guide)
- [API Key Management](#-api-key-management)
- [API Endpoints Reference](#-api-endpoints-reference)
- [Discord Bot](#-discord-bot)
- [Database & Backup](#-database--backup)

---

## 🏗 Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   IDE/Client │────▶│   Proxy Gateway  │────▶│  Upstream AI API  │
│ (Cursor, VS  │     │   (Hono + SQLite) │     │ (OpenAI, OpenRouter│
│  Code, dll)  │◀────│   Port 3000      │◀────│  Gemini, dll)     │
└──────────────┘     └────────┬─────────┘     └───────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
     │   Dashboard   │ │  Discord   │ │  SQLite DB  │
     │  (React+Vite) │ │    Bot     │ │ gateway.db  │
     │  Port 5173    │ │ (agverif)  │ │             │
     └───────────────┘ └────────────┘ └─────────────┘
```

**Monorepo Structure:**

```
monit_api/
├── packages/
│   ├── proxy/        # API proxy gateway (Hono + Drizzle + SQLite)
│   ├── dashboard/    # Admin web dashboard (React + Vite + Tailwind)
│   └── bot/          # Discord verification bot (discord.js)
├── scripts/          # Helper scripts
├── .env              # Environment configuration
└── package.json      # Root workspace config
```

---

## ✨ Features

### API Proxy Gateway
- **OpenAI-compatible proxy** — Forward semua request `/v1/*` ke upstream provider (OpenAI, OpenRouter, Gemini, dll)
- **Multi-model support** — Auto-detect provider dari upstream endpoint
- **Streaming support** — Full SSE streaming proxy dengan token counting
- **Model catalog** — Auto-fetch dan cache daftar model dari upstream
- **Retry logic** — Auto-retry upstream errors (429, 500, 502, 503, 504) dengan backoff

### Security & Access Control
- **API Key management** — Generate, rotate, enable/disable API keys
- **Device fingerprinting** — Track dan limit device per API key
- **Device policy** — Allowlist/blacklist per fingerprint
- **IP policy** — Allowlist/blacklist per IP address
- **IDE policy** — Allowlist/blacklist per IDE (Cursor, VS Code, Windsurf, dll)
- **Max devices limit** — Batasi jumlah device per key
- **Discord key revocation** — Auto-revoke jika multi-device terdeteksi pada Discord key

### Rate Limiting & Quotas
- **Request rate limit** — Per-request limit per time window (global & per-key)
- **Prompt-based limit** — Limit berdasarkan jumlah user prompt (bukan HTTP request). Agent yang melakukan 100x tool call tetap dihitung 1 prompt sampai user mengirim pesan baru
- **Monthly token limit** — Batas token bulanan per API key
- **Global & per-key override** — Setiap key bisa override setting global

### Observability & Analytics
- **Real-time log streaming** — SSE stream untuk live monitoring
- **Session tracking** — Grup request ke dalam chat sessions berdasarkan device + gap waktu
- **Prompt counting** — Hitung jumlah user prompt vs agent/tool requests
- **Context tracking** — Track context fingerprint, compact events, context switches
- **Cost estimation** — Estimasi biaya per request/session/key
- **Tool usage tracking** — Track tools yang digunakan oleh AI agent
- **CSV export** — Export log data ke CSV

### Admin Dashboard
- **Overview** — Statistik real-time (requests hari ini, total tokens, active keys, dll)
- **API Keys** — Full CRUD dengan detail analytics per key
- **Logs & Sessions** — Timeline view, filter, real-time streaming
- **Model Monitor** — Status online/offline model dari upstream
- **Settings** — Upstream config, global limits, password, factory reset
- **Analytics** — Top models, top devices, session analytics

### Discord Bot Integration
- **Auto-verification** — User verifikasi di Discord → auto-generate API key
- **Auto-provision** — DM user dengan endpoint + API key setelah verified
- **Auto-revoke** — Role dicabut / user keluar → key otomatis disabled
- **Admin commands** — Kontrol key/policy via Discord commands
- **AI photo verification** — Opsional auto-verify dengan Gemini AI
- **Tokito monitoring** — Integrasi model health monitoring

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Node.js** ≥ 18.0.0
- **pnpm** (install: `npm install -g pnpm`)

### Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd monit_api

# 2. Install dependencies
pnpm install

# 3. Setup environment
cp .env.example .env
# Edit .env sesuai kebutuhan (lihat bagian Environment Variables)

# 4. Jalankan semua service
pnpm dev
```

Ini akan menjalankan sekaligus:
- **Proxy API** → `http://localhost:3000`
- **Dashboard** → `http://localhost:5173`
- **Discord Bot** (jika BOT_TOKEN diisi)

### Login Dashboard

1. Buka `http://localhost:5173`
2. Login dengan password default: `admin`
3. **Segera ganti password** di halaman Settings!

### Test Proxy

```bash
# Buat API key di dashboard, lalu test:
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Konfigurasi IDE

Di IDE (Cursor, VS Code + Continue, dll), set:
- **API Base URL**: `http://localhost:3000/v1`
- **API Key**: API key yang dibuat di dashboard

---

## 🔧 Environment Variables

Buat file `.env` berdasarkan `.env.example`:

### Server

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `PORT` | `3000` | Port untuk proxy API server |
| `DASHBOARD_PORT` | `5173` | Port untuk dashboard (Vite dev server) |
| `DATABASE_URL` | `./data/gateway.db` | Path ke SQLite database file |
| `SESSION_SECRET` | - | Secret untuk session cookies (**wajib ganti di production!**) |
| `DEFAULT_ADMIN_PASSWORD` | `admin` | Password admin awal (hanya dipakai saat pertama kali) |

### API Proxy

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `UPSTREAM_ENDPOINT` | - | URL upstream API (e.g., `https://api.openai.com`, `https://openrouter.ai/api`) — bisa juga diset via dashboard |
| `UPSTREAM_API_KEY` | - | API key untuk upstream provider — bisa juga diset via dashboard |

### Internal Communication

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `INTERNAL_API_SECRET` | - | Shared secret untuk bot → proxy authentication (**wajib!**) |
| `PROXY_INTERNAL_BASE_URL` | `http://localhost:3000` | URL internal proxy (untuk bot) |
| `PROXY_PUBLIC_BASE_URL` | `http://localhost:3000` | URL publik proxy (dikirim ke user via DM) |

### Discord Bot

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `BOT_TOKEN` | - | Discord bot token |
| `AGVERIF_CHANNEL_ID` | - | Channel ID untuk verifikasi |
| `REQUIRED_ROLE_ID` | - | Role yang diperlukan untuk bisa verifikasi |
| `OWNER_GROUPY_ROLE_ID` | - | Role owner yang bisa administrasi |
| `VERIFIED_ROLE_ID` | - | Role yang diberikan setelah verifikasi berhasil |

### AI Verification (Opsional)

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `VERIF_AUTO` | `false` | Enable auto AI photo verification |
| `GOOGLE_API_KEY` ~ `GOOGLE_API_KEY11` | - | Gemini API key(s) untuk auto-verification |

### Model Monitoring (Tokito)

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `TOKITO_API_KEY` | - | API key untuk Tokito model monitoring |
| `TOKITO_CHANNEL_ID` | - | Discord channel untuk status updates |
| `TOKITO_BASE_URL` | `https://api.tokito.xyz/v1` | Tokito API base URL |
| `TOKITO_STATUS_INTERVAL_MS` | `3600000` | Interval check status (1 jam) |
| `TOKITO_LATENCY_INTERVAL_MS` | `600000` | Interval check latency (10 menit) |

---

## 🌐 Hosting di VPS (Production Deployment)

### 1. Persiapan VPS

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install pm2 (process manager)
npm install -g pm2

# Install nginx (reverse proxy)
sudo apt install -y nginx

# Install certbot (SSL - opsional tapi direkomendasikan)
sudo apt install -y certbot python3-certbot-nginx
```

### 2. Deploy Project

```bash
# Clone atau upload project ke VPS
cd /opt
git clone <repository-url> monit_api
cd monit_api

# Install dependencies
pnpm install

# Build dashboard untuk production
cd packages/dashboard
pnpm build
cd ../..

# Setup environment
cp .env.example .env
nano .env  # Edit sesuai kebutuhan
```

**`.env` penting untuk production:**

```env
PORT=3000
DASHBOARD_PORT=5173

# WAJIB GANTI!
SESSION_SECRET=random-string-yang-sangat-panjang-dan-acak
DEFAULT_ADMIN_PASSWORD=password-yang-kuat

# WAJIB GANTI!
INTERNAL_API_SECRET=secret-acak-untuk-bot

# URL publik VPS kamu
PROXY_INTERNAL_BASE_URL=http://localhost:3000
PROXY_PUBLIC_BASE_URL=https://api.yourdomain.com

# Upstream API
UPSTREAM_ENDPOINT=https://openrouter.ai/api
UPSTREAM_API_KEY=sk-or-xxxxxxxxxxxx

# Discord (opsional)
BOT_TOKEN=your-bot-token
AGVERIF_CHANNEL_ID=1234567890
# ... dll
```

### 3. Jalankan dengan PM2

```bash
# Start proxy + bot
pm2 start pnpm --name "monit-proxy" -- run dev:proxy
pm2 start pnpm --name "monit-bot" -- run dev:bot

# Atau jika sudah build:
# pm2 start packages/proxy/dist/index.js --name "monit-proxy"
# pm2 start packages/bot/src/index.js --name "monit-bot"

# Auto-start saat server reboot
pm2 startup
pm2 save

# Monitor
pm2 status
pm2 logs monit-proxy
pm2 logs monit-bot
```

### 4. Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/monit-api
```

```nginx
# Proxy API
server {
    listen 80;
    server_name api.yourdomain.com;

    # Untuk mendapatkan IP asli client
    set_real_ip_from 0.0.0.0/0;
    real_ip_header X-Forwarded-For;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Untuk large context (model reasoning panjang)
        client_max_body_size 50M;
        proxy_connect_timeout 3600s;
    }
}

# Dashboard (opsional, bisa juga serve static dari proxy)
server {
    listen 80;
    server_name dashboard.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/monit-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL dengan Let's Encrypt

```bash
sudo certbot --nginx -d api.yourdomain.com -d dashboard.yourdomain.com
```

### 6. Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 7. Update & Maintenance

```bash
cd /opt/monit_api

# Pull update terbaru
git pull

# Install dependencies baru
pnpm install

# Build dashboard
cd packages/dashboard && pnpm build && cd ../..

# Restart services
pm2 restart all
```

---

## 🖥 Admin Dashboard Guide

### Halaman Overview

Menampilkan ringkasan real-time:
- Total requests hari ini
- Total tokens terpakai
- Jumlah API key aktif
- Jumlah device terhubung
- Grafik request per jam

### API Keys Page

| Aksi | Deskripsi |
|------|-----------|
| **Create Key** | Buat API key baru dengan nama |
| **Edit Key** | Ubah nama, status, limits, policies |
| **Rotate Key** | Generate key baru (key lama invalid) |
| **Delete Key** | Hapus key beserta semua data terkait |
| **View Details** | Lihat analytics lengkap per key |

### Key Detail Page

Menampilkan untuk setiap key:
- **Stats** — Total requests, tokens, estimated cost
- **Top Models** — Model yang paling sering dipakai
- **Top Devices** — Device yang paling aktif
- **Sessions** — Daftar chat sessions
- **Policy Rules** — Device/IP/IDE rules yang aktif

### Logs Page

- **Request Logs** — Semua request yang diproxy, dengan filter (model, key, IDE, status, dll)
- **Sessions** — Chat sessions yang dikelompokkan per device
- **Session Detail** — Timeline lengkap request dalam satu session
- **Live Stream** — Real-time log stream via SSE
- **Clear Logs** — Hapus logs lama

### Settings Page

| Setting | Deskripsi |
|---------|-----------|
| **Upstream Endpoint** | URL upstream API provider |
| **Upstream API Key** | API key untuk upstream (masked di UI) |
| **Global Max Devices** | Limit device default untuk semua key (0 = unlimited) |
| **Global Rate Limit** | Request rate limit default (e.g., 100 per 1h) |
| **Global Prompt Limit** | Prompt limit default (e.g., 50 per 1d) — dihitung per user prompt, bukan per request |
| **Realtime Enabled** | Enable/disable realtime streaming features |
| **Change Password** | Ganti password admin |
| **Factory Reset** | ⚠️ Reset SEMUA data ke default (hapus semua key, logs, sessions, reset settings. Password admin tetap.) |

### Model Monitor

Menampilkan status model dari upstream:
- Online/offline status
- Latency per model
- Last check timestamp

---

## 🔑 API Key Management

### Policies

Setiap API key bisa dikonfigurasi dengan policy:

#### Device Policy
- **none** — Semua device diperbolehkan
- **allowlist** — Hanya device yang di-allow yang bisa akses
- **blacklist** — Block device tertentu

#### IP Policy
- **none** — Semua IP diperbolehkan
- **allowlist** — Hanya IP yang di-allow yang bisa akses
- **blacklist** — Block IP tertentu

#### IDE Policy
- **none** — Semua IDE diperbolehkan
- **allowlist** — Hanya IDE yang di-allow (e.g., hanya Cursor)
- **blacklist** — Block IDE tertentu

### Rate Limits

| Limit | Scope | Deskripsi |
|-------|-------|-----------|
| **Request Rate Limit** | Per request | Maksimum N request per window (e.g., `100` per `1h`). Setiap HTTP request dihitung. |
| **Prompt Limit** | Per user prompt | Maksimum N prompt per window (e.g., `50` per `1d`). Hanya prompt user yang dihitung — agent tool calls tidak dihitung. |
| **Monthly Token Limit** | Per bulan | Maksimum total tokens per bulan. |

**Cara kerja Prompt Limit:**
- User kirim pesan di IDE → dihitung 1 prompt
- Agent AI melakukan 50x tool call, 100x request → tetap 1 prompt
- User kirim pesan lagi → dihitung 2 prompt
- Switch model / switch context → prompt baru
- Rollback di IDE user → tetap keitung di DB (sudah tercatat)

**Window format:** `30s`, `5m`, `1h`, `1d` (detik, menit, jam, hari)

### Per-Key Override

Setiap key bisa override setting global:
- `rateLimit` > 0 → override `globalRateLimit`
- `promptLimit` > 0 → override `globalPromptLimit`
- Jika key-level = 0, gunakan global setting

---

## 📡 API Endpoints Reference

### Health Check

```
GET /health
→ { "status": "ok", "timestamp": "..." }
```

### Proxy (OpenAI-compatible)

```
POST   /v1/chat/completions      # Chat completions (streaming & non-streaming)
POST   /v1/completions           # Text completions
POST   /v1/embeddings            # Embeddings
GET    /v1/models                # List available models (from cache)
*      /v1/*                     # Any other OpenAI-compatible endpoint
```

**Headers:**
```
Authorization: Bearer sk-proxy-xxxxx
Content-Type: application/json
```

### Admin — Authentication

```
POST   /admin/login              # Login { password }
POST   /admin/logout             # Logout
GET    /admin/me                 # Check auth status
```

### Admin — Settings

```
GET    /admin/settings           # Get upstream config
PUT    /admin/settings           # Update upstream { upstreamEndpoint, upstreamApiKey }
GET    /admin/settings/global    # Get global settings
PUT    /admin/settings/global    # Update global settings { globalMaxDevices, realtimeEnabled, globalRateLimit, globalRateLimitWindow, globalPromptLimit, globalPromptLimitWindow }
PUT    /admin/password           # Change password { currentPassword, newPassword }
POST   /admin/settings/factory-reset  # ⚠️ Factory reset (delete all data, reset settings)
```

### Admin — API Keys

```
GET    /admin/keys               # List all keys
POST   /admin/keys               # Create key { name, discordUserId?, discordUsername?, provisionedBy? }
GET    /admin/keys/:id           # Get key detail + analytics
PUT    /admin/keys/:id           # Update key { name, isActive, maxDevices, devicePolicy, ipPolicy, idePolicy, monthlyTokenLimit, rateLimit, rateLimitWindow, promptLimit, promptLimitWindow }
DELETE /admin/keys/:id           # Delete key
POST   /admin/keys/:id/rotate   # Rotate key (generate new)
```

### Admin — Key Devices & Policies

```
GET    /admin/keys/:id/devices                    # List devices for key
POST   /admin/keys/:id/devices/:fp/block          # Block device
POST   /admin/keys/:id/devices/:fp/allow          # Allow device
DELETE /admin/keys/:id/devices/:fp                 # Remove device from list
POST   /admin/keys/:id/policies/device             # Add device/IP rule { targetType, value, listType, label }
DELETE /admin/keys/:id/policies/device/:ruleId     # Remove device/IP rule
POST   /admin/keys/:id/policies/ide                # Add IDE rule { ideName, listType }
DELETE /admin/keys/:id/policies/ide/:ruleId        # Remove IDE rule
```

### Admin — Logs & Sessions

```
GET    /admin/logs               # List logs (paginated, filterable)
GET    /admin/logs/sessions      # List chat sessions
GET    /admin/logs/sessions/:id  # Session detail + timeline
GET    /admin/logs/stream        # SSE real-time log stream
DELETE /admin/logs?days=90       # Delete logs older than N days
POST   /admin/logs/clear-all    # Delete ALL logs + sessions
POST   /admin/logs/cleanup-transcripts  # Cleanup old transcript data (24h+)
```

### Admin — Statistics

```
GET    /admin/stats/overview     # Dashboard overview stats
```

### Admin — Model Monitor

```
GET    /admin/monitor/models     # List model status
POST   /admin/monitor/push       # Push model status (dari bot/external)
```

### Internal — Bot ↔ Proxy

Semua endpoint internal memerlukan header `x-internal-secret`:

```
POST   /admin/internal/verify-user       # Verify Discord user → generate key
POST   /admin/internal/revoke-user       # Revoke user key
POST   /admin/internal/refresh-user-key  # Refresh/rotate user key
POST   /admin/internal/reset-user        # Reset user (delete key + devices)
GET    /admin/internal/user/:discordId   # Get user info by Discord ID
GET    /admin/internal/keys              # List all keys (for bot)
POST   /admin/internal/ip-policy         # Set IP policy for user
POST   /admin/internal/device-policy     # Set device policy for user
POST   /admin/internal/ide-policy        # Set IDE policy for user
GET    /admin/internal/stats/overview    # Get stats (for bot)
```

---

## 🤖 Discord Bot

### Setup Bot

1. Buat bot di [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable intents: **Server Members**, **Message Content**, **Guilds**
3. Invite bot ke server dengan permissions: `Send Messages`, `Read Messages`, `Manage Messages`, `Embed Links`
4. Set `BOT_TOKEN` di `.env`
5. Set channel & role IDs di `.env`

### Alur Verifikasi User

1. User masuk ke channel verifikasi
2. Kirim foto verifikasi (atau auto-verify jika `VERIF_AUTO=true` + Gemini key)
3. Admin approve / AI auto-approve
4. Bot generate API key via internal endpoint
5. User dapat DM dengan:
   - Endpoint proxy: `https://api.yourdomain.com/v1`
   - API key: `sk-proxy-xxxxx`
6. Jika role dicabut → key otomatis disabled

### Admin Commands

Hanya untuk member dengan permission `Administrator`:

| Command | Deskripsi |
|---------|-----------|
| `!aghelp` | Tampilkan daftar command |
| `!agstatus <@user\|id>` | Lihat status API key user |
| `!agrefresh <@user\|id>` | Refresh/rotate API key user |
| `!agreset <@user\|id>` | Reset user (hapus key + devices) |
| `!agblock <@user\|id>` | Disable API key user |
| `!agunblock <@user\|id>` | Re-enable API key user |
| `!agblockip <@user\|id> <ip>` | Block IP address untuk user |
| `!agallowip <@user\|id> <ip>` | Allow IP address untuk user |
| `!agunblockip <@user\|id> <ip>` | Unblock IP address untuk user |
| `!agblockdevice <@user\|id> <fp>` | Block device fingerprint |
| `!agallowdevice <@user\|id> <fp>` | Allow device fingerprint |
| `!agblockide <@user\|id> <ide>` | Block IDE untuk user |
| `!agallowide <@user\|id> <ide>` | Allow IDE untuk user |
| `!agkeys` | List semua API keys |
| `!agstats` | Tampilkan statistik overview |

---

## 💾 Database & Backup

### Lokasi Data

```
packages/proxy/data/gateway.db     # SQLite database utama
packages/bot/data/                  # Data state Discord bot
```

### Schema Tables

| Table | Deskripsi |
|-------|-----------|
| `admin_config` | Konfigurasi admin (password, upstream, limits, bot settings) |
| `api_keys` | API keys dengan policies dan limits |
| `allowed_devices` | Device/IP allowlist/blocklist per key |
| `allowed_ides` | IDE allowlist/blocklist per key |
| `request_logs` | Log setiap request yang diproxy |
| `chat_sessions` | Chat sessions (grup request per device) |
| `devices` | Registry device unik per key |
| `model_monitor` | Status monitoring model |

### Backup

```bash
# Simple backup
cp packages/proxy/data/gateway.db packages/proxy/data/gateway.db.backup

# Scheduled backup (crontab)
0 */6 * * * cp /opt/monit_api/packages/proxy/data/gateway.db /opt/monit_api/backups/gateway-$(date +\%Y\%m\%d-\%H\%M).db
```

### Reset Database

Untuk factory reset via dashboard: **Settings → Factory Reset**

Untuk manual reset:
```bash
rm packages/proxy/data/gateway.db
pnpm dev  # Database akan dibuat ulang otomatis
```

---

## 📝 Catatan Penting

- **Password default** dashboard adalah `admin` — **segera ganti** setelah login pertama!
- **Session secret** dan **internal API secret** WAJIB diganti di production
- Database auto-migrate — kolom baru ditambahkan otomatis saat startup
- Transcript cleanup otomatis berjalan setiap 12 jam (hapus data preview >24 jam)
- Model catalog di-refresh secara periodik dari upstream
- Data `.db` dan `.env` sudah di-`.gitignore`

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|------------|
| **Proxy Server** | [Hono](https://hono.dev) + [@hono/node-server](https://github.com/honojs/node-server) |
| **Database** | SQLite via [libsql](https://github.com/tursodatabase/libsql) + [Drizzle ORM](https://orm.drizzle.team) |
| **Dashboard** | [React 18](https://react.dev) + [Vite](https://vitejs.dev) + [Tailwind CSS](https://tailwindcss.com) |
| **UI Components** | [Radix UI](https://www.radix-ui.com) + [Lucide Icons](https://lucide.dev) |
| **Charts** | [Recharts](https://recharts.org) |
| **Discord Bot** | [discord.js](https://discord.js.org) v14 |
| **AI Verification** | [Google Generative AI](https://ai.google.dev) (Gemini) |
| **Auth** | [argon2](https://github.com/nicolo-ribaudo/node-rs-argon2) password hashing |
| **Package Manager** | [pnpm](https://pnpm.io) workspaces |

---

## License

Private project — All rights reserved.