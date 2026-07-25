const {
	Client,
	GatewayIntentBits,
	Partials,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ChannelType,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	StringSelectMenuBuilder,
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Load .env from project root - try multiple paths
const envPaths = [
	path.resolve(__dirname, '../../.env'), // packages/bot/src -> ../../.env
	path.resolve(__dirname, '../../../.env'), // packages/bot/src -> ../../../.env
	path.resolve(process.cwd(), '.env'), // current working directory
	path.resolve(process.cwd(), '../.env'), // parent of cwd
];
for (const envPath of envPaths) {
	if (require('fs').existsSync(envPath)) {
		require('dotenv').config({ path: envPath });
		break;
	}
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
	],
	partials: [Partials.Channel, Partials.Message],
});

let AGVERIF_CHANNEL_ID =
	process.env.AGVERIF_CHANNEL_ID || '1507648903900565514';
let RECAP_CHANNEL_ID =
	process.env.RECAP_CHANNEL_ID || '1470313934752972993'; // Recap button panel channel
let REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID || '1354646304042651728';
let OWNER_GROUPY_ROLE_ID =
	process.env.OWNER_GROUPY_ROLE_ID || '1354642878063710260';
let VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1486334226671337472';
let BOT_TOKEN = process.env.BOT_TOKEN;
let VERIF_AUTO_ENABLED =
	String(process.env.VERIF_AUTO || 'false').toLowerCase() === 'true';
let AGVERIF_ENABLED =
	String(process.env.AGVERIF_ENABLED || 'true').toLowerCase() === 'true';
const NO_PHOTO_TIMEOUT_HOURS = 1;
const NO_PHOTO_TIMEOUT_MS = NO_PHOTO_TIMEOUT_HOURS * 60 * 60 * 1000;
const INACTIVE_TIMEOUT_DAYS = 3;
const INACTIVE_TIMEOUT_MS = INACTIVE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
const PHOTO_DELETE_GRACE_DAYS = 3;
const PHOTO_DELETE_GRACE_MS = PHOTO_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;

const PROXY_INTERNAL_BASE_URL =
	process.env.PROXY_INTERNAL_BASE_URL ||
	`http://localhost:${process.env.PORT || '3000'}`;
const PROXY_PUBLIC_BASE_URL =
	process.env.PROXY_PUBLIC_BASE_URL ||
	`http://localhost:${process.env.PORT || '3000'}`;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

let TOKITO_API_KEY = process.env.TOKITO_API_KEY || '';
let TOKITO_CHANNEL_ID = process.env.TOKITO_CHANNEL_ID || '1470313934752972993'; // Default channel ID for panel
const TOKITO_BASE_URL =
	process.env.TOKITO_BASE_URL || 'https://api.tokito.xyz/v1';
const TOKITO_STATUS_INTERVAL_MS =
	parseInt(process.env.TOKITO_STATUS_INTERVAL_MS) || 3600000;
const TOKITO_LATENCY_INTERVAL_MS =
	parseInt(process.env.TOKITO_LATENCY_INTERVAL_MS) || 600000;
const TOKITO_PAGE_SIZE = parseInt(process.env.TOKITO_PAGE_SIZE) || 10;
const TOKITO_REQUEST_TIMEOUT_MS =
	parseInt(process.env.TOKITO_REQUEST_TIMEOUT_MS) || 180000; // 180s per attempt
// 0 / unset = unlimited: fire ALL models at once (user request: concurrent all-in-one)
const SWEEP_CONCURRENCY = (() => {
	const raw = process.env.SWEEP_CONCURRENCY;
	if (raw === undefined || raw === '' || raw === '0') return 0;
	return Math.max(1, parseInt(raw) || 0);
})();
const SWEEP_ATTEMPTS = Math.max(1, parseInt(process.env.SWEEP_ATTEMPTS) || 3);
const TOKITO_SESSION_TIMEOUT_MS =
	parseInt(process.env.TOKITO_SESSION_TIMEOUT_MS) || 180000; // 3 minutes
const TOKITO_FALLBACK_MAX_INDEX =
	parseInt(process.env.TOKITO_FALLBACK_MAX_INDEX) || 1;

const AGVERIF_DATA_DIR = path.join(__dirname, '..', 'data');
const THREADS_PATH = path.join(AGVERIF_DATA_DIR, 'threads.json');
const VERIFIED_USERS_PATH = path.join(AGVERIF_DATA_DIR, 'verified_users.json');
const SETUP_STATE_PATH = path.join(AGVERIF_DATA_DIR, 'setup_state.json');
const RANKING_STATE_PATH = path.join(AGVERIF_DATA_DIR, 'ranking_state.json');
const RANKING_REFRESH_INTERVAL_MS = 60 * 1000; // 1 menit
const TRIAL_CLAIM_BUTTON = 'trial_claim';

// ─── Discord timestamp helper ─────────────────────────────────────────────────
// Format any ISO/string/Date into a Discord timestamp token. Discord renders
// the timestamp in the viewer's local timezone and live-updates it (e.g. "in
// 3 hours" / "2 days ago"). Use these everywhere instead of raw toLocaleString
// strings so users in different timezones see consistent info.
function discordTime(input, style = 'F') {
	if (!input) return '—';
	const ms =
		input instanceof Date ? input.getTime() : new Date(input).getTime();
	if (!Number.isFinite(ms)) return '—';
	return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
// Convenience: e.g. discordTimeRange(start, 't', end, 'R') => "<t:..:t> (<t:..:R>)"
function discordTimeRange(inputStart, startStyle, inputEnd, endStyle) {
	return `${discordTime(inputStart, startStyle)} (${discordTime(inputEnd, endStyle)})`;
}

// ─── How-to-Use tutorial ──────────────────────────────────────────────────────
const TUTORIAL_BTN_HOWTO_PREFIX = 'howto_open';
const TUTORIAL_MENU_IDE_PREFIX = 'howto_ide_';
const TUTORIAL_PAGE_PREFIX = 'howto_page_';
const TUTORIAL_PAGE_SIZE = 1800;

const TUTORIAL_IDES = [
	{ id: 'cline', label: 'Cline (VS Code extension)' },
	{ id: 'codex_ide', label: 'Codex (web / VS Code extension)' },
	{ id: 'codex_cli', label: 'Codex CLI (terminal)' },
	{ id: 'claude_cli', label: 'Claude Code CLI' },
	{ id: 'opencode', label: 'OpenCode' },
	{ id: 'oai_provider', label: 'VS Code OpenAI Compat (calgan.oai-provider)' },
];

// ─── Monthly Recap (Wrapped) ────────────────────────────────────────────────
const RECAP_STATE_PATH = path.join(AGVERIF_DATA_DIR, 'recap_state.json');
const RECAP_DEBUG_CHANNEL_ID =
	process.env.RECAP_DEBUG_CHANNEL_ID || '1507648716847190088';
const RECAP_PUBLIC_BASE_URL = (
	process.env.RECAP_PUBLIC_BASE_URL ||
	PROXY_PUBLIC_BASE_URL ||
	'https://api.tokito.xyz'
).replace(/\/$/, '');
const PORTAL_DASHBOARD_URL = (
	process.env.PORTAL_DASHBOARD_URL ||
	RECAP_PUBLIC_BASE_URL ||
	'https://api.tokito.xyz'
).replace(/\/$/, '');
const RECAP_DEBUG_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
let recapState = {
	panelMessageId: null,
	debugPanelMessageId: null,
	debugLogMessageId: null,
	pregenFiredYearMonth: null,
	// Last date (YYYY-MM-DD WIB) we ran the daily recap regeneration. Used to
	// make the 24h cron idempotent across bot restarts — never run twice in
	// the same WIB day even if the process restarted.
	lastDailyRecapDate: null,
};

/** YYYY-MM-DD in WIB (UTC+7) for the given Date. */
function wibTodayStr(now = new Date()) {
	const w = new Date(now.getTime() + 7 * 60 * 60 * 1000);
	const y = w.getUTCFullYear();
	const m = String(w.getUTCMonth() + 1).padStart(2, '0');
	const d = String(w.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

// ── Recap double-click lock ────────────────────────────────────────────────────
// A user can spam "Lihat Recap Saya" / "Generate Recap-ku" buttons. Each click
// would otherwise spawn a fresh in-flight generation request — wasting AI quota
// and racing on the server. We keep an in-memory map of in-flight jobs and
// bounce new clicks for the same key while one is running. After 10 minutes a
// stuck job is force-aborted and a new one can be claimed.
const RECAP_LOCK_TTL_MS = 10 * 60 * 1000;
const recapInFlight = new Map(); // key -> { startedAt, abort, key }
function getRecapLockKey(requesterId, targetId) {
	return targetId && targetId !== requesterId
		? `other:${requesterId}:${targetId}`
		: `self:${targetId || requesterId}`;
}
function tryClaimRecapLock(key) {
	const now = Date.now();
	const existing = recapInFlight.get(key);
	if (existing) {
		if (now - existing.startedAt < RECAP_LOCK_TTL_MS) {
			const remaining = Math.max(
				1,
				Math.ceil((RECAP_LOCK_TTL_MS - (now - existing.startedAt)) / 1000),
			);
			return { ok: false, remaining, existing };
		}
		// Stale (>5 min): abort the lingering fetch and let a new one take over.
		try {
			existing.abort.abort('stale lock timeout');
		} catch {
			/* ignore */
		}
		recapInFlight.delete(key);
	}
	const entry = { startedAt: now, abort: new AbortController(), key };
	recapInFlight.set(key, entry);
	return { ok: true, entry };
}
function releaseRecapLock(key) {
	recapInFlight.delete(key);
}

async function proxyInternal(pathname, method = 'GET', body = null, opts = {}) {
	const headers = {
		'Content-Type': 'application/json',
		'x-internal-secret': INTERNAL_API_SECRET,
	};
	const maxAttempts =
		opts.retries ?? (method === 'POST' && pathname.includes('/recap/') ? 2 : 1);
	let lastErr;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const res = await fetch(`${PROXY_INTERNAL_BASE_URL}${pathname}`, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal: opts.signal || undefined,
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const errMsg =
					typeof data.error === 'object'
						? JSON.stringify(data.error)
						: data.error || `Proxy internal API failed: ${res.status}`;
				throw new Error(errMsg);
			}
			return data;
		} catch (err) {
			lastErr = err;
			const msg = err?.message || String(err);
			const retryable =
				/fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(
					msg,
				);
			if (!retryable || attempt >= maxAttempts - 1) throw err;
			await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
		}
	}
	throw lastErr;
}

let trialModelsCache = {
	gpyModels: [],
	mode: 'all',
	whitelist: [],
	fetchedAt: 0,
};

async function getTrialModelsCached() {
	const TTL = 5 * 60 * 1000;
	if (
		trialModelsCache.fetchedAt &&
		Date.now() - trialModelsCache.fetchedAt < TTL
	) {
		return trialModelsCache;
	}
	try {
		const data = await proxyInternal('/admin/internal/trial-models');
		const mode =
			data.mode === 'whitelist' ? 'whitelist' : 'all';
		trialModelsCache = {
			gpyModels: data.gpyModels || [],
			mode,
			whitelist: data.whitelist || [],
			fetchedAt: Date.now(),
		};
		return trialModelsCache;
	} catch {
		return {
			gpyModels: [],
			mode: 'all',
			whitelist: [],
			fetchedAt: Date.now(),
		};
	}
}

async function getMemberToolAccess(member) {
	if (!member) {
		return {
			isPhantom: false,
			hasTrialRole: false,
			isTrialUser: false,
			hasPhantomKey: false,
			mode: 'none',
			canUseTools: false,
			trialRoleId: '1354682641961582632',
			trialCfg: null,
		};
	}
	let trialCfg = null;
	try {
		trialCfg = await proxyInternal('/admin/internal/trial-panel-config');
	} catch {
		/* ignore */
	}
	const trialRoleId = trialCfg?.trialRequiredRoleId || '1354682641961582632';
	const isPhantom = !!(
		REQUIRED_ROLE_ID && member.roles?.cache?.has(REQUIRED_ROLE_ID)
	);
	const hasTrialRole = !!(trialRoleId && member.roles?.cache?.has(trialRoleId));
	let keyType = null;
	try {
		keyType = await proxyInternal(`/admin/internal/user-key-type/${member.id}`);
	} catch {
		/* ignore */
	}
	const isTrialUser = keyType?.isTrial === true;
	const hasActivePhantomKey = keyType?.hasPhantomKey === true;
	const hasActiveApiKey = keyType?.hasActiveApiKey === true;
	let mode = 'none';
	if (isTrialUser) mode = 'trial';
	else if (hasActivePhantomKey || isPhantom) mode = 'phantom';
	else if (hasTrialRole) mode = 'trial';
	return {
		isPhantom,
		hasTrialRole,
		isTrialUser,
		hasPhantomKey: hasActivePhantomKey,
		hasActivePhantomKey,
		hasActiveApiKey,
		mode,
		canUseTools: !!(isPhantom || hasTrialRole || isTrialUser || hasActiveApiKey),
		trialRoleId,
		trialCfg,
	};
}

function toolAccessDeniedMessage(access) {
	return `Anda memerlukan role **The Phantom** atau **role trial Groupy** (<@&${access?.trialRoleId || '1354682641961582632'}>) untuk menggunakan fitur ini.`;
}

function entryMatchesTrialModel(entry, trialCache) {
	const modelId = entry.modelId || '';
	if (modelId === 'auto') return false;
	const provider = (entry.provider || '').toLowerCase();
	const fullId = modelId.includes('/') ? modelId : `${provider}/${modelId}`;
	const candidates = [fullId, modelId, modelId.split('/').pop()].filter(
		Boolean,
	);
	if (trialCache.mode === 'whitelist' && trialCache.whitelist?.length) {
		return trialCache.whitelist.some((w) => {
			const wNorm = String(w);
			return candidates.some(
				(id) => id === wNorm || id.endsWith('/' + wNorm.split('/').pop()),
			);
		});
	}
	// mode all / all_gpy: all models
	return true;
}

async function provisionApiKeyForVerifiedUser(
	userId,
	username,
	threadId,
	guildId,
) {
	return proxyInternal('/admin/internal/verify-user', 'POST', {
		discordUserId: userId,
		discordUsername: username,
		sourceThreadId: threadId,
		sourceGuildId: guildId,
	});
}

async function revokeApiKeyForUser(userId, reason = 'Policy violation') {
	return proxyInternal('/admin/internal/revoke-user', 'POST', {
		discordUserId: userId,
		reason,
	});
}

function extractUserId(raw) {
	if (!raw) return null;
	const mention = String(raw).match(/^<@!?(\d+)>$/);
	if (mention) return mention[1];
	const idOnly = String(raw).match(/^(\d{15,25})$/);
	if (idOnly) return idOnly[1];
	return null;
}

async function sendApiCredentialsDm(userId, apiKey, endpoint) {
	const anthropicUrl = endpoint; // same URL works: /v1/messages auto-routed + translated
	const result = await sendDMToUser(
		userId,
		'🔑 API Key Proxy Anda',
		`Verifikasi Anda berhasil. Berikut kredensial akses API proxy:\n\n` +
			`**A. Untuk OpenAI-compatible clients (Cline, Codex, OpenCode, Cursor):**\n` +
			`\`\`\`\n` +
			`Endpoint:   ${endpoint}\n` +
			`Authorization: Bearer ${apiKey}\n` +
			`\`\`\`\n` +
			`Contoh: \`${endpoint}/chat/completions\`\n\n` +
			`**B. Untuk Anthropic clients (Claude Code, Anthropic SDK):**\n` +
			`Proxy auto-translate \`/v1/messages\` (Anthropic) ↔ \`/v1/chat/completions\` (OpenAI). ` +
			`Set env vars berikut:\n` +
			`\`\`\`bash\n` +
			`export ANTHROPIC_BASE_URL="${anthropicUrl}"\n` +
			`export ANTHROPIC_AUTH_TOKEN="${apiKey}"\n` +
			`export ANTHROPIC_DEFAULT_SONNET_MODEL="<groupy-model-id>"\n` +
			`export ANTHROPIC_DEFAULT_HAIKU_MODEL="<groupy-model-id>"\n` +
			`export ANTHROPIC_DEFAULT_OPUS_MODEL="<groupy-model-id>"\n` +
			`export API_TIMEOUT_MS=500000\n` +
			`\`\`\`\n` +
			`Untuk bantuan setup di IDE: buka Discord DM bot ini dan klik "How to Use".\n\n` +
			`**Peraturan Penggunaan:**\n` +
			`• Maksimal **1 device** per API key\n` +
			`• Jika terdeteksi >1 device, key akan di-revoke/rotate otomatis\n` +
			`• Jika key direvoke admin karena pelanggaran, hubungi admin\n\n` +
			`Simpan key ini baik-baik. Jika bocor, hubungi admin untuk rotate key.`,
		0x57f287,
	);
	if (!result) {
		throw new Error('Failed to send DM — user may have DMs disabled');
	}
	return result;
}

function normalizeIdeNameForCommand(raw) {
	return String(raw || '')
		.trim()
		.toLowerCase();
}

async function handleAdminCommand(message) {
	if (!message.guild || !message.member) return false;
	if (!message.member.permissions?.has('Administrator')) return false;
	if (!message.content.startsWith('!ag')) return false;

	const parts = message.content.trim().split(/\s+/);
	const cmd = parts[0].toLowerCase();
	const a1 = parts[1];
	const a2 = parts[2];

	try {
		if (cmd === '!aghelp') {
			await message.reply(
				'**Admin Commands**\n' +
					'`!aghelp`\n' +
					'`!agcheck` (Tokito Model Status)\n' +
					'`!agstatus <@user|id>`\n' +
					'`!agsetratelimit <@user|id> <limit> <window>` — API call (hop) limit\n' +
					'`!agsetpromptlimit <@user|id> <limit> <window>` — prompt (1/turn) limit\n' +
					'`!agsetmodellimit <@user|id> <model> <limit>`\n' +
					'`!agrefresh <@user|id>`\n' +
					'`!agreset <@user|id>`\n' +
					'`!agblock <@user|id>`\n' +
					'`!agunblock <@user|id>`\n' +
					'`!agblockip <@user|id> <ip>`\n' +
					'`!agallowip <@user|id> <ip>`\n' +
					'`!agunblockip <@user|id> <ip>`\n' +
					'`!agblockdevice <@user|id> <fingerprint>`\n' +
					'`!agallowdevice <@user|id> <fingerprint>`\n' +
					'`!agblockide <@user|id> <ide>`\n' +
					'`!agallowide <@user|id> <ide>`\n' +
					'`!agkeys`\n' +
					'`!agstats`\n' +
					'`!agsetmaxdevices <number>`\n' +
					'`!aggetmaxdevices`',
			);
			return true;
		}

		if (cmd === '!agcheck') {
			if (!TOKITO_API_KEY) {
				await message.reply(
					'Variabel `TOKITO_API_KEY` belum diset. Tokito monitor tidak aktif.',
				);
				return true;
			}
			const session = createTokitoSession(message.author.id, 'status');
			const { embed, components } = buildTokitoEmbed('status', session);
			await message.reply({ embeds: [embed], components });
			return true;
		}

		if (cmd === '!aggetmaxdevices') {
			const data = await proxyInternal('/admin/settings/global');
			await message.reply(
				`Global max devices saat ini: **${data.globalMaxDevices}** (0 = unlimited).`,
			);
			return true;
		}

		if (cmd === '!agsetmaxdevices') {
			if (!a1 || isNaN(parseInt(a1))) {
				await message.reply('Gunakan format: !agsetmaxdevices <number>');
				return true;
			}
			const maxDev = parseInt(a1);
			await proxyInternal('/admin/internal/set-global-max-devices', 'POST', {
				maxDevices: maxDev,
			});
			await message.reply(
				`Global max devices berhasil diset ke **${maxDev}** device(s) (0 = unlimited).`,
			);
			return true;
		}

		if (cmd === '!agkeys') {
			const data = await proxyInternal('/admin/internal/keys');
			if (!Array.isArray(data) || data.length === 0) {
				await message.reply('Belum ada API key Discord.');
				return true;
			}
			const rows = data
				.slice(0, 20)
				.map(
					(k) =>
						`• ${k.discordUsername || k.discordUserId} | ${k.keyMasked} | ${k.isActive ? 'active' : 'disabled'}`,
				);
			await message.reply(`**Discord Keys (max 20):**\n${rows.join('\n')}`);
			return true;
		}

		if (cmd === '!agsetratelimit') {
			if (!a2 || !parts[3]) {
				await message.reply(
					'Gunakan format: !agsetratelimit <user> <limit> <window> (contoh: !agsetratelimit @user 500 5h) — batas panggilan API (hop)',
				);
				return true;
			}
			const discordUserId = extractUserId(a1);
			if (!discordUserId) {
				await message.reply('Format user tidak valid.');
				return true;
			}
			const limit = parseInt(a2) || 0;
			const windowStr = parts[3];

			const res = await proxyInternal(
				'/admin/internal/update-key-rate-limit',
				'POST',
				{
					discordUserId,
					rateLimit: limit,
					rateLimitWindow: windowStr,
				},
			);

			if (res.success) {
				await message.reply(
					`API call limit untuk user diubah menjadi **${limit}** panggilan API per **${windowStr}**.`,
				);
			} else {
				await message.reply(
					'Gagal mengubah API call limit: ' + (res.error || 'Unknown error'),
				);
			}
			return true;
		}

		if (cmd === '!agsetpromptlimit') {
			if (!a2 || !parts[3]) {
				await message.reply(
					'Gunakan format: !agsetpromptlimit <user> <limit> <window> (contoh: !agsetpromptlimit @user 50 5h) — 1 prompt per turn',
				);
				return true;
			}
			const discordUserId = extractUserId(a1);
			if (!discordUserId) {
				await message.reply('Format user tidak valid.');
				return true;
			}
			const limit = parseInt(a2) || 0;
			const windowStr = parts[3];

			const res = await proxyInternal(
				'/admin/internal/update-key-prompt-limit',
				'POST',
				{ discordUserId, promptLimit: limit, promptLimitWindow: windowStr },
			);

			if (res.success) {
				await message.reply(
					`Prompt limit untuk user diubah menjadi **${limit}** prompts per **${windowStr}**.`,
				);
			} else {
				await message.reply(
					'Gagal mengubah prompt limit: ' + (res.error || 'Unknown error'),
				);
			}
			return true;
		}

		if (cmd === '!agsetmodellimit') {
			if (!a2 || !parts[3]) {
				await message.reply(
					'Gunakan format: !agsetmodellimit <user> <model> <limit> (contoh: !agsetmodellimit @user ag/claude-sonnet-4-6 20)',
				);
				return true;
			}
			const discordUserId = extractUserId(a1);
			if (!discordUserId) {
				await message.reply('Format user tidak valid.');
				return true;
			}
			const modelName = a2;
			const modelLimit = parseInt(parts[3]) || 0;

			const res = await proxyInternal(
				'/admin/internal/update-key-model-limit',
				'POST',
				{ discordUserId, model: modelName, promptLimit: modelLimit },
			);

			if (res.success) {
				await message.reply(
					`Model limit untuk **${modelName}** diubah menjadi **${modelLimit}** prompts per window.`,
				);
			} else {
				await message.reply(
					'Gagal mengubah model limit: ' + (res.error || 'Unknown error'),
				);
			}
			return true;
		}

		if (cmd === '!agstats') {
			const s = await proxyInternal('/admin/internal/stats/overview');
			await message.reply(
				`**Overview**\n` +
					`Today Requests: ${s.todayRequests || 0}\n` +
					`Today Tokens: ${s.todayTokens || 0}\n` +
					`Active Discord Keys: ${s.activeDiscordKeys || 0}`,
			);
			return true;
		}

		const discordUserId = extractUserId(a1);
		if (
			!discordUserId &&
			cmd !== '!agkeys' &&
			cmd !== '!agstats' &&
			cmd !== '!aghelp'
		) {
			await message.reply(
				'Format user tidak valid. Gunakan mention atau Discord user ID.',
			);
			return true;
		}

		if (cmd === '!agstatus') {
			const data = await proxyInternal(
				`/admin/internal/stats/user-detail/${discordUserId}`,
			);
			if (!data || data.error) {
				await message.reply(
					'User belum punya API key proxy atau tidak ditemukan.',
				);
				return true;
			}

			function formatResetTime(isoStr) {
				if (!isoStr) return '';
				const unix = Math.floor(new Date(isoStr).getTime() / 1000);
				return ` (Resets <t:${unix}:t>)`;
			}

			const globalLimitStr =
				data.promptLimit > 0
					? `${data.promptUsed} / ${data.promptLimit} prompts (${data.promptLimitWindow})` +
						formatResetTime(data.promptResetAt)
					: 'Unlimited';
			const apiCallLimitStr =
				data.rateLimit > 0
					? `${data.apiCallUsed || 0} / ${data.rateLimit} API calls (${data.rateLimitWindow})` +
						formatResetTime(data.apiCallResetAt)
					: 'Unlimited';

			let modelLimitStr = '';
			if (data.modelUsage && data.modelUsage.length > 0) {
				const activeModels = data.modelUsage.filter(
					(m) => m.used > 0 || m.limit > 0,
				);
				if (activeModels.length > 0) {
					modelLimitStr = activeModels
						.map(
							(m) =>
								`  • ${m.model}: ${m.used} / ${m.limit > 0 ? m.limit : '∞'}` +
								formatResetTime(m.resetAt),
						)
						.join('\n');
				}
			}

			function formatTokens(n) {
				if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
				if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
				return n.toString();
			}

			await message.reply(
				`**Status ${data.discordUsername || data.discordUserId}**\n` +
					`Key: ${data.keyPrefix}...\n` +
					`Active: ${data.isActive ? 'Yes 🟢' : 'No 🔴'}\n` +
					`Usage Today: ${data.today?.requests || 0} prompts / ${formatTokens(data.today?.tokens || 0)} tokens\n` +
					`Prompt Limit: ${globalLimitStr}\n` +
					`API Call Limit: ${apiCallLimitStr}\n` +
					(modelLimitStr ? `Model Limits:\n${modelLimitStr}\n` : '') +
					`ℹ️ *1 prompt = 1 user turn. Tool hops = API calls. Token limit: hop pertama 100%, hop berikutnya % weight (default 10%).*\n` +
					`Daily Token Limits:\n` +
					`  • Total: ${data.dailyTokenLimit > 0 ? `${formatTokens(data.dailyTokensUsed)} / ${formatTokens(data.dailyTokenLimit)}` : `${formatTokens(data.dailyTokensUsed)} / ∞`}${formatResetTime(data.dailyResetAt)}\n` +
					`  • Input: ${data.dailyInputTokenLimit > 0 ? `${formatTokens(data.dailyInputUsed)} / ${formatTokens(data.dailyInputTokenLimit)}` : `${formatTokens(data.dailyInputUsed)} / ∞`}\n` +
					`  • Output: ${data.dailyOutputTokenLimit > 0 ? `${formatTokens(data.dailyOutputUsed)} / ${formatTokens(data.dailyOutputTokenLimit)}` : `${formatTokens(data.dailyOutputUsed)} / ∞`}`,
			);
			return true;
		}

		if (cmd === '!agrefresh') {
			try {
				const data = await proxyInternal(
					'/admin/internal/refresh-user-key',
					'POST',
					{ discordUserId },
				);
				const endpoint = data.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`;
				const dmSent = await sendApiCredentialsDm(
					discordUserId,
					data.apiKey,
					endpoint,
				);

				// Send How to Use guide
				try {
					const kind = 'phantom'; // Refreshed keys are always phantom keys
					const details = await proxyInternal('/admin/internal/models/details');
					const models = (details?.data || [])
						.map((m) => m.id)
						.filter((id) => id && id !== 'auto');
					await sendHowToDm(discordUserId, kind, {
						endpoint,
						apiKey: data.apiKey,
						models,
					});
				} catch (howtoErr) {
					console.error('[agrefresh] sendHowToDm failed:', howtoErr.message);
				}

				if (dmSent) {
					await message.reply(
						'API key berhasil di-refresh dan dikirim via DM ke user.',
					);
				} else {
					await message.reply(
						`API key berhasil di-refresh. DM gagal, dikirim di sini:\n\n**Endpoint**: \`${endpoint}\`\n**Authorization**: \`Bearer ${data.apiKey}\``,
					);
				}
			} catch (err) {
				console.error('[agrefresh] failed to refresh key:', err.message);
				await message.reply(
					`Gagal refresh API key: ${err.message}. Pastikan user sudah terverifikasi dan punya API key.`,
				);
			}
			return true;
		}

		if (cmd === '!agreset') {
			await proxyInternal('/admin/internal/reset-user', 'POST', {
				discordUserId,
			});
			await message.reply('Data usage & policy user berhasil di-reset.');
			return true;
		}

		if (cmd === '!agblock') {
			await proxyInternal('/admin/internal/revoke-user', 'POST', {
				discordUserId,
				reason: 'Revoke by admin due to policy violation',
			});
			await sendDMToUser(
				discordUserId,
				'🚫 API Key Direvoke Admin',
				'API key Anda telah direvoke karena pelanggaran kebijakan.\n\nSilakan hubungi admin untuk klarifikasi dan reaktivasi.',
				0xff6b6b,
			);
			await message.reply(
				'API key user berhasil di-disable dan notifikasi sudah dikirim via DM.',
			);
			return true;
		}

		if (cmd === '!agunblock') {
			const member = await message.guild.members
				.fetch(discordUserId)
				.catch(() => null);
			const username = member?.user?.username || discordUserId;
			const data = await proxyInternal('/admin/internal/verify-user', 'POST', {
				discordUserId,
				discordUsername: username,
				sourceGuildId: message.guild.id,
				sourceThreadId: message.channel.id,
			});
			try {
				await sendApiCredentialsDm(
					discordUserId,
					data.apiKey,
					data.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`,
				);
				await message.reply(
					'API key user berhasil diaktifkan dan dikirim via DM.',
				);
			} catch (dmErr) {
				console.warn(
					'[agunblock] DM failed, sending key in channel:',
					dmErr.message,
				);
				await message.reply(
					`API key user berhasil diaktifkan. DM gagal, dikirim di sini:\n\n**Endpoint**: \`${data.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`}\`\n**Authorization**: \`Bearer ${data.apiKey}\``,
				);
			}
			return true;
		}

		if (
			cmd === '!agblockip' ||
			cmd === '!agallowip' ||
			cmd === '!agunblockip'
		) {
			if (!a2) {
				await message.reply('Gunakan format: !agblockip <user> <ip>');
				return true;
			}
			const mode =
				cmd === '!agblockip'
					? 'block'
					: cmd === '!agallowip'
						? 'allow'
						: 'remove';
			await proxyInternal('/admin/internal/ip-policy', 'POST', {
				discordUserId,
				ipAddress: a2,
				mode,
			});
			await message.reply(`Policy IP berhasil diupdate (${mode}).`);
			return true;
		}

		if (cmd === '!agblockdevice' || cmd === '!agallowdevice') {
			if (!a2) {
				await message.reply(
					'Gunakan format: !agblockdevice <user> <fingerprint>',
				);
				return true;
			}
			const mode = cmd === '!agblockdevice' ? 'block' : 'allow';
			await proxyInternal('/admin/internal/device-policy', 'POST', {
				discordUserId,
				fingerprint: a2,
				mode,
			});
			await message.reply(`Policy device berhasil diupdate (${mode}).`);
			return true;
		}

		if (cmd === '!agblockide' || cmd === '!agallowide') {
			if (!a2) {
				await message.reply('Gunakan format: !agblockide <user> <ide>');
				return true;
			}
			const mode = cmd === '!agblockide' ? 'block' : 'allow';
			await proxyInternal('/admin/internal/ide-policy', 'POST', {
				discordUserId,
				ideName: normalizeIdeNameForCommand(a2),
				mode,
			});
			await message.reply(`Policy IDE berhasil diupdate (${mode}).`);
			return true;
		}

		return false;
	} catch (err) {
		console.error('[agverif-admin-cmd] error:', err);
		await message.reply(`Command gagal: ${err.message || 'unknown error'}`);
		return true;
	}
}

/**
 * Urutan fallback model: coba 1→…→N per kunci API; jika semua model error, ganti kunci lalu ulang.
 */
const GEMINI_MODEL_CHAIN = [
	'gemini-3.1-flash-lite-preview',
	'gemini-3.1-flash-lite',
	'gemini-3-flash-preview',
	'gemini-3-flash',
	'gemini-2.5-flash-lite',
	'gemini-2.5-flash',
];

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * GOOGLE_API_KEY, GOOGLE_API_KEY1 … GOOGLE_API_KEY11 (tanpa duplikat, urut).
 * @returns {string[]}
 */
function getGoogleApiKeys() {
	const keys = [];
	const base = process.env.GOOGLE_API_KEY;
	if (base && String(base).trim()) keys.push(String(base).trim());
	for (let i = 1; i <= 11; i++) {
		const k = process.env[`GOOGLE_API_KEY${i}`];
		if (k && String(k).trim()) keys.push(String(k).trim());
	}
	return [...new Set(keys)];
}

function parseGeminiPassJson(text) {
	if (!text || typeof text !== 'string') return null;
	let s = text.trim();
	const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) s = fenced[1].trim();
	const brace = s.match(/\{[\s\S]*\}/);
	if (brace) {
		try {
			const o = JSON.parse(brace[0]);
			if (typeof o.pass === 'boolean') return o.pass;
		} catch (_) {
			/* lanjut fallback */
		}
	}
	if (/["']?pass["']?\s*:\s*true\b/i.test(s)) return true;
	if (/["']?pass["']?\s*:\s*false\b/i.test(s)) return false;
	return null;
}

/**
 * @returns {Promise<boolean|null>} true = lolos, false = tolak/tidak jelas, null = semua kunci/API gagal
 */
async function analyzeVerificationPhotoGemini(imageBuffer, mimeType) {
	const keys = getGoogleApiKeys();
	if (keys.length === 0) return null;

	const prompt =
		'Analisis gambar verifikasi Discord. User harus mengunggah foto selfie asli dengan memegang kertas. ' +
		'Teks di kertas harus kira-kira seperti frasa berikut (boleh tulisan tangan atau cetak): ' +
		'"saya pengguna paket phantom, ingin verifikasi antigravity". ' +
		'Urutan huruf boleh terbalik/di-mirror di foto (misalnya terbaca terbalik karena kamera) selama makna/teks inti masih bisa dikenali; tidak perlu persis ejaan jika tetap jelas maksudnya. ' +
		'Wajah orang harus terlihat dan kertas + tulisan harus terbaca dengan wajar.\n\n' +
		'PENTING — tolak (pass false) jika: gambar terasa hasil edit komposit berat, manipulasi digital mencurigakan, ' +
		'atau menyerupai render/ilustrasi/generatif bukan foto selfie nyata; atau jika sangat mencurigakan sebagai gambar sintetis/AI-only. ' +
		'Terima (pass true) hanya jika ini terlihat seperti foto selfie nyata dari kamera, bukan hasil generate murni atau paste tulisan palsu yang tidak konsisten dengan pencahayaan/konteks.\n\n' +
		'Jawab HANYA satu objek JSON valid tanpa teks lain, tanpa markdown: {"pass":true} jika memenuhi, ' +
		'atau {"pass":false} jika tidak memenuhi atau ragu.';

	const parts = [
		{ text: prompt },
		{
			inlineData: {
				mimeType: mimeType || 'image/jpeg',
				data: imageBuffer.toString('base64'),
			},
		},
	];

	for (let ki = 0; ki < keys.length; ki++) {
		const apiKey = keys[ki];
		const genAI = new GoogleGenerativeAI(apiKey);

		for (let mi = 0; mi < GEMINI_MODEL_CHAIN.length; mi++) {
			const modelId = GEMINI_MODEL_CHAIN[mi];
			try {
				const model = genAI.getGenerativeModel({ model: modelId });
				const result = await model.generateContent(parts);
				const text = result.response.text();
				const pass = parseGeminiPassJson(text);
				if (pass !== null) return pass;
				console.error(
					`[agverif-gemini] Respons tidak bisa diparse (kunci #${ki + 1}, ${modelId}):`,
					text ? text.slice(0, 300) : '(kosong)',
				);
				return false;
			} catch (err) {
				const status = err.status ?? err.statusCode ?? err.cause?.status;
				const msg = err.message || String(err);
				console.error(
					`[agverif-gemini] Gagal kunci #${ki + 1} model ${modelId}:`,
					status || msg,
				);
			}
		}

		console.error(
			`[agverif-gemini] Semua model gagal untuk kunci #${ki + 1}; lanjut ke kunci berikutnya jika ada.`,
		);
	}

	return null;
}

/**
 * Tanpa GOOGLE_API_KEY*: notifikasi owner seperti dulu, tanpa role otomatis.
 * Dengan kunci: owner hanya di-ping jika pass===true; role otomatis hanya jika pass===true.
 * @returns {{ ownerNotify: boolean, autoVerifyRole: boolean }}
 */
async function evaluateVerificationPhoto(attachment) {
	if (!VERIF_AUTO_ENABLED) {
		return { ownerNotify: true, autoVerifyRole: false };
	}

	const keys = getGoogleApiKeys();
	if (keys.length === 0) {
		return { ownerNotify: true, autoVerifyRole: false };
	}

	try {
		const res = await fetch(attachment.url);
		if (!res.ok) return { ownerNotify: false, autoVerifyRole: false };
		const buf = Buffer.from(await res.arrayBuffer());
		const mime = attachment.contentType || 'image/jpeg';
		const verdict = await analyzeVerificationPhotoGemini(buf, mime);
		const ok = verdict === true;
		return { ownerNotify: ok, autoVerifyRole: ok };
	} catch (err) {
		console.error('[agverif-gemini] Gagal unduh gambar:', err);
		return { ownerNotify: false, autoVerifyRole: false };
	}
}

async function ensureDataDir() {
	try {
		await fs.mkdir(AGVERIF_DATA_DIR, { recursive: true });
	} catch (err) {
		console.error('Failed to create agverif_data folder:', err);
	}
}

client.agverifData = {
	threads: {},
	verifiedUsers: {},
	setupState: { messageId: null, channelId: null },
};

async function loadThreadsData() {
	await ensureDataDir();
	try {
		const content = await fs.readFile(THREADS_PATH, 'utf8');
		const trimmed = content.trim();
		if (!trimmed) {
			client.agverifData.threads = {};
			return;
		}
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.threads = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn(
				'[agverif] threads.json unreadable, resetting:',
				err.message,
			);
		}
		client.agverifData.threads = {};
	}
}

async function saveThreadsData() {
	try {
		await ensureDataDir();
		const dataToSave = {};
		for (const [threadId, data] of Object.entries(client.agverifData.threads)) {
			dataToSave[threadId] = {
				...data,
				deleteTimeout: null,
				inactiveTimeout: null,
				photoDeleteTimeout: null,
			};
		}
		await fs.writeFile(
			THREADS_PATH,
			JSON.stringify(dataToSave, null, 2),
			'utf8',
		);
	} catch (err) {
		console.error('Failed to save threads data:', err);
	}
}

async function loadVerifiedUsersData() {
	await ensureDataDir();
	try {
		const content = await fs.readFile(VERIFIED_USERS_PATH, 'utf8');
		const trimmed = content.trim();
		if (!trimmed) {
			client.agverifData.verifiedUsers = {};
			return;
		}
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.verifiedUsers = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn(
				'[agverif] verified_users.json unreadable, resetting:',
				err.message,
			);
		}
		client.agverifData.verifiedUsers = {};
	}
}

async function saveVerifiedUsersData() {
	try {
		await ensureDataDir();
		await fs.writeFile(
			VERIFIED_USERS_PATH,
			JSON.stringify(client.agverifData.verifiedUsers, null, 2),
			'utf8',
		);
	} catch (err) {
		console.error('Failed to save verified users data:', err);
	}
}

async function loadSetupState() {
	await ensureDataDir();
	try {
		const content = await fs.readFile(SETUP_STATE_PATH, 'utf8');
		const trimmed = content.trim();
		if (!trimmed) {
			client.agverifData.setupState = { messageId: null, channelId: null };
			return;
		}
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.setupState = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn(
				'[agverif] setup_state.json unreadable, resetting:',
				err.message,
			);
		}
		client.agverifData.setupState = { messageId: null, channelId: null };
	}
}

async function saveSetupState() {
	try {
		await ensureDataDir();
		await fs.writeFile(
			SETUP_STATE_PATH,
			JSON.stringify(client.agverifData.setupState, null, 2),
			'utf8',
		);
	} catch (err) {
		console.error('Failed to load setup state:', err);
	}
}

async function loadDynamicSettings() {
	try {
		const res = await fetch(`${PROXY_INTERNAL_BASE_URL}/admin/settings/bot`, {
			headers: { 'x-internal-secret': INTERNAL_API_SECRET },
		});
		if (res.ok) {
			const config = await res.json();
			if (config.agverifChannelId) AGVERIF_CHANNEL_ID = config.agverifChannelId;
			if (config.tokitoChannelId) TOKITO_CHANNEL_ID = config.tokitoChannelId;
			if (config.requiredRoleId) REQUIRED_ROLE_ID = config.requiredRoleId;
			if (config.ownerGroupyRoleId)
				OWNER_GROUPY_ROLE_ID = config.ownerGroupyRoleId;
			if (config.verifiedRoleId) VERIFIED_ROLE_ID = config.verifiedRoleId;
			if (config.tokitoApiKey) TOKITO_API_KEY = config.tokitoApiKey;
			if (config.geminiApiKey) process.env.GOOGLE_API_KEY = config.geminiApiKey; // Update process.env so getGoogleApiKeys reads it
			if (config.verifAutoEnabled !== undefined)
				VERIF_AUTO_ENABLED = config.verifAutoEnabled;

			// Note: BOT_TOKEN change requires restart, but we update the memory variable just in case
			if (config.discordBotToken && !BOT_TOKEN)
				BOT_TOKEN = config.discordBotToken;
		}
	} catch (err) {
		console.error(
			'[agverif] Failed to fetch dynamic settings from proxy, falling back to ENV variables:',
			err.message,
		);
	}
}

// ==========================================
// TOKITO MODEL MONITORING
// ==========================================
const PANEL_STATUS = 'tokito_panel_status';
const PANEL_LATENCY = 'tokito_panel_latency';
const PANEL_DETAILS = 'tokito_panel_details';
const STATE_PATH = path.join(AGVERIF_DATA_DIR, 'tokito_state.json');

const tokitoSessions = new Map();
const runtime = {
	models: [],
	modelEntries: [],
	modelProviderMap: new Map(),
	latency: new Map(),
	lastLatencyAt: null,
	lastWorkingBaseUrl: TOKITO_BASE_URL,
	endpointStats: new Map(),
	activeProviders: [],
	modelRetryState: new Map(), // entryKey -> { retryCount, lastTestAt, suspendedUntil }
	providerKeys: new Map(), // providerName -> [apiKey1, apiKey2, ...]
	monitorTimersStarted: false,
};

function loadTokitoState() {
	return fs
		.readFile(STATE_PATH, 'utf8')
		.then(JSON.parse)
		.catch(() => ({ panelMessageId: null }));
}
function saveTokitoState(nextState) {
	fs.writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), 'utf8').catch(
		() => {},
	);
}

async function apiFetch(endpoint, options = {}) {
	const maxIndex = Number(TOKITO_FALLBACK_MAX_INDEX || 1);
	const baseUrls = [];
	for (let i = 1; i <= maxIndex; i++) {
		baseUrls.push(i === 1 ? TOKITO_BASE_URL : `https://api${i}.tokito.xyz/v1`);
	}

	let lastResult = {
		ok: false,
		status: 0,
		body: { error: 'no attempt' },
		baseUrl: baseUrls[0],
	};

	for (const baseUrl of baseUrls) {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			TOKITO_REQUEST_TIMEOUT_MS,
		);
		try {
			const res = await fetch(`${baseUrl}${endpoint}`, {
				...options,
				headers: {
					Authorization: `Bearer ${TOKITO_API_KEY}`,
					'Content-Type': 'application/json',
					...(options.headers || {}),
				},
				signal: controller.signal,
			});
			const text = await res.text();
			let body;
			try {
				body = JSON.parse(text);
			} catch (_) {
				body = { raw: text };
			}

			const result = { ok: res.ok, status: res.status, body, baseUrl };
			lastResult = result;

			if (res.ok) {
				runtime.lastWorkingBaseUrl = baseUrl;
				trackEndpointResult(baseUrl, true);
				return result;
			}
			trackEndpointResult(baseUrl, false);
			if (res.status === 502 || res.status === 503 || res.status === 504)
				continue;
			return result;
		} catch (err) {
			lastResult = {
				ok: false,
				status: 0,
				body: { error: err.message },
				baseUrl,
			};
			trackEndpointResult(baseUrl, false);
			continue;
		} finally {
			clearTimeout(timeout);
		}
	}
	return lastResult;
}

function providerOf(modelId) {
	if (!modelId.includes('/')) return 'unknown';
	return modelId.split('/')[0];
}

function entryKey(entry) {
	return `${entry.provider}:${entry.modelId}`;
}

/** Model is online only when chat/completions returned HTTP 2xx. */
function isMonitorOnline(status) {
	return status >= 200 && status < 300;
}

function trackEndpointResult(baseUrl, ok) {
	const prev = runtime.endpointStats.get(baseUrl) || {
		ok: 0,
		fail: 0,
		lastUsedAt: null,
	};
	if (ok) prev.ok += 1;
	else prev.fail += 1;
	prev.lastUsedAt = Date.now();
	runtime.endpointStats.set(baseUrl, prev);
}

async function fetchProvidersFromProxy() {
	try {
		const res = await proxyInternal('/admin/internal/providers', 'GET');
		if (Array.isArray(res) && res.length > 0) {
			runtime.activeProviders = res;
			console.log(
				'[tokito-monitor] fetched',
				res.length,
				'providers from proxy',
			);
			return res;
		}
	} catch (err) {
		console.error(
			'[tokito-monitor] failed to fetch providers:',
			err.message || JSON.stringify(err),
		);
	}
	return null;
}

function sanitizeProviderApiKey(raw) {
	return String(raw || '')
		.trim()
		.replace(/^Bearer\s+/i, '')
		.replace(/^key:\s*/i, '');
}

async function fetchProviderModelList(prov) {
	const base = String(prov.endpoint || '')
		.replace(/\/+$/, '');
	const endpointType = prov.endpointType || 'openai';
	const candidates = [`${base}/v1/models`, `${base}/models`];
	if (base.endsWith('/v1')) {
		candidates.length = 0;
		candidates.push(`${base}/models`);
	}
	const uniqueUrls = [...new Set(candidates)];

	const poolKeys = runtime.providerKeys.get(prov.name) || [];
	const cleanPrimary = sanitizeProviderApiKey(prov.apiKey);
	// Prefer usable (non-limited) pool keys. Legacy only if pool is empty
	// (true legacy providers with no provider_api_keys rows yet).
	const keysToTry = [
		...new Set(
			(poolKeys.length > 0
				? poolKeys.map(sanitizeProviderApiKey)
				: [cleanPrimary]
			).filter(Boolean),
		),
		'', // last resort: unauthenticated (some public gateways)
	];

	const errors = [];
	for (const url of uniqueUrls) {
		for (const key of keysToTry) {
			for (let attempt = 1; attempt <= 2; attempt++) {
				try {
					const controller = new AbortController();
					const timeout = setTimeout(() => controller.abort(), 30_000);
					const headers = { Accept: 'application/json' };
					if (key) {
						if (endpointType === 'anthropic') {
							headers['x-api-key'] = key;
							headers['anthropic-version'] = '2023-06-01';
							headers.Authorization = `Bearer ${key}`;
						} else {
							headers.Authorization = `Bearer ${key}`;
						}
					}
					const res = await fetch(url, {
						headers,
						signal: controller.signal,
					});
					clearTimeout(timeout);
					if (!res.ok) {
						errors.push(`${url} key=${key ? 'yes' : 'no'} HTTP ${res.status}`);
						continue;
					}
					const payload = await res.json();
					const arr = Array.isArray(payload)
						? payload
						: payload?.data || payload?.models || [];
					if (!Array.isArray(arr) || arr.length === 0) {
						errors.push(`${url} empty list`);
						continue;
					}
					return {
						arr,
						url,
						baseUrl: base,
						apiKey: key || cleanPrimary || prov.apiKey,
					};
				} catch (err) {
					errors.push(
						`${url} attempt=${attempt}: ${err?.message || err}`,
					);
					if (attempt === 1) {
						await new Promise((r) => setTimeout(r, 800));
					}
				}
			}
		}
	}
	if (errors.length) {
		console.warn(
			`[tokito-monitor] fetch models ${prov.name} failed: ${errors.slice(0, 4).join(' | ')}`,
		);
	}
	return null;
}

async function pollModelStatus() {
	let providers = await fetchProvidersFromProxy();

	if (!providers || providers.length === 0) {
		console.log(
			'[tokito-monitor] no providers configured, falling back to TOKITO_BASE_URL',
		);
		if (!TOKITO_API_KEY) return;
		const result = await apiFetch('/models');
		if (!result.ok || !result.body || !Array.isArray(result.body.data)) {
			return;
		}
		runtime.models = result.body.data.map((m) => m.id);
		return;
	}

	const now = Date.now();
	const allModels = [];
	runtime.modelProviderMap.clear();
	runtime.modelEntries = [];
	runtime.providerKeys = new Map(); // Store all active keys per provider

	for (const prov of providers) {
		try {
			// Fetch all active API keys for this provider
			try {
				const keysResult = await proxyInternal(
					`/admin/providers/${prov.id}/keys`,
					'GET',
				);
				if (Array.isArray(keysResult)) {
					const activeKeys = keysResult
						.filter((k) => k.isActive && !k.isLimited)
						.map((k) => k.apiKey);
					if (activeKeys.length > 0) {
						runtime.providerKeys.set(prov.name, activeKeys);
						console.log(
							`[tokito-monitor] loaded ${activeKeys.length} active keys for provider: ${prov.name}`,
						);
					}
				}
			} catch (err) {
				console.error(
					`[tokito-monitor] failed to fetch keys for ${prov.name}:`,
					err.message || JSON.stringify(err),
				);
			}

			// you.com providers do not expose a /v1/models endpoint. Synthesize the
			// two known agents (express, advanced) and probe them via the proxy's
			// OpenAI-compatible /v1/chat/completions, which the proxy routes to
			// the you.com adapter.
			if (prov.endpointType === 'youcom') {
				const provKeys = runtime.providerKeys.get(prov.name) || [];
				const provApiKey = provKeys[0] || prov.apiKey || '';
				const proxyV1Base = PROXY_PUBLIC_BASE_URL.replace(/\/+$/, '') + '/v1';
				for (const modelId of ['express', 'advanced']) {
					const catalogId = modelId; // bare id; provider column = youcom name
					const entry = {
						modelId: catalogId,
						provider: prov.name,
						baseUrl: proxyV1Base,
						apiKey: TOKITO_API_KEY || provApiKey,
						endpointType: 'openai',
						probeViaProxy: true,
					};
					allModels.push(`${prov.name}/${catalogId}`);
					runtime.modelEntries.push(entry);
					runtime.modelProviderMap.set(catalogId, {
						provider: prov.name,
						baseUrl: proxyV1Base,
						apiKey: TOKITO_API_KEY || provApiKey,
					});
				}
				console.log(
					`[tokito-monitor] added 2 synthetic you.com models for provider: ${prov.name}`,
				);
				continue;
			}

			const result = await fetchProviderModelList(prov);
			if (!result) {
				console.error(
					`[tokito-monitor] failed to fetch models from ${prov.name} — soft-retaining previous monitor rows`,
				);
				try {
					const prev = await proxyInternal(
						'/admin/internal/monitor/models',
						'GET',
					);
					const rows = Array.isArray(prev?.data)
						? prev.data
						: Array.isArray(prev)
							? prev
							: [];
					const provKeys = runtime.providerKeys.get(prov.name) || [];
					const fallbackKey = provKeys[0] || '';
					const baseUrl = String(prov.endpoint || '').replace(
						/\/+$/,
						'',
					);
					let retained = 0;
					for (const row of rows) {
						if (
							String(row.provider || '').toLowerCase() !==
							String(prov.name || '').toLowerCase()
						) {
							continue;
						}
						const id = row.modelId || row.model_id;
						if (!id) continue;
						if (
							runtime.modelEntries.some(
								(e) =>
									e.modelId === id &&
									e.provider === prov.name,
							)
						) {
							continue;
						}
						allModels.push(id);
						runtime.modelEntries.push({
							modelId: id,
							provider: prov.name,
							baseUrl,
							apiKey: fallbackKey,
							endpointType: prov.endpointType || 'openai',
						});
						runtime.modelProviderMap.set(id, {
							provider: prov.name,
							baseUrl,
							apiKey: fallbackKey,
						});
						retained++;
					}
					if (!fallbackKey) {
						console.warn(
							`[tokito-monitor] ${prov.name}: no usable API keys — retained models will stay Offline until keys are reset`,
						);
					}
					console.warn(
						`[tokito-monitor] retained ${retained} models for ${prov.name} (check API keys if 0)`,
					);
				} catch (retainErr) {
					console.error(
						`[tokito-monitor] soft-retain failed for ${prov.name}:`,
						retainErr?.message || retainErr,
					);
				}
				continue;
			}
			const { arr, url, baseUrl, apiKey } = result;
			for (const m of arr) {
				const id = m.id || m.name;
				allModels.push(id);
				const entry = {
					modelId: id,
					provider: prov.name,
					baseUrl,
					apiKey,
					endpointType: prov.endpointType || 'openai',
				};
				runtime.modelEntries.push(entry);
				runtime.modelProviderMap.set(id, {
					provider: prov.name,
					baseUrl,
					apiKey,
				});
			}
			console.log(
				`[tokito-monitor] fetched ${arr.length} models from provider: ${prov.name} (${url})`,
			);
		} catch (err) {
			console.error(
				`[tokito-monitor] error fetching from ${prov.name}:`,
				err.message || JSON.stringify(err),
			);
		}
	}

	// Fetch custom models from proxy API and add them to the list
	try {
		const customModelsResult = await proxyInternal(`/admin/providers`, 'GET');
		if (Array.isArray(customModelsResult)) {
			console.log(
				`[tokito-monitor] fetched ${customModelsResult.length} providers from proxy for custom models check`,
			);
			for (const prov of customModelsResult) {
				try {
					const customModels = await proxyInternal(
						`/admin/providers/${prov.id}/custom-models`,
						'GET',
					);
					if (Array.isArray(customModels) && customModels.length > 0) {
						console.log(
							`[tokito-monitor] found ${customModels.length} custom models for provider: ${prov.name}`,
						);
						// Only usable (non-limited) pool keys — same as live traffic.
						const provKeys = runtime.providerKeys.get(prov.name) || [];
						const fallbackApiKey =
							provKeys.length > 0
								? provKeys[0]
								: '';
						// Resolve baseUrl: use provider's endpoint
						const baseUrl = prov.endpoint || '';

						if (!fallbackApiKey) {
							console.warn(
								`[tokito-monitor] skip custom models for ${prov.name}: no usable API keys`,
							);
							continue;
						}

						for (const cm of customModels) {
							if (!cm.isActive) continue;
							const id = cm.modelId;
							const apiKey = fallbackApiKey;

							if (!allModels.includes(id)) {
								allModels.push(id);
								const entry = {
									modelId: id,
									provider: prov.name,
									baseUrl,
									apiKey,
									endpointType: prov.endpointType || 'openai',
								};
								runtime.modelEntries.push(entry);
								runtime.modelProviderMap.set(id, {
									provider: prov.name,
									baseUrl,
									apiKey,
								});
								console.log(
									`[tokito-monitor] added custom model: ${id} from provider: ${prov.name} baseUrl=${baseUrl} apiKey=${apiKey ? 'OK' : 'EMPTY'}`,
								);
							}
						}
					}
				} catch (err) {
					const errMsg =
						err.message ||
						(typeof err === 'object' ? JSON.stringify(err) : String(err));
					console.error(
						`[tokito-monitor] error fetching custom models from ${prov.name}:`,
						errMsg,
					);
				}
			}
		}
	} catch (err) {
		const errMsg =
			err.message ||
			(typeof err === 'object' ? JSON.stringify(err) : String(err));
		console.error(
			`[tokito-monitor] error fetching providers for custom models:`,
			errMsg,
		);
	}

	runtime.models = allModels;

	// Keep trial gpy list available even when gpy upstream /models is 401.
	await ensureGpyModelEntries();

	// Drop cached latency for providers no longer active
	const validKeys = new Set(runtime.modelEntries.map(entryKey));
	for (const key of runtime.latency.keys()) {
		if (!validKeys.has(key)) runtime.latency.delete(key);
	}
}

async function pushMetricsToProxy() {
	const payload = runtime.modelEntries.map((entry) => {
		const key = entryKey(entry);
		const lt = runtime.latency.get(key) || {
			ms: 0,
			status: 0,
			ok: false,
			error: null,
		};
		return {
			modelId: entry.modelId,
			provider: entry.provider,
			modelVendor: providerOf(entry.modelId),
			isOnline: Boolean(lt.ok),
			latencyMs: lt.ms,
			httpStatus: lt.status,
			errorMessage: lt.error || null,
			baseUrl: entry.baseUrl,
		};
	});

	try {
		await proxyInternal('/admin/internal/monitor/models', 'POST', payload);
	} catch (err) {
		console.error(
			'[tokito-monitor] failed to push metrics to proxy:',
			err.message,
		);
	}
}

/** Push a single model result to the proxy with retry tracking. */
async function pushSingleModelStatus(entry, latencyResult) {
	try {
		await proxyInternal('/admin/internal/monitor/models/status', 'PATCH', {
			modelId: entry.modelId,
			provider: entry.provider,
			isOnline: Boolean(latencyResult.ok),
			latencyMs: latencyResult.ms,
			httpStatus: latencyResult.status,
			errorMessage: latencyResult.error || null,
			baseUrl: entry.baseUrl,
		});
	} catch (err) {
		console.error(
			`[tokito-monitor] failed to push status for ${entry.modelId}:`,
			err.message,
		);
	}
}

async function fetchMonitorAutoMode() {
	try {
		const data = await proxyInternal(
			'/admin/internal/monitor/auto-mode',
			'GET',
		);
		const mode = String(data?.mode || 'notif_only').toLowerCase();
		if (mode === 'off' || mode === 'auto' || mode === 'notif_only') return mode;
	} catch (_) {}
	return 'notif_only';
}

/** Models force-OFF by admin — still probe-safe to skip to save upstream quota. */
async function getForceDeactivatedKeys() {
	const keys = new Set();
	try {
		const prev = await proxyInternal(
			'/admin/internal/monitor/models',
			'GET',
		);
		const rows = Array.isArray(prev?.data)
			? prev.data
			: Array.isArray(prev)
				? prev
				: [];
		for (const row of rows) {
			const msg = String(row.errorMessage || row.error_message || '');
			const online = row.isOnline ?? row.is_online;
			if (!online && /force-deactivated/i.test(msg)) {
				keys.add(`${row.provider || ''}:${row.modelId || row.model_id}`);
			}
		}
	} catch (_) {}
	return keys;
}

/** Refresh runtime.latency from proxy database (for fresh data on button click). */
async function ensureGpyModelEntries() {
	const hasGpy = runtime.modelEntries.some(
		(e) => (e.provider || '').toLowerCase() === 'gpy',
	);
	if (hasGpy) return;
	try {
		const data = await proxyInternal('/admin/internal/trial-models');
		const gpy = data?.gpyModels || [];
		if (!gpy.length) return;
		const proxyV1Base = PROXY_PUBLIC_BASE_URL.replace(/\/+$/, '') + '/v1';
		for (const id of gpy) {
			const lower = id.toLowerCase();
			if (!lower.startsWith('gpy/')) continue;
			const slash = id.indexOf('/');
			const provider = 'gpy';
			// For multi-upstream gpy/webnet/claude-sonnet, the underlying
			// upstream is webnet (so entry.modelId = webnet/claude-sonnet).
			const upstreamPath = id.slice(slash + 1); // e.g. "webnet/glm-5"
			const modelId = upstreamPath;
			if (
				runtime.modelEntries.some(
					(e) =>
						e.modelId === modelId &&
						(e.provider || '').toLowerCase() === provider,
				)
			) {
				continue;
			}
			const entry = {
				modelId,
				provider,
				baseUrl: proxyV1Base,
				apiKey: TOKITO_API_KEY || '',
				endpointType: 'openai',
				probeViaProxy: true,
			};
			runtime.modelEntries.push(entry);
			if (!runtime.models.includes(modelId)) runtime.models.push(modelId);
		}
		console.log(
			`[tokito-monitor] injected ${gpy.length} gpy model entries (multi-upstream)`,
		);
	} catch (err) {
		console.error(
			'[tokito-monitor] ensureGpyModelEntries failed:',
			err.message || JSON.stringify(err),
		);
	}
}

async function refreshLatencyFromProxy() {
	try {
		const result = await proxyInternal('/admin/internal/monitor/models', 'GET');
		if (result?.data && Array.isArray(result.data)) {
			// Update model entries and latency cache from DB
			const newEntries = [];
			const newLatency = new Map();

			for (const row of result.data) {
				const provider = row.provider;
				const provKeys = runtime.providerKeys.get(provider) || [];
				const prev = runtime.modelEntries.find(
					(e) => e.modelId === row.modelId && e.provider === provider,
				);
				const entry = {
					modelId: row.modelId,
					provider,
					baseUrl: row.baseUrl || prev?.baseUrl || '',
					apiKey:
						prev?.apiKey ||
						provKeys[0] ||
						'',
					endpointType: prev?.endpointType || 'openai',
					probeViaProxy: prev?.probeViaProxy,
				};
				newEntries.push(entry);
				const key = entryKey(entry);
				newLatency.set(key, {
					// clientOnline = published AND probe OK (green / requestable)
					ok: Boolean(row.isOnline) && Number(row.httpStatus) >= 200 && Number(row.httpStatus) < 300,
					// visible on Discord = published OR probe OK
					visible:
						Boolean(row.isOnline) ||
						(Number(row.httpStatus) >= 200 && Number(row.httpStatus) < 300),
					ms: row.latencyMs || 0,
					checkedAt: row.checkedAt
						? new Date(row.checkedAt).getTime()
						: Date.now(),
					status: row.httpStatus || 0,
					error: row.errorMessage || null,
					published: Boolean(row.isOnline),
				});
			}

			// Update runtime with fresh data from DB
			if (newEntries.length > 0) {
				runtime.modelEntries = newEntries;
				runtime.latency = newLatency;
				runtime.models = [...new Set(newEntries.map((e) => e.modelId))];
				// Don't update lastLatencyAt here - only sweeps should set it
			}

			console.log(
				`[tokito-monitor] refreshed ${newEntries.length} models from proxy DB`,
			);
		}
		// Fallback: kalau provider gpy di DB tidak return gpy/ di /v1/models,
		// inject manual list dari trial-models endpoint supaya trial user panel
		// tetap bisa lihat model gpy.
		await ensureGpyModelEntries();
	} catch (err) {
		console.error(
			'[tokito-monitor] failed to refresh from proxy:',
			err.message || JSON.stringify(err),
		);
	}
}

async function runLatencyTest() {
	await pollModelStatus();
	if (!runtime.models.length) return;

	const now = Date.now();

	const jobs = runtime.modelEntries.map(async (entry) => {
		const started = Date.now();
		const baseUrl = entry.baseUrl;
		const apiKey = entry.apiKey;

		let result;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				TOKITO_REQUEST_TIMEOUT_MS,
			);
			const res = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: entry.modelId,
					messages: [{ role: 'user', content: 'test' }],
					max_tokens: 1,
					temperature: 0,
				}),
				signal: controller.signal,
			});
			clearTimeout(timeout);
			const text = await res.text();
			let body;
			try {
				body = JSON.parse(text);
			} catch (_) {
				body = { raw: text };
			}
			result = { ok: res.ok, status: res.status, body };
		} catch (err) {
			result = { ok: false, status: 0, body: { error: err.message } };
		}

		const ms = Date.now() - started;
		const key = entryKey(entry);
		const prev = runtime.latency.get(key);
		const published = Boolean(prev?.published);
		const probeOk = Boolean(result.ok);
		runtime.latency.set(key, {
			ok: published && probeOk,
			visible: published || probeOk,
			published,
			ms,
			checkedAt: now,
			status: result.status,
			error: result.body?.error?.message || (result.ok ? null : 'Failed'),
		});
	});

	await Promise.all(jobs);
	runtime.lastLatencyAt = now;

	await pushMetricsToProxy();
}

// ─── Smart Retry: Test a single model and return latency result ────────────────

function isValidProbeBody(status, contentType, bodyText) {
	if (status < 200 || status >= 300) return false;
	const text = String(bodyText || '');
	const ct = String(contentType || '').toLowerCase();
	if (ct.includes('text/event-stream') || /^\s*data:\s*/m.test(text)) {
		let hasContent = false;
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('data:')) continue;
			const data = trimmed.slice(5).trim();
			if (!data || data === '[DONE]') continue;
			try {
				const j = JSON.parse(data);
				if (j?.error) return false;
				const delta = j?.choices?.[0]?.delta || {};
				if (typeof delta.content === 'string' && delta.content.length > 0)
					hasContent = true;
				if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)
					hasContent = true;
				const fr = j?.choices?.[0]?.finish_reason;
				if (fr) hasContent = true;
			} catch {
				/* ignore */
			}
		}
		return hasContent;
	}
	try {
		const j = JSON.parse(text);
		if (j?.error) return false;
		const msg = j?.choices?.[0]?.message;
		if (typeof msg?.content === 'string' && msg.content.trim()) return true;
		if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length) return true;
		if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim())
			return true;
		if (Array.isArray(j?.content) && j.content.length) return true;
		const fr = String(j?.choices?.[0]?.finish_reason || j?.stop_reason || '').toLowerCase();
		if (
			['stop', 'end_turn', 'length', 'max_tokens'].includes(fr) &&
			Array.isArray(j?.choices) &&
			j.choices.length
		) {
			return true;
		}
		return false;
	} catch {
		return text.trim().length > 0;
	}
}

async function testSingleModel(entry) {
	const started = Date.now();
	const baseUrl = entry.baseUrl;
	const provider = entry.provider;
	const endpointType = entry.endpointType || 'openai';

	const providerKeys = runtime.providerKeys.get(provider) || [];
	// Only keys that live traffic can use (non-limited). Never probe with
	// entry.apiKey / legacy if those are marked limited — that caused false Online.
	const keysToTry = [...new Set(providerKeys.filter(Boolean))];

	let result = { ok: false, status: 0, body: { error: 'No keys' }, raw: '' };

	for (let attempt = 1; attempt <= SWEEP_ATTEMPTS; attempt++) {
		for (const apiKey of keysToTry) {
			try {
				const controller = new AbortController();
				const timeout = setTimeout(
					() => controller.abort(),
					TOKITO_REQUEST_TIMEOUT_MS,
				);
				let url;
				let headers;
				let body;
				if (endpointType === 'anthropic') {
					const base = baseUrl.replace(/\/+$/, '');
					url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
					headers = {
						'Content-Type': 'application/json',
						'x-api-key': apiKey,
						'anthropic-version': '2023-06-01',
					};
					body = JSON.stringify({
						model: entry.modelId,
						max_tokens: 8,
						messages: [{ role: 'user', content: 'hi' }],
					});
				} else {
					const base = baseUrl.replace(/\/+$/, '');
					url = base.endsWith('/v1')
						? `${base}/chat/completions`
						: `${base}/v1/chat/completions`;
					const proxyBase = String(PROXY_PUBLIC_BASE_URL || '').replace(
						/\/+$/,
						'',
					);
					const viaProxy =
						entry.probeViaProxy ||
						(proxyBase && base.startsWith(proxyBase));
					const probeModel = viaProxy
						? entry.modelId.includes('/')
							? entry.modelId
							: `${provider}/${entry.modelId}`
						: entry.modelId;
					headers = {
						Authorization: `Bearer ${viaProxy && TOKITO_API_KEY ? TOKITO_API_KEY : apiKey}`,
						'Content-Type': 'application/json',
						'User-Agent': 'TokitoMonitor/1.0 (Windows NT 10.0; Win64; x64)',
						'x-device-id': 'tokito-monitor-sweep',
					};
					body = JSON.stringify({
						model: probeModel,
						messages: [{ role: 'user', content: 'test' }],
						max_tokens: 8,
						temperature: 0,
						stream: false,
					});
				}
				const res = await fetch(url, {
					method: 'POST',
					headers,
					body,
					signal: controller.signal,
				});
				clearTimeout(timeout);
				const text = await res.text();
				const ct = res.headers.get('content-type') || '';
				let parsed;
				try {
					parsed = JSON.parse(text);
				} catch (_) {
					parsed = { raw: text.slice(0, 200) };
				}
				result = { ok: res.ok, status: res.status, body: parsed, raw: text };

				if (res.ok && isValidProbeBody(res.status, ct, text)) {
					return {
						ok: true,
						ms: Date.now() - started,
						checkedAt: Date.now(),
						status: res.status,
						error: null,
						attempts: attempt,
					};
				}
				if (res.ok) {
					result = {
						ok: false,
						status: res.status,
						body: { error: 'Empty/invalid probe body' },
						raw: text,
					};
				}
				continue;
			} catch (err) {
				result = { ok: false, status: 0, body: { error: err.message }, raw: '' };
				continue;
			}
		}
		if (attempt < SWEEP_ATTEMPTS) {
			await new Promise((r) => setTimeout(r, 400 * attempt));
		}
	}

	const ms = Date.now() - started;
	return {
		ok: false,
		ms,
		checkedAt: Date.now(),
		status: result.status,
		error: result.body?.error?.message || result.body?.error || 'Failed',
		attempts: SWEEP_ATTEMPTS,
	};
}

// ─── Smart Retry: update retry state after a model test ─────────────────────

function applyModelRetryState(entry, latency) {
	const key = entryKey(entry);
	if (latency.ok) {
		runtime.modelRetryState.delete(key);
		return;
	}
	// Infra / config failures must NOT soft-suspend — otherwise the 10-min
	// cadence stops probing real models for 24h (dashboard looks "stale").
	const err = String(latency.error || '');
	if (
		latency.status === 0 &&
		(/no keys/i.test(err) || /fetch failed|network|econn|enotfound/i.test(err))
	) {
		runtime.modelRetryState.set(key, {
			retryCount: 0,
			lastTestAt: new Date().toISOString(),
			suspendedUntil: null,
		});
		return;
	}
	if (latency.status === 429) {
		runtime.modelRetryState.set(key, {
			retryCount: 0,
			lastTestAt: new Date().toISOString(),
			suspendedUntil: null,
			isRateLimited: true,
		});
		return;
	}
	const current = runtime.modelRetryState.get(key) || { retryCount: 0 };
	const newRetryCount = current.retryCount + 1;
	// Soft-suspend only affects the *retry* sweep. Full 10-min sweep ignores it.
	const suspendedUntil =
		newRetryCount >= 3
			? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
			: null;
	runtime.modelRetryState.set(key, {
		retryCount: newRetryCount,
		lastTestAt: new Date().toISOString(),
		suspendedUntil,
	});
}

async function runSweepForProviderPrefix(matcher, label, opts = {}) {
	const mode = await fetchMonitorAutoMode();
	if (mode === 'off' && !opts.force) {
		console.log(
			`[tokito-monitor] ${label} skipped (monitorAutoMode=off)`,
		);
		return;
	}
	await pollModelStatus();
	if (!runtime.modelEntries.length) return;
	const filtered = runtime.modelEntries.filter((e) => matcher(e));
	if (!filtered.length) return;
	const forcedOff = await getForceDeactivatedKeys();
	// For gpy 10min cadence we DO NOT honor suspendedUntil — trial-critical
	// models must be re-tested every 10 minutes regardless of how many times
	// they previously failed (otherwise they would be skipped for 24h after
	// 3 consecutive failures like the standard retry sweep).
	const queue = filtered.filter((entry) => {
		const fk = `${entry.provider || ''}:${entry.modelId}`;
		if (forcedOff.has(fk)) return false;
		if (opts.ignoreSuspend) return true;
		const key = entryKey(entry);
		const retryState = runtime.modelRetryState.get(key);
		if (retryState?.suspendedUntil) {
			const suspendedUntil = new Date(retryState.suspendedUntil).getTime();
			if (Date.now() < suspendedUntil) return false;
		}
		return true;
	});
	await sweepModelsParallel(queue, label);
}

const GPY_WEBNET_MATCHER = (e) =>
	e.provider === 'gpy' && /^webnet\//i.test(e.modelId);

async function sweepModelsParallel(entries, label) {
	if (!entries.length) return;
	const concurrency =
		SWEEP_CONCURRENCY <= 0 ? entries.length : SWEEP_CONCURRENCY;
	console.log(
		`[tokito-monitor] ${label}: testing ${entries.length} models concurrent` +
			` (batch=${concurrency}, attempts=${SWEEP_ATTEMPTS}, timeout=${TOKITO_REQUEST_TIMEOUT_MS}ms)`,
	);
	for (let i = 0; i < entries.length; i += concurrency) {
		const batch = entries.slice(i, i + concurrency);
		const results = await Promise.allSettled(
			batch.map(async (entry) => {
				const latency = await testSingleModel(entry);
				const key = entryKey(entry);
				const prev = runtime.latency.get(key);
				const published = Boolean(prev?.published);
				const probeOk = Boolean(latency.ok);
				const merged = {
					...latency,
					ok: published && probeOk,
					visible: published || probeOk,
					published,
					// Keep raw probe success for pushSingleModelStatus / retry state
					probeOk,
				};
				runtime.latency.set(key, merged);
				await pushSingleModelStatus(entry, { ...latency, ok: probeOk });
				return { entry, latency: { ...latency, ok: probeOk } };
			}),
		);
		for (const r of results) {
			if (r.status !== 'fulfilled') continue;
			applyModelRetryState(r.value.entry, r.value.latency);
			if (label === 'retry sweep' && r.value.latency.ok) {
				console.log(
					`[tokito-monitor] model back online: ${r.value.entry.modelId}`,
				);
			}
		}
	}
	runtime.lastLatencyAt = Date.now();
	console.log(`[tokito-monitor] ${label} complete`);
}

// ─── Smart Retry: Full sweep — test ALL models, push results individually ─────

async function runFullSweep(opts = {}) {
	const ignoreSuspend = opts.ignoreSuspend !== false; // default TRUE for 10-min cadence
	const mode = await fetchMonitorAutoMode();
	if (mode === 'off' && !opts.force) {
		console.log(
			'[tokito-monitor] full sweep skipped (monitorAutoMode=off)',
		);
		return;
	}
	await pollModelStatus();
	if (!runtime.modelEntries.length) return;

	const forcedOff = await getForceDeactivatedKeys();
	const queued = runtime.modelEntries.filter((entry) => {
		const fk = `${entry.provider || ''}:${entry.modelId}`;
		if (forcedOff.has(fk)) return false;
		if (ignoreSuspend) return true;
		const key = entryKey(entry);
		const retryState = runtime.modelRetryState.get(key);
		if (retryState?.suspendedUntil) {
			const suspendedUntil = new Date(retryState.suspendedUntil).getTime();
			if (Date.now() < suspendedUntil) return false;
		}
		return true;
	});

	const skipped = runtime.modelEntries.length - queued.length;
	if (skipped > 0) {
		console.log(
			`[tokito-monitor] full sweep: skipping ${skipped} soft-suspended/force-OFF models`,
		);
	}

	await sweepModelsParallel(queued, 'full sweep');
}

// ─── Smart Retry: Retry sweep — test only offline models that aren't suspended ─

async function runRetrySweep() {
	const mode = await fetchMonitorAutoMode();
	if (mode === 'off') {
		console.log(
			'[tokito-monitor] retry sweep skipped (monitorAutoMode=off)',
		);
		return;
	}
	await pollModelStatus(); // refresh keys + model list before retry probes
	if (!runtime.modelEntries.length) return;

	const forcedOff = await getForceDeactivatedKeys();
	const entriesToRetry = [];
	for (const entry of runtime.modelEntries) {
		const fk = `${entry.provider || ''}:${entry.modelId}`;
		if (forcedOff.has(fk)) continue;
		const key = entryKey(entry);
		const retryState = runtime.modelRetryState.get(key);

		if (!retryState) continue;
		if (retryState.isRateLimited) continue;
		if (retryState.retryCount >= 3) continue;

		if (retryState.suspendedUntil) {
			const suspendedUntil = new Date(retryState.suspendedUntil).getTime();
			if (Date.now() < suspendedUntil) continue;
		}

		entriesToRetry.push(entry);
	}

	await sweepModelsParallel(entriesToRetry, 'retry sweep');
}

// ─── Smart Retry: Midnight reset — clear all retry states ─────────────────────

async function midnightReset() {
	try {
		await proxyInternal('/admin/internal/monitor/models/state/reset', 'PATCH');
		runtime.modelRetryState.clear();
		console.log(
			'[tokito-monitor] midnight reset complete — all models eligible for testing',
		);
	} catch (err) {
		console.error(
			'[tokito-monitor] midnight reset failed:',
			err.message || JSON.stringify(err),
		);
	}
}

// ─── Smart Retry: Recover retry state from proxy on bot startup ───────────────

async function recoverRetryState() {
	try {
		const data = await proxyInternal(
			'/admin/internal/monitor/models/state',
			'GET',
		);
		const states = data?.states || [];
		for (const s of states) {
			const entry = runtime.modelEntries.find(
				(e) => e.modelId === s.modelId && e.provider === s.provider,
			);
			if (entry) {
				const key = entryKey(entry);
				runtime.modelRetryState.set(key, {
					retryCount: s.retryCount || 0,
					lastTestAt: s.lastTestAt || null,
					suspendedUntil: s.suspendedUntil || null,
				});
			}
		}
		if (states.length > 0) {
			console.log(
				`[tokito-monitor] recovered retry state for ${states.length} models`,
			);
		}
	} catch (err) {
		console.error(
			'[tokito-monitor] failed to recover retry state:',
			err.message || JSON.stringify(err),
		);
	}
}

// ─── Smart Retry: Schedule midnight reset at 00:00 Asia/Jakarta (UTC+7) ───────

function scheduleMidnightReset() {
	function msUntilMidnight() {
		const now = new Date();
		const jakartaOffset = 7 * 60 * 60000;
		const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
		const jakartaMs = utcMs + jakartaOffset;
		const jakartaDate = new Date(jakartaMs);
		jakartaDate.setHours(24, 0, 0, 0);
		const midnightUtcMs = jakartaDate.getTime() - jakartaOffset;
		return midnightUtcMs - now.getTime();
	}

	function scheduleNext() {
		const delay = msUntilMidnight();
		console.log(
			`[tokito-monitor] next midnight reset in ${Math.round(delay / 60000)} minutes`,
		);
		setTimeout(async () => {
			await midnightReset();
			scheduleNext(); // schedule the next one
		}, delay);
	}

	scheduleNext();
}

function buildDashboardLinkButton(label = 'More di Dashboard') {
	return new ButtonBuilder()
		.setLabel(label)
		.setEmoji('📊')
		.setStyle(ButtonStyle.Link)
		.setURL(PORTAL_DASHBOARD_URL);
}

function buildPanelRow() {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(PANEL_STATUS)
			.setLabel('Model Status')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(PANEL_LATENCY)
			.setLabel('Latency Benchmark')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(PANEL_DETAILS)
			.setLabel('Model Details')
			.setStyle(ButtonStyle.Secondary),
		buildDashboardLinkButton('Dashboard'),
	);
}

function buildPanelEmbed() {
	return new EmbedBuilder()
		.setTitle('API Checker Panel')
		.setColor(0x3498db)
		.setDescription(
			'Monitoring endpoint Tokito untuk validasi status model AI dan performa respons secara berkala.\n\n' +
				`Untuk detail lengkap (usage, keys, activity), buka [Dashboard](${PORTAL_DASHBOARD_URL}).`,
		)
		.addFields(
			{
				name: 'What This Does',
				value:
					'Status checker memantau model Available/Unavailable, lalu benchmark latency mengukur kecepatan respons (ms).',
				inline: false,
			},
			{
				name: 'How To Use',
				value:
					'Klik `Model Status` untuk melihat online/offline per model, atau `Latency Benchmark` untuk melihat waktu respons terbaru. Klik `Dashboard` untuk lihat more di web portal.',
				inline: false,
			},
		);
}

function formatRelative(ts) {
	if (!ts) return 'never';
	return `<t:${Math.floor(ts / 1000)}:R>`;
}

async function ensurePanelMessage() {
	if (!TOKITO_CHANNEL_ID) {
		console.log('[tokito] ensurePanelMessage: TOKITO_CHANNEL_ID is empty');
		return;
	}
	const state = await loadTokitoState();
	const channel = await client.channels.fetch(TOKITO_CHANNEL_ID).catch((e) => {
		console.error('[tokito] Failed to fetch channel:', e.message);
		return null;
	});
	if (!channel || !channel.isTextBased()) {
		console.log(
			'[tokito] ensurePanelMessage: Channel not found or not text based. ID:',
			TOKITO_CHANNEL_ID,
		);
		return;
	}

	const recent = await channel.messages.fetch({ limit: 50 });
	const panelMessages = recent.filter(
		(msg) =>
			msg.author.id === client.user.id &&
			msg.components?.some((row) =>
				row.components?.some(
					(c) =>
						c.customId === PANEL_STATUS ||
						c.customId === PANEL_LATENCY ||
						c.customId === PANEL_DETAILS,
				),
			),
	);

	const newestMessage = recent.first();
	let currentPanel = null;

	if (state.panelMessageId) {
		currentPanel = panelMessages.get(state.panelMessageId) || null;
	}
	if (!currentPanel && panelMessages.size > 0) {
		currentPanel = panelMessages
			.sort((a, b) => b.createdTimestamp - a.createdTimestamp)
			.first();
	}

	const shouldRecreate =
		!currentPanel || !newestMessage || currentPanel.id !== newestMessage.id;

	if (!shouldRecreate) {
		saveTokitoState({ panelMessageId: currentPanel.id });
		// Refresh embed + buttons in place (e.g. new Dashboard link)
		await currentPanel
			.edit({
				embeds: [buildPanelEmbed()],
				components: [buildPanelRow()],
			})
			.catch(() => {});
		for (const msg of panelMessages.values()) {
			if (msg.id !== currentPanel.id) await msg.delete().catch(() => {});
		}
		return;
	}

	for (const msg of panelMessages.values()) {
		await msg.delete().catch(() => {});
	}

	const sent = await channel.send({
		embeds: [buildPanelEmbed()],
		components: [buildPanelRow()],
	});
	saveTokitoState({ panelMessageId: sent.id });
}

let panelRefreshRunning = false;
async function refreshPanelToBottom() {
	if (panelRefreshRunning) return;
	panelRefreshRunning = true;
	try {
		await ensurePanelMessage();
	} finally {
		panelRefreshRunning = false;
	}
}

function createTokitoSession(userId, kind, access = null) {
	// Cleanup previous sessions for this user to prevent memory leak
	for (const [key, sess] of tokitoSessions.entries()) {
		if (sess.userId === userId) {
			tokitoSessions.delete(key);
		}
	}

	const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const trialMode = access?.mode === 'trial';
	const session = {
		id,
		userId,
		kind,
		page: 0,
		upstreamProvider: trialMode ? 'gpy' : 'all',
		modelVendor: 'all',
		sortMode: 'status_online_first',
		trialMode,
		trialCache: null,
	};
	tokitoSessions.set(id, session);
	return session;
}

function buildTokitoRows(
	kind,
	sessionId,
	page,
	totalPages,
	upstreamProvider,
	modelVendor,
	sortMode,
	trialMode = false,
) {
	const nav = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`tokito_prev_${sessionId}`)
			.setLabel('Prev')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 0),
		new ButtonBuilder()
			.setCustomId(`tokito_next_${sessionId}`)
			.setLabel('Next')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= totalPages - 1),
		new ButtonBuilder()
			.setCustomId(`tokito_close_${sessionId}`)
			.setLabel('Close')
			.setStyle(ButtonStyle.Danger),
	);

	if (trialMode) {
		return [nav];
	}

	const upstreamOptions = [
		'all',
		...new Set(runtime.modelEntries.map((e) => e.provider)),
	].slice(0, 25);
	const upstreamMenu = new StringSelectMenuBuilder()
		.setCustomId(`tokito_filter_upstream_${sessionId}`)
		.setPlaceholder('Upstream provider')
		.addOptions(
			upstreamOptions.map((p) => ({
				label: p,
				value: p,
				default: p === upstreamProvider,
			})),
		);

	let vendorSource = runtime.modelEntries;
	if (upstreamProvider !== 'all') {
		vendorSource = vendorSource.filter((e) => e.provider === upstreamProvider);
	}
	const vendorOptions = [
		'all',
		...new Set(vendorSource.map((e) => providerOf(e.modelId))),
	].slice(0, 25);
	const vendorMenu = new StringSelectMenuBuilder()
		.setCustomId(`tokito_filter_vendor_${sessionId}`)
		.setPlaceholder('Model vendor (ag/minimax/...)')
		.addOptions(
			vendorOptions.map((v) => ({
				label: v,
				value: v,
				default: v === modelVendor,
			})),
		);

	const sortMenu = new StringSelectMenuBuilder()
		.setCustomId(`tokito_filter_sort_${sessionId}`)
		.setPlaceholder('Sort mode')
		.addOptions([
			{
				label: 'Online First',
				value: 'status_online_first',
				default: sortMode === 'status_online_first',
			},
			{
				label: 'By Name',
				value: 'name_asc',
				default: sortMode === 'name_asc',
			},
			{
				label: 'By Provider',
				value: 'provider_asc',
				default: sortMode === 'provider_asc',
			},
			{
				label: 'Fast Latency',
				value: 'latency_fastest',
				default: sortMode === 'latency_fastest',
			},
			{
				label: 'Slow Latency',
				value: 'latency_slowest',
				default: sortMode === 'latency_slowest',
			},
		]);

	return [
		nav,
		new ActionRowBuilder().addComponents(upstreamMenu),
		new ActionRowBuilder().addComponents(vendorMenu),
		new ActionRowBuilder().addComponents(sortMenu),
	];
}

function listModels(
	kind,
	upstreamProvider,
	modelVendor,
	sortMode,
	session = null,
) {
	let items = [...runtime.modelEntries];

	if (session?.trialMode) {
		const cache = session.trialCache || trialModelsCache;
		items = items.filter((e) => entryMatchesTrialModel(e, cache));
	} else {
		const autoEntry = {
			modelId: 'auto',
			provider: 'proxy',
			baseUrl: '',
			apiKey: '',
		};
		items.unshift(autoEntry);
		// Public Discord: show visible models (published OR probeOk).
		// Green/online only when both (latency.ok). Natural offline stays hidden.
		items = items.filter((e) => {
			if (e.modelId === 'auto') return true;
			const lt = runtime.latency.get(entryKey(e));
			return Boolean(lt?.visible ?? lt?.ok);
		});
	}

	if (upstreamProvider !== 'all') {
		items = items.filter(
			(e) => e.provider === upstreamProvider || e.modelId === 'auto',
		);
	}
	if (modelVendor !== 'all') {
		items = items.filter(
			(e) => providerOf(e.modelId) === modelVendor || e.modelId === 'auto',
		);
	}

	items.sort((a, b) => a.modelId.localeCompare(b.modelId));
	// Keep auto at the top
	items.sort((a, b) =>
		a.modelId === 'auto' ? -1 : b.modelId === 'auto' ? 1 : 0,
	);

	if (sortMode === 'status_online_first') {
		items.sort((a, b) => {
			if (a.modelId === 'auto') return -1;
			if (b.modelId === 'auto') return 1;
			// Online first, then by latency (fastest first)
			const aOnline = runtime.latency.get(entryKey(a))?.ok ? 0 : 1;
			const bOnline = runtime.latency.get(entryKey(b))?.ok ? 0 : 1;
			if (aOnline !== bOnline) return aOnline - bOnline;
			const am =
				runtime.latency.get(entryKey(a))?.ms ?? Number.MAX_SAFE_INTEGER;
			const bm =
				runtime.latency.get(entryKey(b))?.ms ?? Number.MAX_SAFE_INTEGER;
			return am - bm;
		});
	}
	if (sortMode === 'provider_asc') {
		items.sort((a, b) => {
			if (a.modelId === 'auto') return -1;
			if (b.modelId === 'auto') return 1;
			return (
				(a.provider || '').localeCompare(b.provider || '') ||
				a.modelId.localeCompare(b.modelId)
			);
		});
	}
	if (sortMode === 'latency_fastest' || sortMode === 'latency_slowest') {
		items.sort((a, b) => {
			if (a.modelId === 'auto') return -1;
			if (b.modelId === 'auto') return 1;
			const am =
				runtime.latency.get(entryKey(a))?.ms ?? Number.MAX_SAFE_INTEGER;
			const bm =
				runtime.latency.get(entryKey(b))?.ms ?? Number.MAX_SAFE_INTEGER;
			return sortMode === 'latency_fastest' ? am - bm : bm - am;
		});
	}
	return items;
}

function displayLatencyForEntry(entry, session) {
	const lt = runtime.latency.get(entryKey(entry));
	if (session?.trialMode) {
		return { ok: true, ms: lt?.ms ?? null, status: 200 };
	}
	return lt;
}

function resolveModelDetailsMeta(entry, detailsCache) {
	const candidates = new Set([
		entry.modelId,
		`${entry.provider}/${entry.modelId}`,
	]);
	if (String(entry.modelId).startsWith('webnet/')) {
		candidates.add(`gpy/${entry.modelId}`);
	}
	for (const id of candidates) {
		const hit = detailsCache.find((m) => m.id === id);
		if (hit && (hit.context_length || hit.name || hit.pricing)) return hit;
	}
	return detailsCache.find(
		(m) =>
			m.id === entry.modelId ||
			m.id === `${entry.provider}/${entry.modelId}` ||
			(m.id && m.id.endsWith('/' + entry.modelId)),
	);
}

async function ensureModelDetailsCache() {
	if (runtime._modelDetailsCache?.length) return;
	try {
		const detailsData = await proxyInternal('/admin/internal/models/details');
		runtime._modelDetailsCache = detailsData?.data || [];
	} catch (err) {
		console.error(
			'[tokito] Failed to fetch model details cache:',
			err.message || err,
		);
		runtime._modelDetailsCache = runtime._modelDetailsCache || [];
	}
}

function buildTokitoEmbed(kind, session) {
	const pageSize = kind === 'details' ? 5 : TOKITO_PAGE_SIZE;
	const entries = listModels(
		kind,
		session.upstreamProvider,
		session.modelVendor,
		session.sortMode,
		session,
	);
	const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
	const page = Math.max(0, Math.min(session.page, totalPages - 1));
	session.page = page;

	const slice = entries.slice(page * pageSize, (page + 1) * pageSize);
	const lines = slice.map((entry) => {
		// Auto model: show special description
		if (entry.modelId === 'auto') {
			return `🤖 \`auto\` | **Auto-select**: picks fastest online model automatically`;
		}

		const vendor = providerOf(entry.modelId);
		const lt = displayLatencyForEntry(entry, session);

		if (kind === 'details') {
			const detailsCache = runtime._modelDetailsCache || [];
			const meta = resolveModelDetailsMeta(entry, detailsCache);
			const icon = lt?.ok ? '🟢' : lt?.status === 429 ? '🟡' : lt ? '🔴' : '⚪';
			const name = meta?.name || entry.modelId;
			const ctx = meta?.context_length
				? `${Math.round(meta.context_length / 1024)}K`
				: '—';
			const maxOut = meta?.max_output_tokens
				? `${Math.round(meta.max_output_tokens / 1024)}K`
				: '—';
			const inPrice =
				meta?.pricing?.prompt != null
					? `$${meta.pricing.prompt.toFixed(2)}`
					: '—';
			const outPrice =
				meta?.pricing?.completion != null
					? `$${meta.pricing.completion.toFixed(2)}`
					: '—';
			const inMod = (meta?.input_modalities || ['text']).join(', ');
			const outMod = (meta?.output_modalities || ['text']).join(', ');
			const latency = lt?.ms != null ? `${lt.ms}ms` : '—';
			const features =
				(meta?.supported_features || []).slice(0, 4).join(', ') || '—';
			return `━━━━━━━━━━━━━━━━━━━━\n${icon} **${name}** (\`${entry.modelId}\`)\n📐 Context/Input: **${ctx}**  •  Max Output: **${maxOut}**\n💰 In: **${inPrice}/M**  •  Out: **${outPrice}/M**\n📥 ${inMod} → ${outMod}\n⚡ ${latency}  •  🛠 ${features}`;
		}

		if (kind === 'status') {
			if (!lt || lt.status == null) {
				return `⚪ \`${entry.provider}/${entry.modelId}\` | not tested yet | vendor: **${vendor}**`;
			}
			const icon = lt.ok ? '🟢' : lt.status === 429 ? '🟡' : '🔴';
			const httpInfo =
				lt.status === 429
					? 'rate limited'
					: lt.status
						? `HTTP ${lt.status}`
						: 'timeout';
			return `${icon} \`${entry.provider}/${entry.modelId}\` | ${httpInfo} | vendor: **${vendor}**`;
		}

		if (!lt)
			return `⚪ \`${entry.provider}/${entry.modelId}\` | not tested yet`;
		const icon = lt.ok ? '🟢' : lt.status === 429 ? '🟡' : '🔴';
		const statusInfo = lt.status === 429 ? 'rate limited' : `HTTP ${lt.status}`;
		return `${icon} \`${entry.provider}/${entry.modelId}\` | ${lt.ms} ms | ${statusInfo}`;
	});

	const titleStyled =
		kind === 'status'
			? session.trialMode
				? 'Tokito API • Model Status (Trial / gpy)'
				: 'Tokito API • Model Status'
			: kind === 'details'
				? session.trialMode
					? '📋 Model Details (Trial / gpy)'
					: '📋 Model Details'
				: session.trialMode
					? 'Tokito API • Latency (Trial / gpy)'
					: 'Tokito API • Latency Benchmark';
	const updatedAt = runtime.lastLatencyAt;

	let online = 0,
		down = 0,
		timeout = 0,
		rateLimited = 0,
		untested = 0;

	const summaryEntries = session.trialMode
		? listModels(kind, 'gpy', session.modelVendor, session.sortMode, session)
		: runtime.modelEntries.filter((e) => {
				if (e.modelId === 'auto') return false;
				const lt = runtime.latency.get(entryKey(e));
				return Boolean(lt?.visible ?? lt?.ok);
			});

	if (session.trialMode) {
		online = summaryEntries.length;
	} else {
		for (const entry of summaryEntries) {
			const lt = runtime.latency.get(entryKey(entry));
			if (!lt) {
				untested += 1;
				continue;
			}
			if (lt.status === 0 || lt.status == null) timeout += 1;
			else if (lt.ok) online += 1;
			else if (lt.status === 429) rateLimited += 1;
			else down += 1;
		}
	}

	const summaryParts = [
		`Online: ${online}`,
		`Down: ${down}`,
		`Timeout: ${timeout}`,
	];
	if (rateLimited > 0) summaryParts.push(`Rate Limited: ${rateLimited}`);
	if (untested > 0) summaryParts.push(`Untested: ${untested}`);

	const embed = new EmbedBuilder()
		.setTitle(titleStyled)
		.setDescription(lines.join('\n') || 'No models available')
		.setColor(0x3498db)
		.addFields(
			{
				name: 'Summary',
				value: summaryParts.join(' | '),
				inline: false,
			},
			{ name: 'Page', value: `${page + 1}/${totalPages}`, inline: true },
			{
				name: 'Upstream',
				value: session.trialMode ? 'gpy (trial)' : session.upstreamProvider,
				inline: true,
			},
			{ name: 'Vendor', value: session.modelVendor, inline: true },
			{ name: 'Sort', value: session.sortMode, inline: true },
			{
				name: 'Last Update',
				value: updatedAt ? `${formatRelative(updatedAt)}` : 'never',
				inline: true,
			},
		);

	const components = buildTokitoRows(
		kind,
		session.id,
		page,
		totalPages,
		session.upstreamProvider,
		session.modelVendor,
		session.sortMode,
		session.trialMode,
	);
	return { embed, components };
}

// Cleanup expired tokito sessions and delete their ephemeral messages
// (Session expiration has been removed, memory is now managed by overwriting per-user in createTokitoSession)
// ==========================================

async function updateThreadData(threadId, updates) {
	if (!client.agverifData.threads[threadId]) {
		client.agverifData.threads[threadId] = {};
	}
	Object.assign(client.agverifData.threads[threadId], updates);
	await saveThreadsData();
}

async function removeThreadFromData(threadId) {
	if (client.agverifData.threads[threadId]) {
		if (client.agverifData.threads[threadId].deleteTimeout) {
			clearTimeout(client.agverifData.threads[threadId].deleteTimeout);
		}
		if (client.agverifData.threads[threadId].inactiveTimeout) {
			clearTimeout(client.agverifData.threads[threadId].inactiveTimeout);
		}
		if (client.agverifData.threads[threadId].photoDeleteTimeout) {
			clearTimeout(client.agverifData.threads[threadId].photoDeleteTimeout);
		}
		delete client.agverifData.threads[threadId];
		await saveThreadsData();
	}
}

async function addVerifiedUser(userId, threadId, roleId) {
	client.agverifData.verifiedUsers[userId] = {
		threadId,
		verifiedAt: Date.now(),
		roleId,
	};
	await saveVerifiedUsersData();
}

async function removeVerifiedUser(userId) {
	if (client.agverifData.verifiedUsers[userId]) {
		delete client.agverifData.verifiedUsers[userId];
		await saveVerifiedUsersData();
	}
}

function hasVerifiedRole(userId) {
	return client.agverifData.verifiedUsers[userId] !== undefined;
}

async function sendDMToUser(
	userId,
	title,
	description,
	color,
	components = null,
) {
	try {
		const user = await client.users.fetch(userId);
		if (!user) return;

		const embed = new EmbedBuilder()
			.setTitle(title)
			.setDescription(description)
			.setColor(color)
			.setTimestamp();

		const messageOptions = { embeds: [embed] };
		if (components) {
			messageOptions.components = components;
		}

		const sentMessage = await user.send(messageOptions);
		return sentMessage;
	} catch (err) {
		console.error(`Failed to send DM to user ${userId}:`, err);
		return null;
	}
}

function setupNoPhotoTimeout(threadId) {
	const timeout = setTimeout(async () => {
		try {
			const thread = await client.channels.fetch(threadId);
			if (!thread || !thread.isThread()) return;

			const threadData = client.agverifData.threads[threadId];
			if (!threadData || threadData.hasPhoto) return;

			const warningEmbed = new EmbedBuilder()
				.setTitle('⏰ Waktu Habis')
				.setDescription(
					'Thread ini akan dihapus karena tidak ada foto yang diupload dalam 1 jam.\n\n' +
						'Silakan buat tiket verifikasi baru jika ingin melanjutkan.',
				)
				.setColor(0xff6b6b)
				.setTimestamp();

			await thread.send({ embeds: [warningEmbed] });

			setTimeout(async () => {
				try {
					await sendDMToUser(
						threadData.userId,
						'⏰ Tiket Verifikasi Ditutup',
						`Tiket verifikasi antigravity Anda telah ditutup karena tidak ada foto yang diupload dalam 1 jam.\n\n` +
							`**Dibuat:** <t:${Math.floor(threadData.createdAt / 1000)}:F>`,
						0xff6b6b,
					);

					await thread.delete('Tidak ada foto diupload dalam 1 jam');
				} catch (err) {
					console.error('Failed to delete thread:', err);
				} finally {
					await removeThreadFromData(threadId);
				}
			}, 10000);
		} catch (err) {
			console.error('Failed to handle no photo timeout:', err);
		}
	}, NO_PHOTO_TIMEOUT_MS);

	return timeout;
}

function setupInactiveTimeout(threadId) {
	const timeout = setTimeout(async () => {
		try {
			const thread = await client.channels.fetch(threadId);
			if (!thread || !thread.isThread()) return;

			await thread.setArchived(true);
		} catch (err) {
			console.error('Failed to archive thread:', err);
		}
	}, INACTIVE_TIMEOUT_MS);

	return timeout;
}

async function checkPhotoExists(threadId, messageId) {
	try {
		const thread = await client.channels.fetch(threadId);
		if (!thread || !thread.isThread()) return false;

		const message = await thread.messages.fetch(messageId);
		if (!message) return false;

		if (message.attachments.size === 0) return false;

		const hasImage = message.attachments.some((attachment) => {
			return (
				attachment.contentType && attachment.contentType.startsWith('image/')
			);
		});

		return hasImage;
	} catch (err) {
		return false;
	}
}

async function handlePhotoDeletedBeforeRole(threadId) {
	try {
		const threadData = client.agverifData.threads[threadId];
		if (!threadData) return;

		const thread = await client.channels.fetch(threadId);
		if (!thread || !thread.isThread()) return;

		if (threadData.notificationMessageId) {
			try {
				const notifMsg = await thread.messages.fetch(
					threadData.notificationMessageId,
				);
				if (notifMsg) await notifMsg.delete();
			} catch (_) {}
		}

		const warningEmbed = new EmbedBuilder()
			.setTitle('⚠️ Foto Dihapus')
			.setDescription(
				`<@${threadData.userId}>, foto verifikasi Anda telah dihapus.\n\n` +
					'Silakan upload ulang foto verifikasi Anda dengan:\n' +
					'**"saya pengguna paket phantom, ingin verifikasi antigravity"**\n\n' +
					'Thread akan tetap aktif dan menunggu upload foto baru.',
			)
			.setColor(0xffa500)
			.setTimestamp();

		await thread.send({ embeds: [warningEmbed] });

		await updateThreadData(threadId, {
			hasPhoto: false,
			photoMessageId: null,
			notificationMessageId: null,
			warningMessageSent: true,
		});

		await sendDMToUser(
			threadData.userId,
			'⚠️ Foto Dihapus',
			'Foto verifikasi Anda telah dihapus.\n\n' +
				'Silakan upload ulang foto verifikasi di thread yang sama.',
			0xffa500,
		);
	} catch (err) {
		console.error('Failed to handle photo deletion before role:', err);
	}
}

async function handlePhotoDeletedAfterRole(threadId) {
	try {
		const threadData = client.agverifData.threads[threadId];
		if (!threadData) return;

		const thread = await client.channels.fetch(threadId);
		if (!thread || !thread.isThread()) return;

		if (threadData.hasRole) {
			try {
				const guild = thread.guild;
				const member = await guild.members.fetch(threadData.userId);
				if (member) {
					await member.roles.remove(VERIFIED_ROLE_ID);
				}
			} catch (err) {
				console.error('Failed to revoke role:', err);
			}

			await updateThreadData(threadId, { hasRole: false });
			await removeVerifiedUser(threadData.userId);
		}

		if (threadData.notificationMessageId) {
			try {
				const notifMsg = await thread.messages.fetch(
					threadData.notificationMessageId,
				);
				if (notifMsg) await notifMsg.delete();
			} catch (_) {}
		}
		if (threadData.successMessageId) {
			try {
				const successMsg = await thread.messages.fetch(
					threadData.successMessageId,
				);
				if (successMsg) await successMsg.delete();
			} catch (_) {}
		}

		let verifiedRoleName = 'Role verifikasi';
		try {
			const verifiedRole = await thread.guild.roles.fetch(VERIFIED_ROLE_ID);
			if (verifiedRole) {
				verifiedRoleName = `role **${verifiedRole.name}**`;
			}
		} catch (_) {}

		const warningEmbed = new EmbedBuilder()
			.setTitle('⚠️ Peringatan - Foto Dihapus')
			.setDescription(
				`<@${threadData.userId}>, Anda telah menghapus foto verifikasi.\n\n` +
					`**${verifiedRoleName} telah dicabut.**\n\n` +
					'Silakan upload ulang foto di thread ini. Owner Groupy akan verifikasi ulang.\n\n' +
					'Thread ini akan dihapus dalam **3 hari** jika tidak ada foto baru.',
			)
			.setColor(0xff6b6b)
			.setTimestamp();

		const warningMsg = await thread.send({ embeds: [warningEmbed] });

		const threadUrl = `https://discord.com/channels/${thread.guild.id}/${threadId}`;
		const linkButton = new ButtonBuilder()
			.setLabel('Buka Thread')
			.setStyle(ButtonStyle.Link)
			.setURL(threadUrl);
		const row = new ActionRowBuilder().addComponents(linkButton);

		const dmMessage = await sendDMToUser(
			threadData.userId,
			'⚠️ Role Verifikasi Dicabut',
			`Foto verifikasi Anda telah dihapus dan ${verifiedRoleName} telah dicabut.\n\n` +
				'Silakan upload ulang foto di thread ini. Owner Groupy akan verifikasi ulang.\n\n' +
				'Thread akan dihapus dalam **3 hari** jika tidak ada foto baru.',
			0xff6b6b,
			[row],
		);

		await updateThreadData(threadId, {
			hasPhoto: false,
			photoMessageId: null,
			notificationMessageId: null,
			successMessageId: null,
			photoDeletedAfterRole: true,
			verifiedBy: null,
			verifiedAt: null,
			warningMessageId: warningMsg.id,
			warningDMMessageId: dmMessage?.id || null,
		});

		if (threadData.inactiveTimeout) {
			clearTimeout(threadData.inactiveTimeout);
		}

		const deleteTimeout = setTimeout(async () => {
			try {
				const threadToDelete = await client.channels.fetch(threadId);
				if (
					threadToDelete &&
					threadToDelete.isThread() &&
					!client.agverifData.threads[threadId]?.hasPhoto
				) {
					await threadToDelete.delete('Foto tidak diupload ulang dalam 3 hari');
					await removeThreadFromData(threadId);
				}
			} catch (err) {
				console.error('Failed to delete thread after 3 days:', err);
			}
		}, PHOTO_DELETE_GRACE_MS);

		client.agverifData.threads[threadId].photoDeleteTimeout = deleteTimeout;
	} catch (err) {
		console.error('Failed to handle photo deletion after role:', err);
	}
}

async function startPhotoCheckInterval() {
	setInterval(
		async () => {
			try {
				for (const [threadId, threadData] of Object.entries(
					client.agverifData.threads,
				)) {
					if (!threadData.hasPhoto || !threadData.photoMessageId) continue;

					const now = Date.now();
					if (
						threadData.lastPhotoCheck &&
						now - threadData.lastPhotoCheck < 6 * 60 * 60 * 1000
					) {
						continue;
					}

					const photoExists = await checkPhotoExists(
						threadId,
						threadData.photoMessageId,
					);

					if (!photoExists) {
						if (threadData.hasRole) {
							await handlePhotoDeletedAfterRole(threadId);
						} else {
							await handlePhotoDeletedBeforeRole(threadId);
						}
					} else {
						await updateThreadData(threadId, { lastPhotoCheck: now });
					}
				}
			} catch (err) {
				console.error('Error in photo check interval:', err);
			}
		},
		6 * 60 * 60 * 1000,
	);
}

const ROLE_SYNC_JEDA_SETELAH_SELESAI_MS = 60 * 1000; // 60 detik jeda setelah semua user dicek, baru cycle berikutnya

/** Satu cycle: cek semua verifiedUsers berturut-turut (tanpa jeda), bersihkan yang sudah tidak punya role. Setelah selesai, jeda 60 detik lalu cycle lagi. */
async function fetchAllActiveNonTrialKeys() {
	const data = await proxyInternal('/admin/internal/keys');
	if (!Array.isArray(data)) return [];
	return data.filter((k) => k.isActive && !k.isTrial);
}

// ─── How-to-Use tutorial content ──────────────────────────────────────────────
function getTutorialContext(ide, kind, ctx) {
	const endpoint = ctx.endpoint || '<PROXY_BASE>/v1';
	const apiKey = ctx.apiKey || '<API_KEY>';
	const models = ctx.models && ctx.models.length ? ctx.models : [];
	const modelList = models.length
		? models
				.slice(0, 4)
				.map((m) => '`' + m + '`')
				.join(', ')
		: '`gpy/webnet/glm-5`';
	const firstModel = models[0] || 'gpy/webnet/glm-5';
	const kindLabel = kind === 'trial' ? 'Trial' : 'Phantom';

	switch (ide) {
		case 'cline': {
			return [
				'# Cline (VS Code)',
				'',
				'Cline support OpenAI-compatible secara native — tidak perlu proxy atau config file tambahan.',
				'',
				'1. Install extension **Cline** dari VS Code marketplace.',
				'2. Buka Settings → cari "Cline" → **API Provider**: pilih `OpenAI Compatible`.',
				'3. Isi field berikut:',
				`   - **Base URL**: \`${endpoint}\``,
				`   - **API Key**: \`${apiKey}\``,
				`   - **Model ID**: \`${firstModel}\``,
				'4. Save. Coba prompt di sidebar Cline untuk test koneksi.',
				'',
				`**Model yang bisa dicoba (${kindLabel}):**`,
				modelList,
				'',
				'> Tips: ganti **Model ID** di settings Cline kapan saja untuk switch model. Model dengan `supportsToolCalling: true` paling cocok untuk agentic workflow.',
			].join('\n');
		}

		case 'codex_ide': {
			return [
				'# Codex (web / VS Code extension)',
				'',
				'VS Code extension Codex **TIDAK** membaca setting `chatgpt.apiBase` lagi — setting itu sudah dihapus upstream. Cara set custom base URL:',
				'',
				'1. Edit file `~/.codex/config.toml` (user-level). Project-local `.codex/config.toml` diabaikan untuk setting provider.',
				'2. Tambahkan block berikut:',
				'   ```toml',
				'   model_provider = "groupy"',
				`   model = "${firstModel}"`,
				'',
				'   [model_providers.groupy]',
				`   name = "Groupy ${kindLabel}"`,
				`   base_url = "${endpoint}"`,
				`   env_key = "OPENAI_API_KEY"`,
				'   wire_api = "responses"',
				'   ```',
				'3. Set env var di shell yang menjalankan VS Code, lalu restart VS Code:',
				'   ```bash',
				`   export OPENAI_API_KEY="${apiKey}"`,
				'   ```',
				'4. Extension Codex akan membaca provider baru dari config.toml.',
				'',
				`**Model yang bisa dicoba (${kindLabel}):**`,
				modelList,
				'',
				'> `wire_api = "responses"` adalah default dan satu-satunya nilai valid di Codex 2026 untuk custom provider. Proxy harus expose `/v1/responses`. Kalau proxy cuma expose `/v1/chat/completions` (umum OpenAI-compatible), pakai IDE lain (Cline, OpenCode) atau jalankan LiteLLM/ccrouter sebagai adapter.',
			].join('\n');
		}

		case 'codex_cli': {
			return [
				'# Codex CLI (terminal)',
				'',
				'Codex CLI baca `~/.codex/config.toml`. Env var `OPENAI_BASE_URL` sudah deprecated (cuma print warning). Cara yang benar:',
				'',
				'1. Install Codex CLI:',
				'   ```bash',
				'   npm i -g @openai/codex',
				'   # atau via installer resmi dari openai.com',
				'   ```',
				'2. Lokasi config persis:',
				'   - **macOS / Linux:** `~/.codex/config.toml`',
				'   - **Windows:** `%USERPROFILE%\\.codex\\config.toml`',
				'   - **Custom:** set env `CODEX_HOME=/path/to/.codex` (folder harus sudah ada).',
				'3. Tambahkan ke `config.toml` (jangan replace existing — gabung):',
				'   ```toml',
				'# Top-level: provider aktif + model default',
				'   model_provider = "groupy"',
				`   model = "${firstModel}"`,
				'',
				'   # Block provider custom',
				'   [model_providers.groupy]',
				`   name = "Groupy ${kindLabel}"`,
				`   base_url = "${endpoint}"`,
				`   env_key = "GROUPY_API_KEY"`,
				'   wire_api = "responses"',
				'   ```',
				'   Field penting:',
				'   - `model_provider` (top-level) = key dari `[model_providers.<id>]` block.',
				'   - `model` (top-level) = model id persis sesuai API proxy.',
				'   - `env_key` = nama env var yang berisi API key (dikirim sebagai Bearer).',
				'   - `wire_api = "responses"` = default & satu-satunya valid di 2026.',
				'4. Set env var di shell:',
				'   ```bash',
				`   export GROUPY_API_KEY="${apiKey}"`,
				'   # tambahkan ke ~/.zshrc / ~/.bashrc supaya persist',
				'   ```',
				'5. Test:',
				'   ```bash',
				'   codex --provider groupy "halo, apa kabar"',
				'   # Ganti model per-invocation',
				`   codex --provider groupy --model <model-id> "..."`,
				'   # Non-interactive (CI / script)',
				`   CODEX_API_KEY="${apiKey}" codex exec "refactor fungsi ini"`,
				'   ```',
				'',
				`**Model yang bisa dicoba (${kindLabel}):**`,
				modelList,
				'',
				'> Tips lanjutan:',
				'> - `approval_policy = "never"` + `sandbox_mode = "danger-full-access"` di config.toml untuk auto-run tanpa prompt (trusted env only).',
				'> - Pakai `[profiles.<name>]` block untuk simpan preset provider berbeda.',
				'> - `wire_api = "responses"` di 2026 strict. Kalau proxy cuma `/v1/chat/completions`, pakai adapter (LiteLLM di localhost) atau IDE lain.',
			].join('\n');
		}

		case 'claude_cli': {
			return [
				'# Claude Code CLI',
				'',
				'Claude Code support custom backend via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. Anthropic dokumentasikan resmi di [code.claude.com/docs/en/quickstart](https://code.claude.com/docs/en/quickstart).',
				'',
				'**PENTING:** Claude Code strict ke format **Anthropic Messages** (`POST /v1/messages`). Proxy Groupy expose **OpenAI Chat Completions** (`/v1/chat/completions`). Jadi `ANTHROPIC_BASE_URL` **TIDAK bisa point langsung** ke proxy — perlu translation layer di tengah.',
				'',
				'**Solusi: pakai translation proxy lokal** (CCProxy, ccrouter, atau LiteLLM) yang listen di `localhost` lalu translate Anthropic Messages ↔ OpenAI Chat Completions.',
				'',
				'### Step-by-step (CCProxy — recommended)',
				'',
				'1. **Install Claude Code** (ikuti quickstart):',
				'   ```bash',
				'   # macOS / Linux',
				'   curl -fsSL https://claude.ai/install.sh | sh',
				'   # atau via npm',
				'   npm i -g @anthropic-ai/claude-code',
				'   # Windows (PowerShell sebagai Admin)',
				'   irm https://claude.ai/install.ps1 | iex',
				'   ```',
				'',
				'2. **Install & jalankan CCProxy** di `localhost:3456` (translation proxy background process):',
				'   ```bash',
				'   export PROVIDER=openai',
				`   export OPENAI_API_KEY="${apiKey}"`,
				`   export OPENAI_BASE_URL="${endpoint}"`,
				`   export OPENAI_MODEL="${firstModel}"`,
				'   ccproxy &',
				'   ```',
				'',
				'3. **Buat `~/.claude/settings.json`** (PowerShell: `notepad $HOME\\.claude\\settings.json`):',
				'   ```json',
				'   {',
				'     "env": {',
				'       "ANTHROPIC_BASE_URL": "http://localhost:3456",',
				'       "ANTHROPIC_AUTH_TOKEN": "any-non-empty-string",',
				`       "ANTHROPIC_DEFAULT_SONNET_MODEL": "${firstModel}",`,
				`       "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${firstModel}",`,
				`       "ANTHROPIC_DEFAULT_OPUS_MODEL": "${firstModel}",`,
				'       "API_TIMEOUT_MS": "500000"',
				'     },',
				`     "model": "${firstModel}",`,
				'     "enabledPlugins": {},',
				'     "hasCompletedOnboarding": true',
				'   }',
				'   ```',
				'   Field penting:',
				'   - `ANTHROPIC_BASE_URL` = URL translation proxy lokal. CCProxy default: `http://localhost:3456`. Boleh include atau tanpa `/v1` (Claude Code flexible).',
				'   - `ANTHROPIC_AUTH_TOKEN` boleh string apa aja — CCProxy pakai `OPENAI_API_KEY` yang asli untuk upstream.',
				'   - `ANTHROPIC_DEFAULT_*_MODEL` = mapping model Anthropic ke model proxy. Pakai model yang sama untuk semua (Sonnet=Haiku=Opus=model-proxy) supaya konsisten.',
				'   - `API_TIMEOUT_MS = 500000` (≈8 menit) — penting biar Claude Code cepat detect error API key / network, tidak hang selamanya.',
				'   - `hasCompletedOnboarding: true` skip onboarding prompt pertama.',
				'',
				'4. **Test:** jalankan `claude` di terminal, ketik `hi`. Harus muncul jawaban dari model proxy.',
				'',
				'5. **Verifikasi `/model` picker:** ketik `/model` di dalam Claude Code. List harus menunjukkan **"Custom Sonnet model"**, **"Custom Haiku model"**, **"Custom Opus model"** dengan prefix `ag/`, `cx/`, `tokito/`, dll. — ini tanda config terbaca dengan benar. Tanda `✓` di sebelah model = default aktif.',
				'',
				'### Plugins hemat token (opsional, recommended)',
				'',
				'Tambahkan ke `enabledPlugins` di `settings.json` setelah install via marketplace resmi:',
				'   ```json',
				'   "enabledPlugins": {',
				'     "caveman@claude-plugins-official": true,',
				'     "superpowers@claude-plugins-official": true,',
				'     "everythingclaudecode@claude-plugins-official": true',
				'   }',
				'   ```',
				'   - `caveman` — gaya respons lebih ringkas, hemat token.',
				'   - `superpowers` — unlock skills bawaan Claude Code yang lebih powerful.',
				'   - `everythingclaudecode` — extra commands & utilities.',
				'',
				'### Populate model picker otomatis (opsional)',
				'',
				'Tambahkan env ini supaya Claude Code auto-populate picker dari gateway `/v1/models`:',
				'   ```json',
				'   "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1"',
				'   ```',
				'Cuma model dengan ID `claude-*` atau `anthropic-*` yang ditambahkan. CCProxy expose endpoint ini out of the box.',
				'',
				'### Alternatif one-shot: ccrouter',
				'',
				'Untuk test cepat tanpa install CCProxy sebagai service:',
				'   ```bash',
				`   ANTHROPIC_BASE_URL="${endpoint}" \\`,
				`   ANTHROPIC_AUTH_TOKEN="anything" \\`,
				'     ccrouter run --openai -- claude "hello"',
				'   ```',
				'ccrouter auto-spawn translation proxy di port random, jalankan `claude`, shutdown saat exit.',
				'',
				`**Model yang bisa dicoba (${kindLabel}):**`,
				modelList,
				'',
				'> **Troubleshooting:** kalau `/model` picker tidak menunjukkan "Custom" model, cek: (1) CCProxy running di port 3456, (2) `ANTHROPIC_BASE_URL` benar di `settings.json`, (3) restart `claude`. `API_TIMEOUT_MS` rendah supaya error cepat kelihatan, bukan hang.',
			].join('\n');
		}

		case 'opencode': {
			return [
				'# OpenCode',
				'',
				'OpenCode support custom OpenAI-compatible provider via `opencode.json`. Lokasi file:',
				'',
				'- **User-level (global):** `~/.config/opencode/opencode.json` (recommended — dipakai semua project)',
				'- **Project-level:** `opencode.json` di root project (override per project, lebih di-utama)',
				'- Bisa juga set `OPENCODE_CONFIG` env var ke path custom.',
				'',
				'1. Install OpenCode:',
				'   ```bash',
				'   npm i -g opencode-ai',
				'   # atau via Homebrew / package manager lain',
				'   ```',
				'2. Buat/edit file config. Pilih salah satu lokasi di atas. Tambahkan:',
				'   ```json',
				'   {',
				'     "$schema": "https://opencode.ai/config.json",',
				'     "provider": {',
				'       "groupy": {',
				'         "npm": "@ai-sdk/openai-compatible",',
				`         "name": "Groupy ${kindLabel}",`,
				'         "options": {',
				`           "baseURL": "${endpoint}",`,
				'           "apiKey": "GROUPY_API_KEY"',
				'         },',
				'         "models": {',
				...models
					.slice(0, 6)
					.map((m) => `           "${m}": { "name": "${m}" },`),
				'         }',
				'       }',
				'     },',
				`     "model": "groupy/${firstModel}"`,
				'   }',
				'   ```',
				'   Field penting:',
				'   - `npm: "@ai-sdk/openai-compatible"` untuk endpoint `/v1/chat/completions` (umum OpenAI-compatible).',
				'   - `npm: "@ai-sdk/openai"` untuk endpoint `/v1/responses` (kalau proxy expose Responses API).',
				'   - `apiKey` di sini **nama env var** (string), bukan value. OpenCode baca env var saat runtime.',
				'   - `baseURL` harus include `/v1` di suffix.',
				'3. Set env var di shell:',
				'   ```bash',
				`   export GROUPY_API_KEY="${apiKey}"`,
				'   # tambahkan ke ~/.zshrc / ~/.bashrc supaya persist',
				'   ```',
				'4. Login (sekali saja):',
				'   ```bash',
				'   opencode auth login',
				'   # scroll ke "Other" → paste key (OpenCode baca dari $GROUPY_API_KEY)',
				'   ```',
				'5. Jalankan `opencode` di terminal. Model picker akan muncul dengan daftar model di config.',
				'',
				`**Model yang bisa dicoba (${kindLabel}):**`,
				modelList,
				'',
				'> Tips: project-level `opencode.json` (di root project) lebih diprioritaskan dari global. Kalau konfig tidak ngefek, cek apakah ada file `opencode.json` di project root yang override. Untuk endpoint `/v1/responses`, ganti `npm: "@ai-sdk/openai"`.',
			].join('\n');
		}

		case 'oai_provider': {
			return [
				'# VS Code — OpenAI Compat Provider (calgan.oai-provider)',
				'',
				'Extension VS Code untuk pakai OpenAI-compatible endpoint langsung di panel chat. Marketplace: https://marketplace.visualstudio.com/items?itemName=calgan.oai-provider',
				'',
				'1. Install extension di VS Code.',
				'2. Buka `settings.json` (Ctrl+Shift+P → "Preferences: Open User Settings (JSON)").',
				'3. Tambahkan konfigurasi berikut (jangan replace config kamu, gabung dengan existing):',
				'   ```json',
				'   "openai-compat-provider.providers": [',
				'     {',
				'       "id": "groupy",',
				`       "displayName": "Groupy ${kindLabel}",`,
				`       "baseUrl": "${endpoint}",`,
				`       "apiKey": "${apiKey}",`,
				'       "models": [',
				...models
					.slice(0, 5)
					.map(
						(m) =>
							`         { "id": "${m}", "name": "${m}", "maxInputTokens": 200000, "maxOutputTokens": 64000, "supportsToolCalling": true },`,
					),
				'       ]',
				'     }',
				'   ]',
				'   ```',
				'4. Save. Model akan muncul di panel chat extension.',
				'',
				'> Tips: `apiKey` di JSON polos (bukan `{env:VAR}`). Untuk keamanan, simpan key di VS Code SecretStorage atau pakai extension secret manager lain. Untuk model gpy full list, cek endpoint `/v1/models`.',
			].join('\n');
		}
	}
	return '_(Tutorial untuk IDE ini belum tersedia)_';
}

function paginateText(text, max) {
	if (text.length <= max) return [text];
	const out = [];
	let i = 0;
	while (i < text.length) {
		let end = Math.min(i + max, text.length);
		if (end < text.length) {
			const lastNl = text.lastIndexOf('\n', end);
			if (lastNl > i + max / 2) end = lastNl;
		}
		out.push(text.slice(i, end));
		i = end;
	}
	return out;
}

function buildTutorialEmbeds(ide, kind, ctx) {
	const fullText = getTutorialContext(ide, kind, ctx);
	const pages = paginateText(fullText, TUTORIAL_PAGE_SIZE);
	const labelMap = Object.fromEntries(
		TUTORIAL_IDES.map((i) => [i.id, i.label]),
	);
	const ideLabel = labelMap[ide] || ide;
	return pages.map((chunk, i) => ({
		embed: new EmbedBuilder()
			.setTitle(
				`📘 How to Use — ${ideLabel}${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ''}`,
			)
			.setDescription(chunk)
			.setColor(0x5865f2)
			.setTimestamp(),
	}));
}

function buildHowToPicker(userId, kindLabel) {
	const menu = new StringSelectMenuBuilder()
		.setCustomId(`${TUTORIAL_MENU_IDE_PREFIX}${userId}`)
		.setPlaceholder(`Pilih IDE untuk tutorial ${kindLabel}...`)
		.addOptions(
			TUTORIAL_IDES.map((i) => ({
				label: i.label,
				value: i.id,
			})),
		);
	return [new ActionRowBuilder().addComponents(menu)];
}

async function lookupKindForUser(userId) {
	try {
		const k = await proxyInternal(`/admin/internal/user-key-type/${userId}`);
		if (k?.isTrial) return 'trial';
	} catch {}
	return 'phantom';
}

async function getTutorialContextForUser(userId, kind) {
	const endpoint = process.env.PROXY_PUBLIC_BASE_URL
		? `${process.env.PROXY_PUBLIC_BASE_URL}/v1`
		: 'https://api.tokito.xyz/v1';
	try {
		if (kind === 'trial') {
			const data = await proxyInternal('/admin/internal/trial-models');
			return { endpoint, apiKey: 'sk-trial', models: data?.gpyModels || [] };
		}
		const data = await proxyInternal('/admin/internal/models/details');
		return {
			endpoint,
			apiKey: 'sk-phantom',
			models: (data?.data || [])
				.map((m) => m.id)
				.filter((id) => id && id !== 'auto'),
		};
	} catch (err) {
		console.error('[tutorial] getTutorialContextForUser failed:', err.message);
		return { endpoint, apiKey: '', models: [] };
	}
}

async function sendHowToDm(userId, kind, ctx) {
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`${TUTORIAL_BTN_HOWTO_PREFIX}:${userId}:${kind}`)
			.setLabel('How to Use')
			.setEmoji('📘')
			.setStyle(ButtonStyle.Primary),
	);
	await sendDMToUser(
		userId,
		'📘 How to Use — Tutorial Setup',
		`Klik tombol di bawah untuk lihat cara setup **${kind === 'trial' ? 'Trial' : 'Phantom'} API key** di IDE pilihan kamu. Tersedia tutorial untuk: Cline, Codex, Codex CLI, Claude Code CLI, OpenCode, dan extension VS Code oai_provider.`,
		0x5865f2,
		[row],
	);
}

async function runDailyInactiveMemberCleanup() {
	console.log('[daily-cleanup] starting inactive-member sweep');
	const channel = await client.channels
		.fetch(AGVERIF_CHANNEL_ID)
		.catch(() => null);
	if (!channel?.guild) {
		console.warn('[daily-cleanup] agverif channel not found, skipping');
		return;
	}
	const guild = channel.guild;

	const keys = await fetchAllActiveNonTrialKeys();
	const candidates = keys.filter(
		(k) => k.discordUserId && k.provisionedBy === 'discord-bot', // excludes 'admin-override' keys (imun dari auto-revoke)
	);
	console.log(
		`[daily-cleanup] scanning ${candidates.length} agverif-provisioned keys`,
	);

	const cleaned = [];
	for (const key of candidates) {
		const userId = key.discordUserId;
		let member = null;
		try {
			member = await guild.members.fetch({ user: userId, force: true });
		} catch (_) {
			/* user left guild */
		}

		const isVerified = member?.roles.cache.has(VERIFIED_ROLE_ID);
		const isPhantom = member?.roles.cache.has(REQUIRED_ROLE_ID);

		if (!member || !isPhantom) {
			const verifiedData = client.agverifData.verifiedUsers[userId];
			if (verifiedData?.threadId) {
				const thread = await client.channels
					.fetch(verifiedData.threadId)
					.catch(() => null);
				if (thread?.isThread()) {
					await thread
						.delete('Phantom role hilang — daily cleanup')
						.catch((err) => {
							if (err.code !== 10003)
								console.error('[daily-cleanup] thread delete failed:', err);
						});
				}
				await removeThreadFromData(verifiedData.threadId).catch(() => {});
			}
			await removeVerifiedUser(userId).catch(() => {});

			if (member && isVerified) {
				await member.roles
					.remove(VERIFIED_ROLE_ID, 'Phantom role hilang — daily cleanup')
					.catch((err) => {
						console.error('[daily-cleanup] role remove failed:', err);
					});
			}

			try {
				await revokeApiKeyForUser(
					userId,
					'Phantom role hilang — daily cleanup',
				);
			} catch (err) {
				console.error('[daily-cleanup] revoke failed:', err);
			}

			await sendDMToUser(
				userId,
				'API Key Dinonaktifkan',
				'API key Phantom Anda telah dinonaktifkan karena role Phantom sudah tidak ada di akun Anda.\n\n' +
					'Thread verifikasi Anda juga telah dihapus. Jika ini kesalahan, hubungi admin.',
				0xff6b6b,
			).catch((err) => console.error('[daily-cleanup] DM failed:', err));

			cleaned.push({
				userId,
				keyId: key.id,
				username: key.discordUsername || userId,
			});
		}
	}

	console.log(
		`[daily-cleanup] done. cleaned ${cleaned.length} members: ${cleaned.map((c) => c.username).join(', ') || '(none)'}`,
	);
}

function scheduleDailyInactiveMemberCleanup() {
	function msUntilMidnightWib() {
		const now = new Date();
		const wib = 7 * 60 * 60000;
		const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
		const wibDate = new Date(utcMs + wib);
		wibDate.setHours(24, 0, 0, 0);
		return wibDate.getTime() - wib - now.getTime();
	}
	function scheduleNext() {
		setTimeout(async () => {
			try {
				await runDailyInactiveMemberCleanup();
			} catch (err) {
				console.error('[daily-cleanup] error:', err);
			}
			scheduleNext();
		}, msUntilMidnightWib());
	}
	scheduleNext();
}

async function runRoleSyncCheck() {
	try {
		const channel = await client.channels
			.fetch(AGVERIF_CHANNEL_ID)
			.catch(() => null);
		if (!channel?.guild) {
			scheduleNextRoleSync();
			return;
		}
		const guild = channel.guild;

		const userIds = Object.keys(client.agverifData.verifiedUsers);
		if (userIds.length === 0) {
			scheduleNextRoleSync();
			return;
		}

		const cleaned = [];
		let idx = 0;
		for (const userId of userIds) {
			const verifiedData = client.agverifData.verifiedUsers[userId];
			if (!verifiedData) continue;
			idx++;
			const threadId = verifiedData.threadId;

			let member = null;
			let hasRole = false;
			try {
				member = await guild.members.fetch({ user: userId, force: true });
				if (member) hasRole = member.roles.cache.has(VERIFIED_ROLE_ID);
			} catch (e) {
				// User tidak di guild atau fetch gagal
			}

			if (!member || !hasRole) {
				cleaned.push(userId);
				await removeVerifiedUser(userId);
				try {
					const thread = await client.channels.fetch(threadId);
					if (thread?.isThread()) {
						await thread
							.delete('Role verifikasi antigravity hilang saat sinkronisasi')
							.catch((err) => {
								if (err.code !== 10003)
									console.error(
										'Failed to delete thread during role sync:',
										err,
									);
							});
					}
				} catch (_) {}
				await removeThreadFromData(threadId);
			}
		}

		scheduleNextRoleSync();
	} catch (err) {
		console.error('[Role sync] Error:', err);
		scheduleNextRoleSync();
	}
}

function scheduleNextRoleSync() {
	setTimeout(
		() =>
			runRoleSyncCheck().catch((e) => console.error('[Role sync] Error:', e)),
		ROLE_SYNC_JEDA_SETELAH_SELESAI_MS,
	);
}

function startRoleSyncInterval() {
	runRoleSyncCheck().catch((err) => console.error('[Role sync] Error:', err));
}

async function setupVerificationButton() {
	try {
		const channel = await client.channels.fetch(AGVERIF_CHANNEL_ID);
		if (!channel) {
			console.error('Verification channel not found');
			return;
		}

		let button;
		let embed;

		if (AGVERIF_ENABLED) {
			// Original photo verification flow
			button = new ButtonBuilder()
				.setCustomId('create_agverif_ticket')
				.setLabel('🔐 Verifikasi Antigravity')
				.setStyle(ButtonStyle.Primary);

			embed = new EmbedBuilder()
				.setTitle('🔐 Verifikasi Antigravity')
				.setDescription(
					'Klik tombol di bawah untuk membuat tiket verifikasi antigravity.\n\n' +
						'**Syarat:**\n' +
						'• Memiliki role **The Phantom**\n' +
						'• Belum terverifikasi antigravity\n\n' +
						'**Proses Verifikasi:**\n' +
						'1. Klik tombol untuk membuat tiket\n' +
						'2. Upload foto selfie dengan kertas bertulisan:\n' +
						'   *"saya pengguna paket phantom, ingin verifikasi antigravity"*\n' +
						'3. Tunggu Owner Groupy memverifikasi\n' +
						'4. Dapatkan role verifikasi setelah disetujui\n\n' +
						'⚠️ **Peringatan:**\n' +
						'• Jangan hapus foto setelah upload\n' +
						'• Role akan dicabut jika foto dihapus',
				)
				.setColor(0x5865f2)
				.setTimestamp();
		} else {
			// Auto-claim flow (no photo verification)
			button = new ButtonBuilder()
				.setCustomId('create_agverif_ticket')
				.setLabel('🎁 Claim API Key')
				.setStyle(ButtonStyle.Primary);

			embed = new EmbedBuilder()
				.setTitle('🎁 Claim API Key')
				.setDescription(
					'Klik tombol di bawah untuk claim API key Antigravity.\n\n' +
						'**Syarat:**\n' +
						'• Memiliki role **The Phantom**\n\n' +
						'**Cara Claim:**\n' +
						'1. Klik tombol Claim API Key\n' +
						'2. API key akan dikirim via DM\n\n' +
						'⚠️ **Penting:**\n' +
						'• Jika role Phantom dicabut, API key akan dinonaktifkan\n' +
						'• Claim ulang setelah perpanjang paket Phantom',
				)
				.setColor(0x57f287)
				.setTimestamp();
		}

		const row = new ActionRowBuilder().addComponents(button);

		if (client.agverifData.setupState.messageId) {
			try {
				const existingMessage = await channel.messages.fetch(
					client.agverifData.setupState.messageId,
				);
				if (existingMessage) {
					await existingMessage.edit({
						embeds: [embed],
						components: [row],
					});
					console.log('Updated existing verification button message');
					return;
				}
			} catch (err) {
				console.log('Existing message not found, creating new one');
			}
		}

		const message = await channel.send({ embeds: [embed], components: [row] });
		client.agverifData.setupState.messageId = message.id;
		client.agverifData.setupState.channelId = channel.id;
		await saveSetupState();
		console.log('Created new verification button message');
	} catch (err) {
		console.error('Failed to setup verification button:', err);
	}
}

function formatTokens(n) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

/** Full input = prompt + cache. label = readable, compact = short. */
function formatInputBreakdown(billable, cached, fullInput) {
	const cache = Math.max(0, Number(cached) || 0);
	const totalNum =
		fullInput != null && Number.isFinite(Number(fullInput))
			? Math.max(0, Number(fullInput))
			: Math.max(0, Number(billable) || 0) + cache;
	const bill =
		billable != null && Number.isFinite(Number(billable))
			? Math.max(0, Number(billable))
			: Math.max(0, totalNum - cache);
	const total = formatTokens(totalNum);
	if (cache > 0) {
		return {
			total,
			// Cards / embeds: "100K (10K prompt + 90K cache)"
			label: `${total} (${formatTokens(bill)} prompt + ${formatTokens(cache)} cache)`,
			// Leaderboard / dense: "100K (10K p + 90K c)" — spaces so p/c don't glue to numbers
			compact: `${total} (${formatTokens(bill)} p + ${formatTokens(cache)} c)`,
		};
	}
	return { total, label: total, compact: total };
}

function formatCostMicro(microdollars) {
	const dollars = microdollars / 1_000_000;
	if (dollars >= 1) return `$${dollars.toFixed(4)}`;
	if (dollars >= 0.0001) return `$${dollars.toFixed(6)}`;
	return `$0`;
}

// ─── Ranking State ──────────────────────────────────────────────────────────────
let rankingState = {
	channelId: null,
	messages: {
		modelByRequests: null,
		modelByTokens: null,
		userByRequests: null,
		userByTokens: null,
		searchUser: null,
	},
};

async function loadRankingState() {
	try {
		const content = await fs.readFile(RANKING_STATE_PATH, 'utf8');
		const data = JSON.parse(content);
		if (data && typeof data === 'object') {
			rankingState = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT')
			console.error('[ranking] Failed to load ranking state:', err);
		rankingState = {
			channelId: null,
			messages: {
				modelByRequests: null,
				modelByTokens: null,
				userByRequests: null,
				userByTokens: null,
				searchUser: null,
			},
		};
	}
}

async function saveRankingState() {
	try {
		await fs.mkdir(AGVERIF_DATA_DIR, { recursive: true });
		await fs.writeFile(
			RANKING_STATE_PATH,
			JSON.stringify(rankingState, null, 2),
			'utf8',
		);
	} catch (err) {
		console.error('[ranking] Failed to save ranking state:', err);
	}
}

async function loadRecapState() {
	try {
		const content = await fs.readFile(RECAP_STATE_PATH, 'utf8');
		const data = JSON.parse(content);
		if (data && typeof data === 'object')
			recapState = { ...recapState, ...data };
	} catch (err) {
		if (err.code !== 'ENOENT')
			console.error('[recap] Failed to load recap state:', err);
	}
}

async function saveRecapState() {
	try {
		await fs.mkdir(AGVERIF_DATA_DIR, { recursive: true });
		await fs.writeFile(
			RECAP_STATE_PATH,
			JSON.stringify(recapState, null, 2),
			'utf8',
		);
	} catch (err) {
		console.error('[recap] Failed to save recap state:', err);
	}
}

// ─── Build Ranking Embeds ──────────────────────────────────────────────────────
function buildRankingEmbed(title, color, todayItems, monthItems, formatItem) {
	const todayLines = todayItems.length
		? todayItems
				.map((item, i) => `**${i + 1}.** ${formatItem(item)}`)
				.join('\n')
		: '_Belum ada data_';
	const monthLines = monthItems.length
		? monthItems
				.map((item, i) => `**${i + 1}.** ${formatItem(item)}`)
				.join('\n')
		: '_Belum ada data_';

	return new EmbedBuilder()
		.setTitle(title)
		.setColor(color)
		.addFields(
			{ name: '📅 Hari Ini', value: todayLines.slice(0, 1000), inline: true },
			{ name: '📆 Bulan Ini', value: monthLines.slice(0, 1000), inline: true },
		)
		.setFooter({
			text: `🔄 Auto-refresh setiap 1 menit  •  ${new Date().toLocaleString('id-ID', {
				timeZone: 'Asia/Jakarta',
				dateStyle: 'medium',
				timeStyle: 'medium',
			})} WIB`,
		});
}

async function buildSearchEmbed() {
	let limits = {};
	try {
		limits = await proxyInternal('/admin/settings/global');
	} catch (err) {
		console.error('[ranking] Failed to fetch limits:', err.message);
	}

	const fmt = (v, unit) =>
		v > 0 ? `${v.toLocaleString()} ${unit}` : 'Unlimited';
	const fmtTok = (v) => {
		if (!v || v <= 0) return 'Unlimited';
		if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
		if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
		return String(v);
	};

	const perModelWindow = limits.globalPerModelPromptLimitWindow || '1d';
	let perModelLine;
	if (limits.globalPerModelPromptLimit > 0) {
		perModelLine = `- Per-Model Default: ${limits.globalPerModelPromptLimit} prompts (${perModelWindow})`;
	} else {
		let overrideNote =
			'Unlimited (lihat **See Model Limit** untuk override)';
		try {
			const ml = await proxyInternal('/admin/settings/model-limits');
			const rows = (ml && ml.data) || [];
			const pats = rows.filter(
				(r) => r.isPattern && Number(r.promptLimit) > 0,
			);
			if (pats.length) {
				const bits = pats
					.slice(0, 6)
					.map((r) => `\`${r.model}\``)
					.join(' / ');
				const lim = pats[0].promptLimit;
				overrideNote = `Unlimited (global) · overrides: ${bits} = ${lim} prompts / ${perModelWindow} — lihat **See Model Limit**`;
			}
		} catch {
			/* keep fallback */
		}
		perModelLine = `- Per-Model Default: ${overrideNote}`;
	}

	const lines = [
		'Klik tombol **Lihat Usage Saya** untuk melihat penggunaan API Anda langsung (tanpa input ID).',
		'Setelah itu, gunakan **Cari Usage User Lain** jika ingin cek user lain.',
		`Untuk detail lebih lengkap (charts, keys, activity, models), buka **Dashboard**: ${PORTAL_DASHBOARD_URL}`,
		'',
		'**Global Quotas:**',
		`- Prompts: ${fmt(limits.globalPromptLimit, 'prompts')} (${limits.globalPromptLimitWindow || '5h'}) — 1 per turn`,
		`- API calls: ${fmt(limits.globalRateLimit, 'calls')} (${limits.globalRateLimitWindow || '5h'}) — every hop`,
		perModelLine,
		'',
		'**Global Tokens Limit:**',
		`- Input Harian: ${fmtTok(limits.globalDailyInputTokenLimit)}`,
		`- Output Harian: ${fmtTok(limits.globalDailyOutputTokenLimit)}`,
		`- Total Harian: ${fmtTok(limits.globalDailyTokenLimit)}`,
		`- Bulanan: ${fmtTok(limits.globalMonthlyTokenLimit)}`,
		'',
		'_Per-user limits bervariasi per API key. Klik tombol untuk cek usage spesifik._',
		'_Klik **See Model Limit** / **Add-on Config** untuk detail override & pack._',
		'_Klik **More di Dashboard** untuk buka portal web._',
	];

	return new EmbedBuilder()
		.setTitle('🔍 Cari Usage User')
		.setDescription(lines.join('\n'))
		.setColor(0x57f287);
}

function buildSearchRow(includeOther = false) {
	const buttons = [
		new ButtonBuilder()
			.setCustomId('ranking_search_user')
			.setLabel('Lihat Usage Saya')
			.setEmoji('🔍')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('ranking_see_model_limits')
			.setLabel('See Model Limit')
			.setEmoji('🎯')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('ranking_see_addons')
			.setLabel('Add-on Config')
			.setEmoji('📦')
			.setStyle(ButtonStyle.Secondary),
	];
	if (includeOther) {
		buttons.push(
			new ButtonBuilder()
				.setCustomId('ranking_search_user_other')
				.setLabel('Cari Usage User Lain')
				.setEmoji('👥')
				.setStyle(ButtonStyle.Secondary),
		);
	}
	buttons.push(buildDashboardLinkButton());
	return new ActionRowBuilder().addComponents(...buttons);
}

function buildUsageDetailRow(includeOther = false) {
	const buttons = [
		new ButtonBuilder()
			.setCustomId('ranking_see_model_limits')
			.setLabel('See Model Limit')
			.setEmoji('🎯')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('ranking_token_saver')
			.setLabel('Token Saver')
			.setEmoji('💾')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('ranking_see_addons')
			.setLabel('Add-on Config')
			.setEmoji('📦')
			.setStyle(ButtonStyle.Secondary),
	];
	if (includeOther) {
		buttons.push(
			new ButtonBuilder()
				.setCustomId('ranking_search_user_other')
				.setLabel('Cari Usage User Lain')
				.setEmoji('👥')
				.setStyle(ButtonStyle.Secondary),
		);
	}
	buttons.push(buildDashboardLinkButton());
	return new ActionRowBuilder().addComponents(...buttons);
}

function fmtTokShort(v) {
	if (!v || v <= 0) return '—';
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
	return String(v);
}

function buildAddonDetailEmbed(addon) {
	const allow = addon.modelAllowlistParsed || [];
	const deny = addon.modelDenylistParsed || [];
	const dailyLimits = addon.modelDailyLimitsParsed || {};
	const mode = addon.accessMode || 'allowlist';
	const lines = [
		addon.description || '_Tidak ada deskripsi_',
		'',
		`**Access mode:** \`${mode}\``,
		`**Daily pack tokens:** ${fmtTokShort(addon.dailyTokenLimit)}`,
		`**Monthly pack tokens:** ${fmtTokShort(addon.monthlyTokenLimit)}`,
		`**Max devices:** ${addon.maxDevices > 0 ? addon.maxDevices : '—'}`,
		`**Default duration:** ${addon.defaultDurationDays > 0 ? `${addon.defaultDurationDays}d` : '—'}`,
		`**Active:** ${addon.isActive === false ? 'No' : 'Yes'}`,
	];
	if (allow.length) {
		lines.push(
			`**Allowlist:** ${allow
				.slice(0, 12)
				.map((p) => `\`${p}\``)
				.join(', ')}${allow.length > 12 ? ` (+${allow.length - 12})` : ''}`,
		);
	}
	if (deny.length) {
		lines.push(
			`**Denylist:** ${deny
				.slice(0, 8)
				.map((p) => `\`${p}\``)
				.join(', ')}${deny.length > 8 ? ` (+${deny.length - 8})` : ''}`,
		);
	}
	const subcapKeys = Object.keys(dailyLimits);
	if (subcapKeys.length) {
		lines.push(
			`**Per-model daily caps:** ${subcapKeys
				.slice(0, 6)
				.map((k) => `\`${k}\`=${fmtTokShort(dailyLimits[k])}`)
				.join(', ')}`,
		);
	}
	return new EmbedBuilder()
		.setTitle(`📦 Add-on: ${addon.name}`)
		.setDescription(lines.join('\n').slice(0, 4000))
		.setColor(0x5865f2);
}

function buildAddonPickRow(addonsList) {
	const menu = new StringSelectMenuBuilder()
		.setCustomId('ranking_addon_pick')
		.setPlaceholder('Pilih add-on untuk detail…')
		.addOptions(
			addonsList.slice(0, 25).map((a) => ({
				label: String(a.name || `addon-${a.id}`).slice(0, 100),
				value: String(a.id),
				description: String(a.description || 'Add-on pack')
					.replace(/\s+/g, ' ')
					.slice(0, 100),
			})),
		);
	return new ActionRowBuilder().addComponents(menu);
}

async function handleRankingSeeAddons(interaction) {
	await interaction.deferReply({ ephemeral: true });
	const access = await getMemberToolAccess(interaction.member);
	if (!access.canUseTools) {
		await interaction.editReply({ content: toolAccessDeniedMessage(access) });
		return;
	}
	let res;
	try {
		res = await proxyInternal('/admin/addons');
	} catch (err) {
		await interaction.editReply({
			content: '❌ Gagal fetch add-ons: ' + (err.message || err),
		});
		return;
	}
	const rows = ((res && res.data) || []).filter((a) => a && a.isActive !== false);
	if (!rows.length) {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle('📦 Add-on Config')
					.setDescription('Belum ada add-on terdaftar.')
					.setColor(0x99aab5),
			],
		});
		return;
	}
	if (rows.length === 1) {
		await interaction.editReply({ embeds: [buildAddonDetailEmbed(rows[0])] });
		return;
	}
	const listLines = rows.slice(0, 15).map((a, i) => {
		const tok = fmtTokShort(a.dailyTokenLimit);
		return `${i + 1}. **${a.name}** — daily ${tok} · \`${a.accessMode || 'allowlist'}\``;
	});
	await interaction.editReply({
		embeds: [
			new EmbedBuilder()
				.setTitle('📦 Add-on Config')
				.setDescription(
					[
						'Pilih add-on di menu di bawah untuk lihat detail (allowlist, pack token, akses).',
						'',
						...listLines,
						rows.length > 15 ? `\n_…+${rows.length - 15} lainnya_` : '',
					].join('\n'),
				)
				.setColor(0x5865f2),
		],
		components: [buildAddonPickRow(rows)],
	});
}

async function handleRankingAddonPick(interaction) {
	await interaction.deferUpdate();
	const access = await getMemberToolAccess(interaction.member);
	if (!access.canUseTools) {
		await interaction.editReply({
			content: toolAccessDeniedMessage(access),
			embeds: [],
			components: [],
		});
		return;
	}
	const pickId = Number(interaction.values[0]);
	let res;
	try {
		res = await proxyInternal('/admin/addons');
	} catch (err) {
		await interaction.editReply({
			content: '❌ Gagal fetch add-ons: ' + (err.message || err),
			embeds: [],
			components: [],
		});
		return;
	}
	const rows = (res && res.data) || [];
	const addon = rows.find((a) => Number(a.id) === pickId);
	if (!addon) {
		await interaction.editReply({
			content: '❌ Add-on tidak ditemukan.',
			embeds: [],
			components: [],
		});
		return;
	}
	const active = rows.filter((a) => a && a.isActive !== false);
	await interaction.editReply({
		embeds: [buildAddonDetailEmbed(addon)],
		components: active.length > 1 ? [buildAddonPickRow(active)] : [],
	});
}

function fmtGlobalModelLimitRow(r, perModelWindow = '1d') {
	const parts = [];
	const win = (r.promptLimitWindow || perModelWindow || '1d').trim() || '1d';
	if (r.promptLimit > 0) parts.push(r.promptLimit + ' prompt / ' + win);
	if (r.dailyTokenLimit > 0)
		parts.push(r.dailyTokenLimit.toLocaleString() + ' daily tok');
	if (r.monthlyTokenLimit > 0)
		parts.push(r.monthlyTokenLimit.toLocaleString() + ' monthly tok');
	if (r.dailyInputTokenLimit > 0)
		parts.push(r.dailyInputTokenLimit.toLocaleString() + ' daily in');
	if (r.dailyOutputTokenLimit > 0)
		parts.push(r.dailyOutputTokenLimit.toLocaleString() + ' daily out');
	const limit = parts.length ? parts.join(', ') : 'Unlimited';
	const tag = '`' + r.model + '`';
	if (r.isPattern) {
		const count = r.matchCount || 0;
		const sample = (r.matchedIds || [])
			.slice(0, 5)
			.map((m) => '`' + m + '`')
			.join(', ');
		const more = count > 5 ? ' +' + (count - 5) + ' lainnya' : '';
		return (
			'🧩 ' +
			tag +
			' → ' +
			count +
			' model · ' +
			limit +
			(sample
				? '\n   ' + sample + more
				: '\n   _belum ada model di catalog yang cocok_')
		);
	}
	return '🎯 ' + tag + ' · ' + limit;
}

async function buildTrialLimitsEmbed() {
	let cfg;
	try {
		cfg = await proxyInternal('/admin/internal/trial-panel-config');
	} catch (err) {
		return {
			error: 'Gagal memuat config trial: ' + (err.message || 'Unknown error'),
		};
	}
	const models = await getTrialModelsCached();
	const modelLines = (models.gpyModels || [])
		.slice(0, 25)
		.map((m) => `• \`${m}\``)
		.join('\n');
	const desc = [
		'**🎁 Trial Limits** _(all models + auto)_',
		'',
		`• **Prompt:** ${cfg.trialPromptLimit ?? 50} prompts / ${cfg.trialPromptLimitWindow || '5h'}`,
		`• **Token harian:** ${(cfg.trialDailyTokenLimit ?? 0).toLocaleString()}`,
		`• **Durasi default:** ${cfg.trialDefaultDurationDays ?? 1} hari`,
		`• **Max klaim/akun:** ${cfg.trialMaxPerAccount ?? 1}`,
		`• **Mode model:** ${cfg.trialModelSelectionMode === 'whitelist' ? 'Whitelist' : 'Semua model'}`,
		'',
		'**Model tersedia:**',
		modelLines || '_Belum ada model di catalog_',
		(models.gpyModels || []).length > 25
			? `_...dan ${models.gpyModels.length - 25} model lainnya_`
			: '',
	]
		.filter(Boolean)
		.join('\n');
	return {
		embed: new EmbedBuilder()
			.setTitle('🎯 See Model Limit — Trial')
			.setDescription(desc)
			.setColor(0x57f287)
			.setFooter({ text: 'Limit trial terpisah dari limit global Phantom.' })
			.setTimestamp(),
		isTrial: true,
	};
}

async function buildSeeModelLimitsEmbed(filter, access = null) {
	if (access?.mode === 'trial') {
		return buildTrialLimitsEmbed();
	}

	let rows = [];
	let perModelWindow = '1d';
	try {
		const [r, settings] = await Promise.all([
			proxyInternal('/admin/settings/model-limits'),
			proxyInternal('/admin/settings/global').catch(() => null),
		]);
		rows = (r && r.data) || [];
		perModelWindow =
			(settings && settings.globalPerModelPromptLimitWindow) || '1d';
	} catch (err) {
		return {
			error:
				'Gagal mengambil model limits: ' + (err.message || 'Unknown error'),
		};
	}

	const exacts = rows.filter((r) => !r.isPattern);
	const patterns = rows.filter((r) => r.isPattern);
	let chosen;
	let filterLabel;
	if (filter === 'exact') {
		chosen = exacts;
		filterLabel = 'Exact Override';
	} else if (filter === 'pattern') {
		chosen = patterns;
		filterLabel = 'Pattern / Batch';
	} else {
		chosen = rows;
		filterLabel = 'Semua Override';
	}

	if (rows.length === 0) {
		return {
			embed: new EmbedBuilder()
				.setTitle('🎯 See Model Limit')
				.setDescription(
					'ℹ️ Belum ada model override global. Tambah dari dashboard **Settings > Model Limits**.',
				)
				.setColor(0x5865f2),
		};
	}

	if (chosen.length === 0) {
		return {
			embed: new EmbedBuilder()
				.setTitle('🎯 See Model Limit · ' + filterLabel)
				.setDescription(
					'ℹ️ Tidak ada entry untuk filter ini.\n\nExact: ' +
						exacts.length +
						' · Pattern: ' +
						patterns.length,
				)
				.setColor(0x5865f2),
		};
	}

	const desc = [
		'**Filter:** ' +
			filterLabel +
			'  ·  Exact: ' +
			exacts.length +
			' · Pattern: ' +
			patterns.length,
		'_Window per-model (tease/override): **' + perModelWindow + '**_',
		'',
		chosen
			.slice(0, 15)
			.map((row) => fmtGlobalModelLimitRow(row, perModelWindow))
			.join('\n\n'),
		chosen.length > 15
			? '_...dan ' + (chosen.length - 15) + ' entry lainnya_'
			: '',
		'',
		'_Pattern (🧩) = substring match ke semua model di catalog. Match count = berapa model di catalog yang substring mengandung pattern._',
	]
		.filter(Boolean)
		.join('\n');

	return {
		embed: new EmbedBuilder()
			.setTitle('🎯 See Model Limit · ' + filterLabel)
			.setDescription(desc)
			.setColor(0x5865f2)
			.setFooter({ text: 'Ganti filter lewat dropdown di bawah.' })
			.setTimestamp(),
	};
}

function buildSeeModelLimitsRow(currentFilter) {
	const menu = new StringSelectMenuBuilder()
		.setCustomId('ranking_model_limit_filter')
		.setPlaceholder(
			'Filter: ' +
				(currentFilter === 'exact'
					? 'Exact Override'
					: currentFilter === 'pattern'
						? 'Pattern / Batch'
						: 'Semua'),
		)
		.addOptions([
			{
				label: 'Semua',
				value: 'all',
				default: !currentFilter || currentFilter === 'all',
				description: 'Tampilkan semua override (exact + pattern)',
			},
			{
				label: 'Exact Override',
				value: 'exact',
				default: currentFilter === 'exact',
				description: 'Override per model (1 entry = 1 model)',
			},
			{
				label: 'Pattern / Batch',
				value: 'pattern',
				default: currentFilter === 'pattern',
				description: 'Override via substring (1 entry = banyak model)',
			},
		]);
	return new ActionRowBuilder().addComponents(menu);
}

async function handleRankingSeeModelLimits(interaction) {
	await interaction.deferReply({ ephemeral: true });
	const access = await getMemberToolAccess(interaction.member);
	if (!access.canUseTools) {
		await interaction.editReply({ content: toolAccessDeniedMessage(access) });
		return;
	}
	const filter = interaction.customId.split(':')[1] || 'all';
	const out = await buildSeeModelLimitsEmbed(filter, access);
	if (out.error) {
		await interaction.editReply({ content: '❌ ' + out.error });
		return;
	}
	await interaction.editReply({
		embeds: [out.embed],
		components: out.isTrial ? [] : [buildSeeModelLimitsRow(filter)],
	});
}

async function handleRankingModelLimitFilter(interaction) {
	await interaction.deferUpdate();
	const access = await getMemberToolAccess(interaction.member);
	if (!access.canUseTools) {
		await interaction.editReply({
			content: toolAccessDeniedMessage(access),
			embeds: [],
			components: [],
		});
		return;
	}
	const filter = interaction.values[0] || 'all';
	const out = await buildSeeModelLimitsEmbed(filter, access);
	if (out.error) {
		await interaction.editReply({ content: '❌ ' + out.error });
		return;
	}
	await interaction.editReply({
		embeds: [out.embed],
		components: out.isTrial ? [] : [buildSeeModelLimitsRow(filter)],
	});
}

// ─── Monthly Recap panel ────────────────────────────────────────────────────
function buildRecapPanelEmbed(win) {
	const monthLabel = win ? win.monthLabel : 'bulan ini';
	const embed = new EmbedBuilder()
		.setTitle(`🎁 Wrapped — ${monthLabel}`)
		.setColor(0xec4899)
		.setDescription(
			'Jejak ngodingmu bulan ini udah kami rangkum jadi sesuatu yang... menarik. 👀\n' +
				'Berani buka?\n\n' +
				'_Testimoni: semua peserta lintas bulan (bergilir)._',
		)
		.setFooter({
			text:
				win && !win.isOpen
					? `⏳ Dibuka ${win.openDay} ${win.openMonthLabel} – 5 ${win.closeMonthLabel}`
					: win
						? `🟢 Sedang dibuka • sampai 5 ${win.closeMonthLabel}`
						: 'Recap bulanan',
		});
	return embed;
}

function buildRecapRow() {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('monthly_recap')
			.setLabel('🎁 Lihat Recap Saya')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('recap_testi_view')
			.setLabel('💬 Lihat Testimoni')
			.setStyle(ButtonStyle.Secondary),
	);
}

// Debug panel: anyone can generate their own OR view someone else's by user id.
function buildRecapDebugEmbed(win) {
	return new EmbedBuilder()
		.setTitle('🛠️ Recap Debug Panel')
		.setColor(0x22d3ee)
		.setDescription(
			'Panel debug recap (selalu aktif untuk testing).\n\n' +
				'🎁 **Generate Recap-ku** — buat & lihat recap kamu sendiri.\n' +
				'🔍 **Lihat Recap User** — masukkan User ID untuk lihat recap orang lain.\n' +
				'💬 **Lihat Testimoni** — semua testimoni di DB (lintas bulan), bergilir 10 menit.\n\n' +
				(win
					? `Bulan target: **${win.monthLabel}** • Window: ${win.isOpen ? '🟢 OPEN' : '🔒 CLOSED'}`
					: ''),
		)
		.setFooter({ text: 'Debug only • data di-generate ulang tiap hari' });
}

function buildRecapDebugRow() {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('recap_debug_self')
			.setLabel('🎁 Generate Recap-ku')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('recap_debug_other')
			.setLabel('🔍 Lihat Recap User')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('recap_testi_view_debug')
			.setLabel('💬 Lihat Testimoni')
			.setStyle(ButtonStyle.Secondary),
	);
}

// Panel in the RECAP channel — only present while the window panel is visible
// (from the 25th through the 5th). Removed otherwise. Role-gated on click.
async function ensureRecapMessage() {
	if (!RECAP_CHANNEL_ID) return;
	const channel = await client.channels
		.fetch(RECAP_CHANNEL_ID)
		.catch(() => null);
	if (!channel || !channel.isTextBased()) return;

	let win = null;
	try {
		win = await proxyInternal('/admin/internal/recap/window');
	} catch {
		/* ignore */
	}

	const shouldShow = win ? !!win.panelVisible : false;

	// If it should not be visible, remove any existing panel and stop.
	if (!shouldShow) {
		if (recapState.panelMessageId) {
			const existing = await channel.messages
				.fetch(recapState.panelMessageId)
				.catch(() => null);
			if (existing) await existing.delete().catch(() => {});
			recapState.panelMessageId = null;
			await saveRecapState();
		}
		return;
	}

	// Dedupe: delete any extra bot-authored recap panels in agverif, keep one.
	try {
		const recent = await channel.messages
			.fetch({ limit: 50 })
			.catch(() => null);
		if (recent) {
			const mine = recent.filter(
				(m) =>
					m.author.id === client.user.id &&
					m.components?.some((row) =>
						row.components?.some((cmp) => cmp.customId === 'monthly_recap'),
					),
			);
			const sorted = [...mine.values()].sort(
				(a, b) => a.createdTimestamp - b.createdTimestamp,
			);
			const keep = sorted[0];
			for (let i = 1; i < sorted.length; i++)
				await sorted[i].delete().catch(() => {});
			if (keep) {
				recapState.panelMessageId = keep.id;
				await saveRecapState();
				await keep
					.edit({
						embeds: [buildRecapPanelEmbed(win)],
						components: [buildRecapRow()],
					})
					.catch(() => {});
				return;
			}
		}
	} catch {
		/* fall through */
	}

	// Reuse existing message if present.
	if (recapState.panelMessageId) {
		const existing = await channel.messages
			.fetch(recapState.panelMessageId)
			.catch(() => null);
		if (existing) {
			await existing
				.edit({
					embeds: [buildRecapPanelEmbed(win)],
					components: [buildRecapRow()],
				})
				.catch(() => {});
			return;
		}
	}

	const sent = await channel
		.send({
			embeds: [buildRecapPanelEmbed(win)],
			components: [buildRecapRow()],
		})
		.catch((e) => {
			console.error('[recap] Failed to send panel:', e.message);
			return null;
		});
	if (sent) {
		recapState.panelMessageId = sent.id;
		await saveRecapState();
	}
}

// Persistent panel in the DEBUG channel — always present (for testing).
async function ensureRecapDebugMessage() {
	if (!RECAP_DEBUG_CHANNEL_ID) return;
	const channel = await client.channels
		.fetch(RECAP_DEBUG_CHANNEL_ID)
		.catch(() => null);
	if (!channel || !channel.isTextBased()) return;

	let win = null;
	try {
		win = await proxyInternal('/admin/internal/recap/window');
	} catch {
		/* ignore */
	}

	// Delete ALL existing bot recap-debug panels so the button is unique, then
	// always re-send a fresh one so it stays the LAST message in the channel.
	try {
		const recent = await channel.messages
			.fetch({ limit: 50 })
			.catch(() => null);
		if (recent) {
			const mine = recent.filter(
				(m) =>
					m.author.id === client.user.id &&
					m.components?.some((row) =>
						row.components?.some((cmp) => cmp.customId === 'recap_debug_self'),
					),
			);
			for (const m of mine.values()) await m.delete().catch(() => {});
		}
	} catch {
		/* ignore */
	}

	const sent = await channel
		.send({
			embeds: [buildRecapDebugEmbed(win)],
			components: [buildRecapDebugRow()],
		})
		.catch((e) => {
			console.error('[recap] Failed to send debug panel:', e.message);
			return null;
		});
	if (sent) {
		recapState.debugPanelMessageId = sent.id;
		await saveRecapState();
	}
}

function fmtRecapNum(n) {
	n = Number(n) || 0;
	if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
	if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
	return String(Math.round(n));
}

const RECAP_PROGRESS_STAGES = [
	'🔮 Mengumpulkan jejak ngoding kamu...',
	'📊 Menghitung token & request...',
	'🧠 Meramu persona kamu...',
	'🎨 Memilih meme yang pas...',
	'✨ Menyelesaikan recap...',
];

const TESTI_EXPIRE_MS = 10 * 60 * 1000;
const RECAP_EPHEMERAL_EXPIRE_MS = 10 * 60 * 1000;

async function handleMonthlyRecap(interaction) {
	// No role gate: anyone can open their recap (if data exists for the month).
	// Window gate first (cheap reply before defer when closed).
	let win = null;
	try {
		win = await proxyInternal('/admin/internal/recap/window');
	} catch {
		/* ignore */
	}
	if (win && !win.isOpen) {
		await interaction.reply({ content: `🔒 ${win.message}`, ephemeral: true });
		return;
	}
	const lockKey = getRecapLockKey(interaction.user.id, interaction.user.id);
	const claim = tryClaimRecapLock(lockKey);
	if (!claim.ok) {
		await interaction
			.reply({
				content: `⏳ Recap kamu sedang diproses, coba lagi dalam **${claim.remaining} detik** ya 🙏`,
				ephemeral: true,
			})
			.catch(() => {});
		return;
	}
	try {
		await interaction.deferReply({ ephemeral: true });
		await generateAndReplyRecap(interaction, interaction.user, {
			self: true,
			signal: claim.entry.abort.signal,
		});
	} finally {
		releaseRecapLock(lockKey);
	}
}

/**
 * Core recap generation + ephemeral reply. Works for self or another user.
 * Assumes interaction is already deferred (ephemeral).
 * @param targetUser - a Discord User-like { id, username, displayAvatarURL } or { id, username } for others.
 */
async function generateAndReplyRecap(interaction, targetUser, opts = {}) {
	const userId = targetUser.id;
	const self = !!opts.self;
	const signal = opts.signal || undefined;

	let done = false;
	const avatarUrl =
		typeof targetUser.displayAvatarURL === 'function'
			? targetUser.displayAvatarURL({ size: 256, extension: 'png' })
			: undefined;
	const username = targetUser.username;
	// Smooth time-based progress. The bar climbs from ~5% to 99% over
	// EXPECTED_MS using easeOutQuad so it looks alive early and creeps the
	// last 30%. Stages rotate by elapsed-time fraction, so they feel
	// "stages" without snapping the user into a frozen 95% while the AI
	// narrative is still cooking. On a fast cache-hit, we still end up
	// at 100% and immediately yield to the final reply.
	const EXPECTED_MS = 90_000;
	const startedAt = Date.now();
	let lastPct = -1;
	const renderProgress = async (pct, stageIdx) => {
		if (done) return;
		const clamped = Math.max(0, Math.min(99, Math.round(pct)));
		if (clamped === lastPct) return;
		lastPct = clamped;
		const stage =
			RECAP_PROGRESS_STAGES[
				Math.min(stageIdx, RECAP_PROGRESS_STAGES.length - 1)
			];
		const filled = Math.round(clamped / 10);
		const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
		const embed = new EmbedBuilder()
			.setColor(0x7c3aed)
			.setTitle(
				self
					? '🎁 Membuat Recap Kamu...'
					: `🔍 Mengambil Recap ${username || userId}...`,
			)
			.setDescription(`${stage}\n\`${bar}\` ${clamped}%`);
		await interaction.editReply({ embeds: [embed] }).catch(() => {});
	};
	const stageForElapsed = (elapsed) =>
		Math.min(
			RECAP_PROGRESS_STAGES.length - 1,
			Math.floor((elapsed / EXPECTED_MS) * RECAP_PROGRESS_STAGES.length),
		);
	const tick = async () => {
		if (done) return;
		const elapsed = Date.now() - startedAt;
		const t = Math.min(1, elapsed / EXPECTED_MS);
		const eased = 1 - (1 - t) * (1 - t);
		await renderProgress(eased * 99, stageForElapsed(elapsed));
	};
	await renderProgress(5, 0);
	const timer = setInterval(() => {
		tick().catch(() => {});
	}, 700);

	try {
		const data = await proxyInternal(
			`/admin/internal/recap/${userId}`,
			'POST',
			{ avatarUrl, username, interactive: true },
			{ signal },
		);
		done = true;
		clearInterval(timer);

		const s = data.stats || {};
		const totals = s.totals || {};
		const persona = (data.narrative && data.narrative.persona) || {};
		const tokenQuery = data.shareToken
			? `?t=${encodeURIComponent(data.shareToken)}`
			: '';
		const recapUrl = `${RECAP_PUBLIC_BASE_URL}/recap/${encodeURIComponent(data.apiKeyName || username || userId)}${tokenQuery}`;

		const rankReq = (data.rank && data.rank.requests) || 0;
		const rankTok = (data.rank && data.rank.tokens) || 0;
		const fav = (s.models && s.models.favorite) || '-';
		const hr =
			s.activity && s.activity.mostActiveHour
				? `${s.activity.mostActiveHour.hour}:00 WIB`
				: '-';

		const embed = new EmbedBuilder()
			.setColor(0xec4899)
			.setTitle(`🎁 Recap ${data.monthLabel || ''} — ${username || userId}`)
			.setDescription(
				`**${persona.title || 'Coder'}** — ${persona.subtitle || ''}`,
			)
			.addFields(
				{
					name: '📨 Request',
					value: fmtRecapNum(totals.requests),
					inline: true,
				},
				{
					name: '🪙 Total Token',
					value: fmtRecapNum(totals.totalTokens),
					inline: true,
				},
				{
					name: '🏆 Peringkat Req',
					value: rankReq ? `#${rankReq}` : '-',
					inline: true,
				},
				{
					name: '📥 Input',
					value: formatInputBreakdown(
						totals.billablePromptTokens,
						totals.cachedTokens,
						totals.inputTokens,
					).label,
					inline: true,
				},
				{
					name: '📤 Output',
					value: fmtRecapNum(totals.outputTokens),
					inline: true,
				},
				{
					name: '🥇 Peringkat Token',
					value: rankTok ? `#${rankTok}` : '-',
					inline: true,
				},
				{ name: '⭐ Model Favorit', value: String(fav), inline: true },
				{ name: '🕐 Jam Sibuk', value: hr, inline: true },
			)
			.setFooter({
				text: self
					? 'Buka recap web buat kasih testimoni • pesan ini hilang dalam 10 menit'
					: data.degraded
						? 'Recap template (AI offline) • pesan hilang dalam 10 menit'
						: 'Pesan ini hilang dalam 10 menit',
			});
		if (avatarUrl) embed.setThumbnail(avatarUrl);

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setLabel('🎬 Buka Recap (Animasi)')
				.setStyle(ButtonStyle.Link)
				.setURL(recapUrl),
		);

		await interaction.editReply({ embeds: [embed], components: [row] });
		// Auto-delete the ephemeral after 10 minutes.
		setTimeout(() => {
			interaction.deleteReply().catch(() => {});
		}, RECAP_EPHEMERAL_EXPIRE_MS);
	} catch (err) {
		done = true;
		clearInterval(timer);
		let msg;
		if (/AI busy|busy|sibuk/i.test(err.message)) {
			msg =
				'Generate AI lagi penuh — coba lagi sebentar. Kalau masih gagal, hubungi admin (recap cache bulan ini mungkin belum ada).';
		} else if (/not found/i.test(err.message)) {
			msg = self
				? 'Kamu belum punya API key. Verifikasi dulu untuk dapat recap ya!'
				: 'User tersebut tidak punya API key / data recap.';
		} else if (/fetch failed|ECONNRESET|socket hang up/i.test(err.message)) {
			msg =
				'Koneksi ke server putus saat generate recap. Coba lagi ya — biasanya berhasil di percobaan kedua 🙏';
		} else {
			msg = `Gagal membuat recap: ${err.message}`;
		}
		await interaction
			.editReply({ content: `⚠️ ${msg}`, embeds: [], components: [] })
			.catch(() => {});
	}
}

// Debug: generate own recap (no role/window gate — for testing).
async function handleRecapDebugSelf(interaction) {
	const lockKey = getRecapLockKey(interaction.user.id, interaction.user.id);
	const claim = tryClaimRecapLock(lockKey);
	if (!claim.ok) {
		await interaction
			.reply({
				content: `⏳ Recap kamu sedang diproses, coba lagi dalam **${claim.remaining} detik** ya 🙏`,
				ephemeral: true,
			})
			.catch(() => {});
		return;
	}
	try {
		await interaction.deferReply({ ephemeral: true });
		await generateAndReplyRecap(interaction, interaction.user, {
			self: true,
			signal: claim.entry.abort.signal,
		});
	} finally {
		releaseRecapLock(lockKey);
	}
}

// Debug: open a modal to enter a user id to view someone else's recap.
async function handleRecapDebugOtherButton(interaction) {
	const modal = new ModalBuilder()
		.setCustomId('recap_debug_other_modal')
		.setTitle('🔍 Lihat Recap User');
	const input = new TextInputBuilder()
		.setCustomId('discord_user_id')
		.setLabel('Discord User ID')
		.setStyle(TextInputStyle.Short)
		.setRequired(true)
		.setMinLength(5)
		.setMaxLength(25);
	modal.addComponents(new ActionRowBuilder().addComponents(input));
	await interaction.showModal(modal);
}

async function handleRecapDebugOtherModal(interaction) {
	const rawId = (interaction.fields.getTextInputValue('discord_user_id') || '')
		.trim()
		.replace(/[^0-9]/g, '');
	if (!rawId) {
		await interaction
			.reply({ content: '⚠️ User ID tidak valid.', ephemeral: true })
			.catch(() => {});
		return;
	}
	// Try to resolve username/avatar for nicer output (optional).
	let targetUser = { id: rawId, username: rawId };
	try {
		const u = await client.users.fetch(rawId);
		targetUser = u;
	} catch {
		/* user not reachable; proceed with id only */
	}
	const lockKey = getRecapLockKey(interaction.user.id, targetUser.id);
	const claim = tryClaimRecapLock(lockKey);
	if (!claim.ok) {
		await interaction
			.reply({
				content: `⏳ Recap untuk <@${targetUser.id}> sedang diproses, coba lagi dalam **${claim.remaining} detik** ya 🙏`,
				ephemeral: true,
			})
			.catch(() => {});
		return;
	}
	try {
		await interaction.deferReply({ ephemeral: true });
		await generateAndReplyRecap(interaction, targetUser, {
			self: false,
			signal: claim.entry.abort.signal,
		});
	} finally {
		releaseRecapLock(lockKey);
	}
}

// ─── Testimonial viewer: rotating ephemeral, 5s cycle, 10m auto-expire ───────
function formatTestiMonth(ym) {
	if (!ym || typeof ym !== 'string') return null;
	const m = ym.match(/^(\d{4})-(\d{2})$/);
	if (!m) return ym;
	const months = [
		'Januari',
		'Februari',
		'Maret',
		'April',
		'Mei',
		'Juni',
		'Juli',
		'Agustus',
		'September',
		'Oktober',
		'November',
		'Desember',
	];
	const mi = parseInt(m[2], 10) - 1;
	return `${months[mi] || m[2]} ${m[1]}`;
}

function buildTestimonialEmbed(t) {
	const stars =
		'★'.repeat(Math.max(0, Math.min(5, t.stars || 0))) +
		'☆'.repeat(5 - Math.max(0, Math.min(5, t.stars || 0)));
	const rankReq = t.rankRequests || 0;
	const rankTok = t.rankTokens || 0;
	const rankStr =
		[
			rankReq ? `🏆 #${rankReq} req` : null,
			rankTok ? `🪙 #${rankTok} tok` : null,
		]
			.filter(Boolean)
			.join(' • ') || 'peserta aktif';
	const monthLabel = formatTestiMonth(t.yearMonth);
	const embed = new EmbedBuilder()
		.setColor(0xf59e0b)
		.setAuthor({
			name: t.discordUsername || 'Anonim',
			iconURL: t.avatarUrl || undefined,
		})
		.setTitle(`${stars}`)
		.setDescription(
			t.body ? `“${String(t.body).slice(0, 500)}”` : '_(tanpa teks)_',
		)
		.addFields({ name: 'Peringkat', value: rankStr, inline: true });
	if (monthLabel) {
		embed.addFields({ name: 'Bulan', value: monthLabel, inline: true });
	}
	embed.setFooter({
		text: 'Testimoni bergilir tiap 5 detik • hilang dalam 10 menit',
	});
	return embed;
}

async function handleTestimonialViewer(interaction) {
	await interaction.deferReply({ ephemeral: true });
	let data;
	try {
		data = await proxyInternal('/admin/internal/recap/testimonials');
	} catch (err) {
		await interaction
			.editReply({ content: `⚠️ Gagal ambil testimoni: ${err.message}` })
			.catch(() => {});
		return;
	}
	const list = (data && data.testimonials) || [];
	if (!list.length) {
		await interaction
			.editReply({
				content: '💬 Belum ada testimoni. Jadilah yang pertama!',
			})
			.catch(() => {});
		setTimeout(() => {
			interaction.deleteReply().catch(() => {});
		}, TESTI_EXPIRE_MS);
		return;
	}

	// Shuffle once, then rotate through the list (random-ish order).
	const order = [...list].sort(() => Math.random() - 0.5);
	let idx = 0;
	await interaction
		.editReply({ embeds: [buildTestimonialEmbed(order[idx])] })
		.catch(() => {});

	const rotate = setInterval(() => {
		idx = (idx + 1) % order.length;
		interaction
			.editReply({ embeds: [buildTestimonialEmbed(order[idx])] })
			.catch(() => {});
	}, 5000);

	setTimeout(() => {
		clearInterval(rotate);
		interaction.deleteReply().catch(() => {});
	}, TESTI_EXPIRE_MS);
}

// ─── Daily recap regeneration + debug post ──────────────────────────────────
async function resolveAvatarsForLeaderboard(yearMonth) {
	let lb;
	try {
		lb = await proxyInternal(
			`/admin/internal/recap/leaderboard${yearMonth ? `?yearMonth=${yearMonth}` : ''}`,
		);
	} catch (err) {
		console.error('[recap] leaderboard fetch failed:', err.message);
		return null;
	}
	const ids = new Set();
	for (const r of [...(lb.byRequests || []), ...(lb.byTokens || [])]) {
		if (r.discordUserId) ids.add(r.discordUserId);
	}
	const avatars = [];
	for (const id of ids) {
		try {
			const user = await client.users.fetch(id);
			avatars.push({
				discordUserId: id,
				avatarUrl: user.displayAvatarURL({ size: 128, extension: 'png' }),
				username: user.username,
			});
		} catch {
			/* user may be unreachable */
		}
	}
	if (avatars.length) {
		await proxyInternal('/admin/internal/recap/leaderboard-avatars', 'POST', {
			yearMonth: lb.yearMonth,
			avatars,
		}).catch((e) => console.error('[recap] push avatars failed:', e.message));
	}
	return lb;
}

async function runDailyRecapJob(opts = {}) {
	const skipIfToday = !!opts.skipIfToday;
	const label = skipIfToday ? 'pre-generate' : 'daily recap regeneration';
	console.log(`[recap] Running ${label}...`);
	let win = null;
	try {
		win = await proxyInternal('/admin/internal/recap/window');
	} catch {
		/* ignore */
	}
	const yearMonth = win ? win.yearMonth : undefined;

	// Regenerate recap data for all users with a key. The 24h daily job
	// forces a full regen (force=true); the H-2 pregen reuses today's cache
	// (skipIfToday=true) so we don't burn AI tokens for users who already
	// opened their recap earlier in the day.
	let users = [];
	try {
		const res = await proxyInternal(`/admin/internal/recap/users?yearMonth=${yearMonth}`);
		users = res.users || [];
	} catch (err) {
		console.error('[recap] users fetch failed:', err.message);
	}

	let ok = 0,
		fail = 0;
	const errors = [];
	for (const u of users) {
		if (!u.discordUserId) continue;
		try {
			let avatarUrl, username;
			try {
				const user = await client.users.fetch(u.discordUserId);
				avatarUrl = user.displayAvatarURL({ size: 256, extension: 'png' });
				username = user.username;
			} catch {
				/* ignore avatar fetch */
			}
			await proxyInternal(`/admin/internal/recap/${u.discordUserId}`, 'POST', {
				avatarUrl,
				username,
				force: !skipIfToday,
				skipIfToday,
				yearMonth,
			});
			ok++;
			// Avoid hammering proxy while each regen can take 60–90s of outbound fetches.
			await new Promise((r) => setTimeout(r, 2000));
		} catch (err) {
			fail++;
			if (errors.length < 5) errors.push(`${u.discordUserId}: ${err.message}`);
		}
	}
	if (errors.length)
		console.error(`[recap] ${label} errors:`, errors.join(' | '));

	const lb = await resolveAvatarsForLeaderboard(yearMonth);

	// Debug LOG post: keep exactly ONE log message (edit in place, never pile up).
	try {
		const channel = await client.channels
			.fetch(RECAP_DEBUG_CHANNEL_ID)
			.catch(() => null);
		if (channel && channel.isTextBased()) {
			const topReq =
				((lb && lb.byRequests) || [])
					.slice(0, 5)
					.map(
						(r) =>
							`**${r.rank}.** ${r.discordUsername || r.discordUserId || '?'} — ${fmtRecapNum(r.value)} req`,
					)
					.join('\n') || '_kosong_';
			const sampleName =
				lb && lb.byRequests && lb.byRequests[0]
					? lb.byRequests[0].discordUsername || ''
					: '';
			const embed = new EmbedBuilder()
				.setColor(0x22d3ee)
				.setTitle('🛠️ Recap Debug — Daily Regenerate')
				.setDescription(
					`Bulan target: **${win ? win.monthLabel : '-'}** (${yearMonth || '-'})\n` +
						`Window: ${win ? (win.isOpen ? '🟢 OPEN' : '🔒 CLOSED') : '?'}\n` +
						`Regenerate: ✅ ${ok} sukses, ❌ ${fail} gagal (dari ${users.length} user)`,
				)
				.addFields(
					{ name: '🏆 Top 5 Request', value: topReq },
					{
						name: '🔗 Contoh Link',
						value: sampleName
							? `${RECAP_PUBLIC_BASE_URL}/recap/${encodeURIComponent(sampleName)}`
							: '_tidak ada_',
					},
				)
				.setFooter({ text: discordTime(new Date(), 'F') });

			// Edit existing log message if present, else create one.
			let logMsg = recapState.debugLogMessageId
				? await channel.messages
						.fetch(recapState.debugLogMessageId)
						.catch(() => null)
				: null;
			if (logMsg) {
				await logMsg.edit({ embeds: [embed] }).catch(() => {});
			} else {
				const sent = await channel.send({ embeds: [embed] }).catch(() => null);
				if (sent) {
					recapState.debugLogMessageId = sent.id;
					await saveRecapState();
				}
			}
		}
	} catch (err) {
		console.error('[recap] debug post failed:', err.message);
	}

	// Refresh the public panel + ensure the debug button stays the LAST message.
	await ensureRecapMessage().catch(() => {});
	await ensureRecapDebugMessage().catch(() => {});
	console.log(`[recap] Daily job done: ${ok} ok, ${fail} fail.`);
}

/**
 * Fire-once-per-yearMonth pregen: when the recap access window transitions to
 * isOpen=true for a new yearMonth, kick `runDailyRecapJob({skipIfToday:true})`
 * in the background so all active users' recaps are warm-cached before they
 * click. Idempotent — the fired yearMonth is persisted in recapState so a
 * bot restart within the same window won't re-fire.
 */
async function maybeFirePregen() {
	let win = null;
	try {
		win = await proxyInternal('/admin/internal/recap/window');
	} catch {
		return;
	}
	if (!win || !win.isOpen) return;
	if (recapState.pregenFiredYearMonth === win.yearMonth) return; // already fired for this cycle

	console.log(
		`[recap] Window opened for ${win.yearMonth}, pre-generating all active keys...`,
	);
	recapState.pregenFiredYearMonth = win.yearMonth;
	await saveRecapState().catch(() => {});

	// Run in the background so the scheduler tick returns immediately.
	setImmediate(() => {
		runDailyRecapJob({ skipIfToday: true }).catch((err) =>
			console.error('[recap] pregen error:', err.message),
		);
	});
}

// ─── Refresh Ranking Embeds ────────────────────────────────────────────────────
async function refreshRankingEmbeds() {
	if (!TOKITO_CHANNEL_ID) return;
	const { messages } = rankingState;
	if (
		!messages.modelByRequests ||
		!messages.modelByTokens ||
		!messages.userByRequests ||
		!messages.userByTokens
	)
		return;

	let ranking;
	try {
		ranking = await proxyInternal('/admin/internal/stats/ranking');
	} catch (err) {
		console.error('[ranking] Failed to fetch ranking data:', err.message);
		return;
	}

	const channel = await client.channels
		.fetch(TOKITO_CHANNEL_ID)
		.catch(() => null);
	if (!channel || !channel.isTextBased()) return;

	const { today, month } = ranking;

	// Embed 1: Top Models by Requests
	try {
		const msg = await channel.messages
			.fetch(messages.modelByRequests)
			.catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'🏆 Top Models — By Prompts',
				0x5865f2,
				today.topModelsByRequests,
				month.topModelsByRequests,
				(item) => `\`${item.model}\` — **${item.count.toLocaleString()}** prompts`,
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) {
		console.error('[ranking] Edit modelByRequests failed:', err.message);
	}

	// Embed 2: Top Models by Tokens
	try {
		const msg = await channel.messages
			.fetch(messages.modelByTokens)
			.catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'🏆 Top Models — By Tokens',
				0x4f46e5,
				today.topModelsByTokens,
				month.topModelsByTokens,
				(item) => `\`${item.model}\` — **${formatTokens(item.tokens)}** tokens`,
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) {
		console.error('[ranking] Edit modelByTokens failed:', err.message);
	}

	// Embed 3: Top Users by Requests
	try {
		const msg = await channel.messages
			.fetch(messages.userByRequests)
			.catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'👤 Top Users — By Prompts',
				0x22d3ee,
				today.topUsersByRequests,
				month.topUsersByRequests,
				(item) => {
					let name = item.discordUsername || 'Unknown';
					if (
						item.discordUserId &&
						item.discordUsername === item.discordUserId
					) {
						name = `<@${item.discordUserId}>`;
					}
					const suffix = item.isTrial ? ' 🎁' : '';
					return `**${name}**${suffix} — **${item.requests.toLocaleString()}** prompts`;
				},
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) {
		console.error('[ranking] Edit userByRequests failed:', err.message);
	}

	// Embed 4: Top Users by Tokens
	try {
		const msg = await channel.messages
			.fetch(messages.userByTokens)
			.catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'👤 Top Users — By Tokens',
				0x10b981,
				today.topUsersByTokens,
				month.topUsersByTokens,
				(item) => {
					let name = item.discordUsername || 'Unknown';
					if (
						item.discordUserId &&
						item.discordUsername === item.discordUserId
					) {
						name = `<@${item.discordUserId}>`;
					}
					const suffix = item.isTrial ? ' 🎁' : '';
					return `**${name}**${suffix} — ${formatTokens(item.tokens)} tok (📥 ${formatTokens(item.promptTokens || 0)} / 📤 ${formatTokens(item.completionTokens || 0)})`;
				},
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) {
		console.error('[ranking] Edit userByTokens failed:', err.message);
	}

	// Embed 5: Search User (with refreshed limits + dashboard button)
	try {
		const msg = await channel.messages
			.fetch(messages.searchUser)
			.catch(() => null);
		if (msg) {
			await msg.edit({
				embeds: [await buildSearchEmbed()],
				components: [buildSearchRow()],
			});
		}
	} catch (err) {
		console.error('[ranking] Edit searchUser failed:', err.message);
	}
}

// ─── Ensure Ranking Messages (check/repair/create) ────────────────────────────
async function ensureRankingMessages() {
	if (!TOKITO_CHANNEL_ID) {
		console.log('[ranking] TOKITO_CHANNEL_ID not set, skipping ranking setup.');
		return;
	}

	const channel = await client.channels.fetch(TOKITO_CHANNEL_ID).catch((e) => {
		console.error('[ranking] Failed to fetch channel:', e.message);
		return null;
	});
	if (!channel || !channel.isTextBased()) {
		console.log('[ranking] Channel not found or not text-based.');
		return;
	}

	// Check if all 5 messages exist, are from this bot, and are in correct order
	const { messages } = rankingState;
	const msgIds = [
		messages.modelByRequests,
		messages.modelByTokens,
		messages.userByRequests,
		messages.userByTokens,
		messages.searchUser,
	];
	const allExist = msgIds.every(Boolean);

	let valid = false;
	let existingMsgs = [];

	if (allExist) {
		try {
			existingMsgs = await Promise.all(
				msgIds.map((id) => channel.messages.fetch(id).catch(() => null)),
			);
			// All must exist, be from bot, and be in ascending time order
			const allFound = existingMsgs.every(
				(m) => m && m.author.id === client.user.id,
			);
			if (allFound) {
				// Check order: each message must be newer than the previous
				const timestamps = existingMsgs.map((m) => m.createdTimestamp);
				const inOrder = timestamps.every(
					(t, i) => i === 0 || t > timestamps[i - 1],
				);
				valid = inOrder;
			}
		} catch (err) {
			console.error('[ranking] Error validating messages:', err.message);
		}
	}

	if (!valid) {
		console.log('[ranking] Messages missing or out of order — recreating...');

		// Delete old ranking messages
		for (const msgId of msgIds) {
			if (!msgId) continue;
			try {
				const m = await channel.messages.fetch(msgId).catch(() => null);
				if (m && m.author.id === client.user.id) await m.delete();
			} catch {}
		}

		// Initial embed content (will be refreshed right after)
		const placeholder = new EmbedBuilder()
			.setTitle('⏳ Loading...')
			.setDescription('Data sedang dimuat...')
			.setColor(0x888888);

		const m1 = await channel.send({ embeds: [placeholder] });
		const m2 = await channel.send({ embeds: [placeholder] });
		const m3 = await channel.send({ embeds: [placeholder] });
		const m4 = await channel.send({ embeds: [placeholder] });
		const m5 = await channel.send({
			embeds: [await buildSearchEmbed()],
			components: [buildSearchRow()],
		});

		rankingState.channelId = TOKITO_CHANNEL_ID;
		rankingState.messages = {
			modelByRequests: m1.id,
			modelByTokens: m2.id,
			userByRequests: m3.id,
			userByTokens: m4.id,
			searchUser: m5.id,
		};
		await saveRankingState();
		console.log('[ranking] Created 5 new ranking messages.');
	} else {
		console.log('[ranking] All 5 ranking messages are valid — reusing.');
	}

	// Immediately refresh ranking data
	await refreshRankingEmbeds().catch((e) =>
		console.error('[ranking] Initial refresh failed:', e.message),
	);
}

// ─── Trial Panel ─────────────────────────────────────────────────────────────
function buildTrialPanelEmbed(cfg) {
	const embedCfg = cfg?.trialEmbedConfig || {};
	const title = embedCfg.title || '🎁 Trial API Access — Klaim Sekarang!';
	const description =
		embedCfg.description ||
		'Klik tombol di bawah untuk klaim trial API proxy Groupy.';
	const color = embedCfg.color || 0x57f287;
	const footer = embedCfg.footer || 'Groupy Proxy Trial';
	return new EmbedBuilder()
		.setTitle(title)
		.setDescription(description)
		.setColor(color)
		.setFooter({ text: footer })
		.setTimestamp();
}

function buildTrialPanelRow(cfg) {
	const label = cfg?.trialEmbedConfig?.buttonLabel || 'Klaim Trial API';
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(TRIAL_CLAIM_BUTTON)
			.setLabel(label)
			.setEmoji('🎁')
			.setStyle(ButtonStyle.Success),
	);
}

function isTrialPanelMessage(msg) {
	if (!msg || msg.author?.id !== client.user.id) return false;
	return msg.components?.some((row) =>
		row.components?.some((c) => c.customId === TRIAL_CLAIM_BUTTON),
	);
}

async function saveTrialPanelMessageId(messageId) {
	await proxyInternal('/admin/internal/trial-panel-message-id', 'POST', {
		messageId: messageId || null,
	});
}

let trialPanelSyncRunning = false;

async function ensureTrialPanelMessage() {
	if (!TOKITO_CHANNEL_ID) return;
	if (trialPanelSyncRunning) return;
	trialPanelSyncRunning = true;

	try {
		let cfg;
		try {
			cfg = await proxyInternal('/admin/internal/trial-panel-config');
		} catch (err) {
			console.error('[trial] Failed to load trial config:', err.message);
			return;
		}

		const channel = await client.channels
			.fetch(TOKITO_CHANNEL_ID)
			.catch((err) => {
				console.error('[trial] Failed to fetch channel:', err.message);
				return null;
			});
		if (!channel || !channel.isTextBased()) return;

		const recent = await channel.messages
			.fetch({ limit: 50 })
			.catch(() => null);
		const trialPanels = recent
			? [...recent.values()].filter(isTrialPanelMessage)
			: [];

		const panelPayload = {
			embeds: [buildTrialPanelEmbed(cfg)],
			components: [buildTrialPanelRow(cfg)],
		};

		if (!cfg.trialEnabled) {
			for (const msg of trialPanels) {
				await msg.delete().catch(() => {});
			}
			if (cfg.trialPanelMessageId) {
				const saved = await channel.messages
					.fetch(cfg.trialPanelMessageId)
					.catch(() => null);
				if (saved && saved.author?.id === client.user.id) {
					await saved.delete().catch(() => {});
				}
				await saveTrialPanelMessageId(null);
			}
			return;
		}

		let currentPanel = null;
		const savedId = cfg.trialPanelMessageId;

		if (savedId) {
			const byId =
				recent?.get(savedId) ||
				(await channel.messages.fetch(savedId).catch(() => null));
			if (isTrialPanelMessage(byId)) {
				currentPanel = byId;
			} else if (!byId) {
				await saveTrialPanelMessageId(null);
			} else if (byId.author?.id === client.user.id) {
				currentPanel = byId;
			}
		}

		if (!currentPanel && trialPanels.length > 0) {
			currentPanel = trialPanels.sort(
				(a, b) => b.createdTimestamp - a.createdTimestamp,
			)[0];
		}

		if (currentPanel) {
			const edited = await currentPanel.edit(panelPayload).catch((err) => {
				console.warn('[trial] Panel edit failed, will recreate:', err.message);
				return null;
			});
			if (edited) {
				for (const msg of trialPanels) {
					if (msg.id !== currentPanel.id) await msg.delete().catch(() => {});
				}
				if (savedId !== currentPanel.id) {
					await saveTrialPanelMessageId(currentPanel.id);
				}
				return;
			}
			currentPanel = null;
		}

		for (const msg of trialPanels) {
			await msg.delete().catch(() => {});
		}

		const sent = await channel.send(panelPayload).catch((err) => {
			console.error('[trial] Failed to send panel:', err.message);
			return null;
		});
		if (sent) {
			await saveTrialPanelMessageId(sent.id);
			console.log('[trial] Created trial panel message:', sent.id);
		}
	} finally {
		trialPanelSyncRunning = false;
	}
}

async function refreshTrialPanelIfNeeded() {
	await ensureTrialPanelMessage();
}

async function handleTrialClaimButton(interaction) {
	await interaction.deferReply({ ephemeral: true });
	let cfg;
	try {
		cfg = await proxyInternal('/admin/internal/trial-panel-config');
	} catch (err) {
		await interaction.editReply({
			content: `❌ Gagal memuat config trial: ${err.message}`,
		});
		return;
	}

	if (!cfg.trialEnabled) {
		await interaction.editReply({
			content: '❌ Mode trial sedang **nonaktif**.',
		});
		return;
	}

	const accessMode = cfg.trialAccessMode || 'groupy_members';
	const requiredRoleId = cfg.trialRequiredRoleId || REQUIRED_ROLE_ID;
	let hasRequiredRole = true;
	if (accessMode === 'groupy_members') {
		hasRequiredRole = interaction.member?.roles?.cache?.has(requiredRoleId);
		if (!hasRequiredRole) {
			const role = interaction.guild?.roles?.cache?.get(requiredRoleId);
			const roleName = role ? role.name : requiredRoleId;
			await interaction.editReply({
				content: `❌ Anda memerlukan role **${roleName}** (<@&${requiredRoleId}>) untuk klaim trial.`,
			});
			return;
		}
	}

	const access = await getMemberToolAccess(interaction.member);
	if (access.hasPhantomKey) {
		await interaction.editReply({
			content:
				'❌ Anda sudah punya API **key aktif**. Trial hanya untuk member yang **belum verif AG** atau API key-nya **disabled**.',
		});
		return;
	}

	try {
		const result = await proxyInternal('/admin/internal/claim-trial', 'POST', {
			discordUserId: interaction.user.id,
			discordUsername: interaction.user.username,
			hasRequiredRole,
		});

		const models = (result.rules?.models || [])
			.slice(0, 15)
			.map((m) => `\`${m}\``)
			.join('\n');
		const rulesText =
			`**Endpoint:** \`${result.endpoint}\`\n` +
			`**Authorization:** \`Bearer ${result.apiKey}\`\n\n` +
			`**Rules Trial:**\n` +
			`• Durasi: **${result.durationDays} hari** (berakhir ${discordTime(result.expiresAt, 'F')})\n` +
			`• Token harian: **${(result.rules?.dailyTokenLimit || 0).toLocaleString()}**\n` +
			`• Prompt: **${result.rules?.promptLimit}/${result.rules?.promptLimitWindow || '5h'}**\n` +
			`• Provider: **gpy** saja\n\n` +
			`**Model tersedia:**\n${models || '_lihat /v1/models_'}`;

		await interaction.editReply({
			content: `✅ Trial berhasil diklaim! Kredensial sudah dikirim via DM.`,
		});

		// DM is sent via pending notification queue (processPendingNotifications)
		// to keep template rendering centralized. Direct sendDMToUser would
		// produce a duplicate DM ~30s later.
	} catch (err) {
		const msg = err.message || 'Unknown error';
		if (msg.includes('trial_already_used') || msg.includes('409')) {
			await interaction.editReply({
				content:
					'❌ Anda sudah pernah klaim trial. Satu akun hanya bisa trial sesuai limit yang berlaku.',
			});
		} else if (msg.includes('trial_already_active')) {
			await interaction.editReply({
				content: '❌ Anda masih punya trial aktif.',
			});
		} else if (msg.includes('phantom_member')) {
			await interaction.editReply({
				content:
					'❌ Anda sudah punya API **key aktif**. Trial hanya untuk member yang **belum verif AG** atau API key-nya **disabled**.',
			});
		} else {
			await interaction.editReply({ content: `❌ Gagal klaim trial: ${msg}` });
		}
	}
}

function buildUsageDetailEmbed(data, discordUserId, viewerUserId) {
	const {
		discordUsername,
		isActive,
		keyPrefix,
		today,
		month,
		promptLimit,
		promptLimitWindow,
		promptUsed,
		modelUsage,
		perModelPromptLimit,
		perModelPromptLimitWindow,
		dailyTokenLimit,
		monthlyTokenLimit,
		dailyTokensUsed,
		monthlyTokensUsed,
		dailyInputTokenLimit,
		dailyOutputTokenLimit,
		dailyInputUsed,
		dailyOutputUsed,
		isTrial,
		trial,
	} = data;
	const displayName = discordUsername || `User ${discordUserId}`;

	function formatResetTime(isoStr) {
		if (!isoStr) return '';
		const unix = Math.floor(new Date(isoStr).getTime() / 1000);
		return ` — Resets <t:${unix}:t> (<t:${unix}:R>)`;
	}

	const globalLimitStr =
		promptLimit > 0
			? `**${promptUsed} / ${promptLimit}** prompts (${promptLimitWindow})` +
				(promptUsed >= promptLimit ? ' 🔴' : '') +
				formatResetTime(data.promptResetAt)
			: '**Unlimited**';
	const apiCallLimitStr =
		(data.rateLimit || 0) > 0
			? `**${data.apiCallUsed || 0} / ${data.rateLimit}** API calls (${data.rateLimitWindow || '5h'})` +
				((data.apiCallUsed || 0) >= data.rateLimit ? ' 🔴' : '') +
				formatResetTime(data.apiCallResetAt)
			: '**Unlimited**';

	let modelLimitStr = '';
	if (modelUsage && modelUsage.length > 0) {
		const activeModels = modelUsage.filter((m) => m.used > 0 || m.limit > 0);
		if (activeModels.length > 0) {
			modelLimitStr = activeModels
				.map(
					(m) =>
						`- \`${m.model}\`: **${m.used} / ${m.limit > 0 ? m.limit : '∞'}**` +
						(m.limit > 0 && m.used >= m.limit ? ' 🔴' : '') +
						formatResetTime(m.resetAt),
				)
				.join('\n');
		} else {
			modelLimitStr =
				perModelPromptLimit > 0
					? `Default: **${perModelPromptLimit}** prompts (${perModelPromptLimitWindow})`
					: '**Unlimited**';
		}
	} else {
		modelLimitStr =
			perModelPromptLimit > 0
				? `Default: **${perModelPromptLimit}** prompts (${perModelPromptLimitWindow})`
				: '**Unlimited**';
	}

	const dailyTokenStr =
		dailyTokenLimit > 0
			? `**${formatTokens(dailyTokensUsed)} / ${formatTokens(dailyTokenLimit)}**` +
				(dailyTokensUsed >= dailyTokenLimit ? ' 🔴' : '') +
				formatResetTime(data.dailyResetAt)
			: `**${formatTokens(dailyTokensUsed)} / Unlimited**` +
				formatResetTime(data.dailyResetAt);
	const monthlyTokenStr =
		monthlyTokenLimit > 0
			? `**${formatTokens(monthlyTokensUsed)} / ${formatTokens(monthlyTokenLimit)}**` +
				(monthlyTokensUsed >= monthlyTokenLimit ? ' 🔴' : '') +
				formatResetTime(data.monthlyResetAt)
			: `**${formatTokens(monthlyTokensUsed)} / Unlimited**` +
				formatResetTime(data.monthlyResetAt);
	const softExceedNote = (used, softCap) => {
		if (!data.dailyTokenBreakdown?.bypassIo || !(softCap > 0)) return '';
		if (used > softCap) {
			return ` _(soft · +${formatTokens(used - softCap)} exceed until daily)_`;
		}
		return ' _(soft · exceed OK until daily)_';
	};
	const dailyInputStr =
		(dailyInputTokenLimit || 0) > 0
			? `**${formatTokens(dailyInputUsed)} / ${formatTokens(dailyInputTokenLimit)}**` +
				(data.dailyTokenBreakdown?.bypassIo
					? softExceedNote(dailyInputUsed, dailyInputTokenLimit)
					: dailyInputUsed >= dailyInputTokenLimit
						? ' 🔴'
						: '') +
				formatResetTime(data.dailyResetAt)
			: `**${formatTokens(dailyInputUsed)} / Unlimited**` +
				formatResetTime(data.dailyResetAt);
	const dailyOutputStr =
		(dailyOutputTokenLimit || 0) > 0
			? `**${formatTokens(dailyOutputUsed)} / ${formatTokens(dailyOutputTokenLimit)}**` +
				(data.dailyTokenBreakdown?.bypassIo
					? softExceedNote(dailyOutputUsed, dailyOutputTokenLimit)
					: dailyOutputUsed >= dailyOutputTokenLimit
						? ' 🔴'
						: '') +
				formatResetTime(data.dailyResetAt)
			: `**${formatTokens(dailyOutputUsed)} / Unlimited**` +
				formatResetTime(data.dailyResetAt);

	const isSelf = viewerUserId === discordUserId;
	const keyDisplay = isSelf ? data.key || `${keyPrefix}...` : '[HIDDEN]';

	let trialBlock = '';
	if (isTrial || trial?.isTrial) {
		const exp = trial?.expiresAt
			? `<t:${Math.floor(new Date(trial.expiresAt).getTime() / 1000)}:F>`
			: '—';
		trialBlock = `\n\n**🎁 Status Trial:** ${trial?.status || 'active'}\n**Berakhir:** ${exp}`;
	}

	function periodField(p) {
		const input = formatInputBreakdown(
			p.billablePromptTokens,
			p.cachedTokens,
			p.promptTokens,
		);
		const lines = [
			`📨 Prompts: **${p.requests.toLocaleString()}**`,
			`🔢 Total Tokens (limit credit): **${formatTokens(p.tokens)}**`,
			`📥 Input (limit credit): **${input.label}**`,
			`📤 Output: **${formatTokens(p.completionTokens)}**`,
			`💰 Est. Cost: **${formatCostMicro(p.estimatedCost)}**`,
		];
		if (p.peakPromptTokens > 0 && p.peakPromptTokens !== p.promptTokens) {
			lines.push(`-# Peak input (per-turn): ${formatTokens(p.peakPromptTokens)}`);
		}
		if (p.topModels && p.topModels.length > 0) {
			lines.push('\n**Top Models** _(limit credit — jumlah ≈ Total)_:');
			p.topModels.forEach((m) => {
				const req = Number(m.requests ?? m.count ?? 0);
				lines.push(
					`\`${m.model}\` (${req.toLocaleString()} prompts, ${formatTokens(m.tokens)} tok)`,
				);
			});
		}
		return lines.join('\n');
	}

	const trialUser = isTrial || trial?.isTrial;
	const bd = data.dailyTokenBreakdown;
	const stackNote =
		bd && bd.addonBonus > 0
			? (bd.inputBase || 0) > 0 || (bd.outputBase || 0) > 0
				? `\n-# Stack: in ${formatTokens(bd.inputBase || 0)} + out ${formatTokens(bd.outputBase || 0)} + pack ${formatTokens(bd.addonBonus)} = ${formatTokens(bd.effective)}`
				: `\n-# Stack: base ${formatTokens(bd.base)} + pack ${formatTokens(bd.addonBonus)} = ${formatTokens(bd.effective)}`
			: '';
	const addonBlock =
		Array.isArray(data.activeAddons) && data.activeAddons.length > 0
			? `\n\n**📦 Active add-on:** ${data.activeAddons
					.map(
						(a) =>
							`\`${a.name}\` (+${formatTokens(a.dailyTokenLimit || 0)}/day` +
							(a.expiresAt
								? `, exp <t:${Math.floor(new Date(a.expiresAt).getTime() / 1000)}:D>`
								: '') +
							')',
					)
					.join(', ')}` +
				(data.perModelPromptsBypassedByAddon
					? '\n-# Per-model prompts bypassed · Input/Output soft can exceed via add-on until Daily Total'
					: '') +
				(Array.isArray(data.addonModelTokenCaps) && data.addonModelTokenCaps.length
					? `\n-# Pack token subcaps: ${data.addonModelTokenCaps
							.map((c) => `${c.pattern}=${formatTokens(c.dailyLimit)}`)
							.join(', ')}`
					: '')
			: '';
	const limitSection = trialUser
		? `**🎁 Trial Limits** _(all models + auto)_\nPrompt: ${globalLimitStr}\nAPI calls: ${apiCallLimitStr}\n` +
			`-# ℹ️ 1 prompt = 1 turn; tiap hop = 1 API call. Input/Total & Top Models = limit credit (hop-weighted).\n\n` +
			`**🔢 Token Limits (Trial)**\nTotal Harian: ${dailyTokenStr}`
		: data.dailyTokenBreakdown?.bypassIo
			? `**🎯 Quotas**\nPrompts: ${globalLimitStr}\nAPI calls: ${apiCallLimitStr}\n` +
				`-# ℹ️ Per-model prompts bypassed · Input/Output soft; exceed via add-on until Daily Total. Input/Total & Top Models = limit credit.\n\n` +
				`**🔢 Token Limits**\nInput Harian: ${dailyInputStr}\nOutput Harian: ${dailyOutputStr}\nTotal Harian: ${dailyTokenStr}${stackNote}\nBulanan: ${monthlyTokenStr}` +
				addonBlock
			: `**🎯 Quotas**\nPrompts: ${globalLimitStr}\nAPI calls: ${apiCallLimitStr}\nPer-Model:\n${modelLimitStr}\n` +
				`-# ℹ️ 1 prompt = 1 turn; tiap hop = 1 API call. Input/Total & Top Models = limit credit (hop-weighted).\n\n` +
				`**🔢 Token Limits**\nInput Harian: ${dailyInputStr}\nOutput Harian: ${dailyOutputStr}\nTotal Harian: ${dailyTokenStr}${stackNote}\nBulanan: ${monthlyTokenStr}` +
				addonBlock;

	const tokenSaverHint =
		`\n\n💡 **Token Saver** — hemat token Cline/Roo (compress tool dump). Tekan tombol **Token Saver** di bawah, atau portal: ${PORTAL_DASHBOARD_URL}`;

	const embed = new EmbedBuilder()
		.setTitle(`📊 Usage: ${displayName}`)
		.setDescription(
			`Discord ID: \`${discordUserId}\`\nAPI Key: \`${keyDisplay}\`\nStatus: ${isActive ? '🟢 Active' : '🔴 Inactive'}${trialBlock}\n\n` +
				limitSection +
				tokenSaverHint,
		)
		.setColor(isActive ? 0x57f287 : 0xff6b6b)
		.addFields(
			{ name: '📅 Hari Ini', value: periodField(today), inline: true },
			{ name: '📆 Bulan Ini', value: periodField(month), inline: true },
		)
		.setFooter({ text: `More detail → ${PORTAL_DASHBOARD_URL}` })
		.setTimestamp();

	return embed;
}

function fmtTriState(override, globalOn) {
	if (override === true) return '🟢 ON';
	if (override === false) return '🔴 OFF';
	return globalOn ? '⚪ Default (ON)' : '⚪ Default (OFF)';
}

async function handleTokenSaverPanel(interaction) {
	await interaction.deferReply({ ephemeral: true });
	const discordUserId = interaction.user.id;
	let data;
	try {
		data = await proxyInternal(`/admin/internal/token-saver/${discordUserId}`);
	} catch (err) {
		await interaction.editReply({
			content: `❌ Gagal load Token Saver: ${err.message || err}`,
		});
		return;
	}

	const g = data.global || {};
	const o = data.overrides || {};
	const embed = new EmbedBuilder()
		.setTitle('💾 Token Saver')
		.setDescription(
			'Pipeline: **RTK → Headroom → Caveman → Ponytail** (sebelum upstream).\n\n' +
				'• **RTK** — potong tool dump besar (git/grep/read). Hemat input. Default ON.\n' +
				'• **Headroom** — compress eksternal (butuh URL admin). Default OFF.\n' +
				'• **Caveman** — jawaban lebih singkat (system prompt). Bisa ubah gaya. Default OFF.\n' +
				'• **Ponytail** — skip basa-basi agent IDE. Default OFF.\n\n' +
				'Tri-state: **Default** (ikut admin) / **ON** / **OFF**.\n' +
				`Portal: ${PORTAL_DASHBOARD_URL}/settings`,
		)
		.addFields(
			{ name: 'RTK', value: fmtTriState(o.rtk, !!g.rtk), inline: true },
			{ name: 'Headroom', value: fmtTriState(o.headroom, !!g.headroom), inline: true },
			{ name: 'Caveman', value: fmtTriState(o.caveman, !!g.caveman), inline: true },
			{ name: 'Ponytail', value: fmtTriState(o.ponytail, !!g.ponytail), inline: true },
		)
		.setColor(0x5865f2)
		.setTimestamp();

	const mkSelect = (feature, label) =>
		new ActionRowBuilder().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(`ts_set:${feature}`)
				.setPlaceholder(`${label}: pilih Default / ON / OFF`)
				.addOptions(
					{ label: `${label}: Default`, value: 'default', description: 'Ikuti setting global admin' },
					{ label: `${label}: ON`, value: 'on' },
					{ label: `${label}: OFF`, value: 'off' },
				),
		);

	await interaction.editReply({
		embeds: [embed],
		components: [
			mkSelect('rtk', 'RTK'),
			mkSelect('headroom', 'Headroom'),
			mkSelect('caveman', 'Caveman'),
			mkSelect('ponytail', 'Ponytail'),
		],
	});
}

async function handleTokenSaverSelect(interaction) {
	await interaction.deferUpdate();
	const feature = interaction.customId.replace(/^ts_set:/, '');
	const raw = interaction.values?.[0] || 'default';
	const value = raw === 'on' ? true : raw === 'off' ? false : null;
	const discordUserId = interaction.user.id;

	if (!['rtk', 'headroom', 'caveman', 'ponytail'].includes(feature)) {
		await interaction.followUp({ content: '❌ Fitur tidak dikenal.', ephemeral: true });
		return;
	}

	try {
		await proxyInternal(`/admin/internal/token-saver/${discordUserId}`, 'PUT', {
			[feature]: value,
		});
		const data = await proxyInternal(`/admin/internal/token-saver/${discordUserId}`);
		const g = data.global || {};
		const o = data.overrides || {};
		const embed = new EmbedBuilder()
			.setTitle('💾 Token Saver')
			.setDescription(`Updated **${feature}** → ${fmtTriState(value, !!g[feature])}`)
			.addFields(
				{ name: 'RTK', value: fmtTriState(o.rtk, !!g.rtk), inline: true },
				{ name: 'Headroom', value: fmtTriState(o.headroom, !!g.headroom), inline: true },
				{ name: 'Caveman', value: fmtTriState(o.caveman, !!g.caveman), inline: true },
				{ name: 'Ponytail', value: fmtTriState(o.ponytail, !!g.ponytail), inline: true },
			)
			.setColor(0x57f287)
			.setTimestamp();

		const mkSelect = (feat, label) =>
			new ActionRowBuilder().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(`ts_set:${feat}`)
					.setPlaceholder(`${label}: pilih Default / ON / OFF`)
					.addOptions(
						{ label: `${label}: Default`, value: 'default' },
						{ label: `${label}: ON`, value: 'on' },
						{ label: `${label}: OFF`, value: 'off' },
					),
			);

		await interaction.editReply({
			embeds: [embed],
			components: [
				mkSelect('rtk', 'RTK'),
				mkSelect('headroom', 'Headroom'),
				mkSelect('caveman', 'Caveman'),
				mkSelect('ponytail', 'Ponytail'),
			],
		});
	} catch (err) {
		await interaction.followUp({
			content: `❌ Gagal simpan: ${err.message || err}`,
			ephemeral: true,
		});
	}
}

async function canTrialUserViewTarget(callerId, targetId, targetData, guild) {
	let callerTrial = false;
	try {
		const callerKey = await proxyInternal(
			`/admin/internal/user-key-type/${callerId}`,
		);
		callerTrial = callerKey?.isTrial === true;
	} catch {}

	if (!callerTrial) return { ok: true };

	if (targetData?.isTrial || targetData?.trial?.isTrial) return { ok: true };

	return {
		ok: false,
		message:
			'❌ Sebagai user trial, Anda hanya bisa melihat usage user trial lain.',
	};
}

async function handleShowMyUsage(interaction) {
	await interaction.deferReply({ ephemeral: true });
	const discordUserId = interaction.user.id;

	let data;
	try {
		data = await proxyInternal(
			`/admin/internal/stats/user-detail/${discordUserId}`,
		);
	} catch (err) {
		const msg = err.message || '';
		if (msg.includes('404') || msg.includes('not found')) {
			await interaction.editReply({
				content: `❌ Anda belum memiliki API key.\n\n• Klaim **trial** lewat embed trial di channel ini, atau\n• Verifikasi member di <#${AGVERIF_CHANNEL_ID}>.`,
			});
			return;
		}
		await interaction.editReply({ content: `❌ Gagal mengambil data: ${msg}` });
		return;
	}

	if (!data.isActive) {
		await interaction.editReply({
			content:
				'❌ API key Anda **nonaktif/disabled**. Hubungi admin jika ini tidak seharusnya.',
		});
		return;
	}

	const embed = buildUsageDetailEmbed(data, discordUserId, discordUserId);
	await interaction.editReply({
		embeds: [embed],
		components: [buildUsageDetailRow(true)],
	});
}

// ─── Handle Search User Interaction ───────────────────────────────────────────
async function handleRankingSearchButton(interaction) {
	await handleShowMyUsage(interaction);
}

async function handleRankingSearchOtherButton(interaction) {
	const access = await getMemberToolAccess(interaction.member);
	if (!access.canUseTools) {
		await interaction.reply({
			content: toolAccessDeniedMessage(access),
			ephemeral: true,
		});
		return;
	}
	const modal = new ModalBuilder()
		.setCustomId('ranking_search_user_other_modal')
		.setTitle('👥 Cari Usage User Lain');

	const input = new TextInputBuilder()
		.setCustomId('discord_user_id')
		.setLabel('Discord User ID')
		.setPlaceholder('Contoh: 123456789012345678')
		.setStyle(TextInputStyle.Short)
		.setRequired(true)
		.setMinLength(5)
		.setMaxLength(25);

	modal.addComponents(new ActionRowBuilder().addComponents(input));
	await interaction.showModal(modal);
}

async function handleRankingSearchModal(interaction) {
	const discordUserId = interaction.fields
		.getTextInputValue('discord_user_id')
		.trim();
	await interaction.deferReply({ ephemeral: true });

	let data;
	try {
		data = await proxyInternal(
			`/admin/internal/stats/user-detail/${discordUserId}`,
		);
	} catch (err) {
		const msg = err.message || 'Unknown error';
		if (msg.includes('User not found') || msg.includes('404')) {
			await interaction.editReply({
				content: `❌ User \`${discordUserId}\` tidak ditemukan atau belum punya API key.`,
			});
		} else {
			await interaction.editReply({
				content: `❌ Gagal mengambil data: ${msg}`,
			});
		}
		return;
	}

	const access = await canTrialUserViewTarget(
		interaction.user.id,
		discordUserId,
		data,
		interaction.guild,
	);
	if (!access.ok) {
		await interaction.editReply({ content: access.message });
		return;
	}

	const embed = buildUsageDetailEmbed(data, discordUserId, interaction.user.id);
	await interaction.editReply({
		embeds: [embed],
		components: [buildUsageDetailRow(false)],
	});
}

client.once('clientReady', async () => {
	console.log(`Logged in as ${client.user.tag}`);
	await loadDynamicSettings();
	console.log(
		`[agverif] Auto check AI: ${VERIF_AUTO_ENABLED ? 'AKTIF' : 'NONAKTIF'}`,
	);

	await loadThreadsData();
	await loadVerifiedUsersData();
	await loadSetupState();
	await loadRankingState();

	for (const [threadId, threadData] of Object.entries(
		client.agverifData.threads,
	)) {
		try {
			// Pastikan autoArchiveDuration sesuai status verifikasi
			try {
				const threadForArchive = await client.channels.fetch(threadId);
				if (threadForArchive && threadForArchive.isThread()) {
					// Jika sudah terverifikasi, gunakan 1 jam, jika belum 3 hari
					const targetDuration =
						threadData.hasRole || threadData.verifiedAt ? 60 : 4320;
					if (threadForArchive.autoArchiveDuration !== targetDuration) {
						try {
							await threadForArchive.setAutoArchiveDuration(targetDuration);
						} catch (err) {
							console.error(
								`Failed to set autoArchiveDuration for thread ${threadId}:`,
								err,
							);
						}
					}
				}
			} catch (err) {
				console.error(
					`Failed to fetch thread ${threadId} for archive duration restore:`,
					err,
				);
			}

			if (!threadData.hasPhoto) {
				const elapsed = Date.now() - threadData.createdAt;
				const remaining = NO_PHOTO_TIMEOUT_MS - elapsed;
				if (remaining > 0) {
					const timeout = setTimeout(async () => {
						await setupNoPhotoTimeout(threadId);
					}, remaining);
					client.agverifData.threads[threadId].deleteTimeout = timeout;
				} else {
					try {
						const thread = await client.channels.fetch(threadId);
						if (thread && thread.isThread()) {
							await thread.delete('Timeout expired - no photo uploaded');
						}
					} catch (err) {
						console.error('Failed to delete expired thread:', err);
					}
					await removeThreadFromData(threadId);
				}
			}

			if (threadData.hasPhoto && !threadData.photoDeletedAfterRole) {
				const timeout = setupInactiveTimeout(threadId);
				client.agverifData.threads[threadId].inactiveTimeout = timeout;
			}

			if (threadData.photoDeletedAfterRole && !threadData.hasPhoto) {
				const elapsed = Date.now() - (threadData.photoDeletedAt || 0);
				const remaining = PHOTO_DELETE_GRACE_MS - elapsed;
				if (remaining > 0) {
					const timeout = setTimeout(async () => {
						try {
							const thread = await client.channels.fetch(threadId);
							if (
								thread &&
								thread.isThread() &&
								!client.agverifData.threads[threadId]?.hasPhoto
							) {
								await thread.delete('Foto tidak diupload ulang dalam 3 hari');
								await removeThreadFromData(threadId);
							}
						} catch (err) {
							console.error('Failed to delete thread:', err);
						}
					}, remaining);
					client.agverifData.threads[threadId].photoDeleteTimeout = timeout;
				}
			}
		} catch (err) {
			console.error(`Failed to restore timeout for thread ${threadId}:`, err);
		}
	}

	await ensureRankingMessages();
	await refreshTrialPanelIfNeeded().catch((e) =>
		console.error('[trial] panel error:', e.message),
	);
	await setupVerificationButton();
	startPhotoCheckInterval();
	startRoleSyncInterval();

	// Monthly Recap: panel + daily regeneration/debug job
	await loadRecapState();
	await ensureRecapMessage().catch((err) =>
		console.error('[recap] ensure panel error:', err.message),
	);
	await ensureRecapDebugMessage().catch((err) =>
		console.error('[recap] ensure debug panel error:', err.message),
	);
	// Recap generation ONLY runs when the access window is OPEN. Outside the
	// window, users can still click the button to view the recap, and admins
	// can trigger an on-demand regenerate from the dashboard. We skip the
	// cron entirely so we don't burn AI tokens on auto.
	async function maybeRunDailyRecap() {
		try {
			const win = await proxyInternal('/admin/internal/recap/window');
			if (!win || !win.isOpen) {
				console.log('[recap] window CLOSED — skipping daily job (on-demand only)');
				return;
			}
			const today = wibTodayStr();
			if (recapState.lastDailyRecapDate === today) {
				console.log(`[recap] already ran for ${today} — skipping (1x/day guard)`);
				return;
			}
			console.log(`[recap] window OPEN — running daily job for ${today}`);
			await runDailyRecapJob();
			recapState.lastDailyRecapDate = today;
			await saveRecapState().catch(() => {});
		} catch (err) {
			console.error('[recap] window check failed:', err.message);
		}
	}
	setTimeout(() => {
		maybeRunDailyRecap().catch((err) =>
			console.error('[recap] daily job error:', err.message),
		);
	}, 15000);
	setInterval(() => {
		maybeRunDailyRecap().catch((err) =>
			console.error('[recap] daily job error:', err.message),
		);
	}, RECAP_DEBUG_INTERVAL_MS);

	// Hourly: re-ensure the agverif panel so it appears/disappears promptly
	// when the visibility window (25th-5th) opens or closes, AND check
	// whether the recap window has just opened (H-2) so we can pre-warm
	// every active user's recap in the background.
	setInterval(
		() => {
			ensureRecapMessage().catch((err) =>
				console.error('[recap] hourly panel refresh error:', err.message),
			);
			maybeFirePregen().catch((err) =>
				console.error('[recap] pregen check error:', err.message),
			);
		},
		60 * 60 * 1000,
	);
	// Also kick a pregen check ~30s after startup so a bot that just restarted
	// on/after H-2 doesn't have to wait an hour to discover the open window.
	setTimeout(() => {
		maybeFirePregen().catch(() => {});
	}, 30_000);

	// Start 1-minute ranking refresh
	setInterval(() => {
		refreshRankingEmbeds().catch((err) =>
			console.error('[ranking] Refresh error:', err.message),
		);
	}, RANKING_REFRESH_INTERVAL_MS);

	setInterval(() => {
		refreshTrialPanelIfNeeded().catch((err) =>
			console.error('[trial] panel refresh error:', err.message),
		);
	}, 30 * 1000);

	if (TOKITO_API_KEY) {
		if (runtime.monitorTimersStarted) {
			console.log('[tokito] Monitor timers already started — skipping re-init');
		} else {
		runtime.monitorTimersStarted = true;
		console.log(
			`[tokito] Monitor active. Panel Channel ID: ${TOKITO_CHANNEL_ID}`,
		);
		await ensurePanelMessage();
		await pollModelStatus();
		await recoverRetryState();
		// Clear stale soft-suspends so the first sweep after deploy re-probes everything
		runtime.modelRetryState.clear();
		try {
			await proxyInternal('/admin/internal/monitor/models/state/reset', 'PATCH');
		} catch (_) {}
		const bootMode = await fetchMonitorAutoMode();
		console.log(`[tokito-monitor] monitorAutoMode=${bootMode}`);
		if (bootMode !== 'off') {
			await runFullSweep({ ignoreSuspend: true });
		} else {
			console.log(
				'[tokito-monitor] startup full sweep skipped (monitorAutoMode=off)',
			);
		}

		// Gpy/webnet: every 10 minutes, ignore 24h suspend — trial-critical models
		// must be re-tested even if they have been failing for a long time.
		setInterval(() => {
			runSweepForProviderPrefix(GPY_WEBNET_MATCHER, 'gpy 10min sweep', { ignoreSuspend: true })
				.catch((err) => console.error('gpy 10min sweep error:', err.message));
		}, 600000);

		// Startup: kick an immediate gpy sweep at +15s for fresh data
		setTimeout(() => {
			runSweepForProviderPrefix(GPY_WEBNET_MATCHER, 'gpy startup sweep', { ignoreSuspend: true })
				.catch((err) => console.error('gpy startup sweep error:', err.message));
		}, 15000);

		// Full sweep: every 10 minutes — ALWAYS re-test all models (ignore soft-suspend).
		// Soft-suspend only reduces the *retry* sweep noise; dashboard freshness requires
		// probing every model on this cadence. Mode=off skips inside runFullSweep.
		setInterval(() => {
			runFullSweep({ ignoreSuspend: true }).catch((err) =>
				console.error('runFullSweep error:', err.message),
			);
		}, 600000);

		// Retry sweep: every 10 minutes (test only offline models not yet soft-suspended)
		setInterval(() => {
			runRetrySweep().catch((err) =>
				console.error('runRetrySweep error:', err.message),
			);
		}, 600000);

		// Midnight reset: reset retry counts at 00:00 Asia/Jakarta
		scheduleMidnightReset();

		// Daily inactive-member cleanup (00:00 WIB)
		scheduleDailyInactiveMemberCleanup();
		}
	}

	console.log('Antigravity Verification Bot is ready!');

	// ─── Poll pending device-violation notifications ─────────────────────────
	// When a new device connects to a Discord key that is limited to 1 device,
	// the proxy rotates the key and stores a pending notification here.
	// We pick it up every 30s and send DM + thread reply to the user.
	async function processPendingNotifications() {
		try {
			const data = await proxyInternal('/admin/internal/pending-notifications');
			const notifications = data?.notifications || [];
			for (const notif of notifications) {
				if (!notif.discordUserId) continue;
				try {
					if (notif.type?.startsWith('trial_')) {
						let dmText = '';
						let title = 'Trial Notification';
						let color = 0xf59e0b;
						if (notif.type === 'trial_claimed') {
							title = '🎁 Trial API Aktif';
							color = 0x57f287;
							const modelBlock = (notif.modelList || '').toString().trim();
							const modelSection =
								modelBlock && !/lihat \/v1\/models/.test(modelBlock)
									? `**Model tersedia:**\n${modelBlock}\n\n`
									: '';
							dmText =
								notif.dmTemplate?.replace(
									/\{(\w+)\}/g,
									(_, k) => notif[k] || '',
								) ||
								`🎁 **Trial API Aktif**\n\n` +
									`**Endpoint:** \`${notif.endpoint || ''}\`\n` +
									`**Authorization:** \`Bearer ${notif.apiKey || ''}\`\n\n` +
									`**Rules:**\n` +
									`• Durasi: ${notif.durationDays || '?'} hari (berakhir ${discordTime(notif.expiresAt, 'F')})\n` +
									`• Token harian: ${(Number(notif.dailyTokenLimit) || 0).toLocaleString()}\n` +
									`• Prompt: ${notif.promptLimit || '?'}/${notif.promptWindow || '5h'}\n` +
									`• Model: hanya **gpy**\n\n` +
									modelSection +
									`Kredensial juga sudah dikirim ke channel trial.`;
						} else if (notif.type === 'trial_key_rotated') {
							title = '🔄 Trial Key Di-rotate';
							if (notif.dmTemplate) {
								dmText = notif.dmTemplate.replace(
									/\{(\w+)\}/g,
									(_, k) => notif[k] || '',
								);
							} else {
								dmText = `⚠️ Key trial di-rotate karena device baru terdeteksi.\n\n**Endpoint:** \`${notif.endpoint || ''}\`\n**Key baru:** \`${notif.newKey || ''}\``;
							}
						} else if (notif.type === 'trial_limit_reached') {
							title = '⚠️ Limit Trial Tercapai';
							dmText =
								notif.message ||
								'Limit harian/bulanan trial Anda sudah tercapai.';
							if (notif.upgradePhantom) dmText += `\n\n${notif.upgradePhantom}`;
						} else if (notif.type === 'trial_expired') {
							title = '⏰ Trial Berakhir';
							dmText = notif.prebuiltText || 'Masa trial API Anda sudah habis.';
						} else if (notif.type === 'trial_terminated') {
							title = '🚫 Trial Dihentikan';
							dmText = `Trial dihentikan. ${notif.reason ? `Alasan: ${notif.reason}` : ''}`;
							if (notif.upgradePhantom) dmText += `\n\n${notif.upgradePhantom}`;
						} else if (notif.type === 'trial_reclaim_available') {
							title = '🎁 Trial Baru Tersedia';
							color = 0x57f287;
							dmText = notif.dmTemplate
								? notif.dmTemplate.replace(
										/\{(\w+)\}/g,
										(_, k) => notif[k] || '',
									)
								: `Admin sudah membuka akses trial lagi. Klaim di <#${notif.channelId || ''}>.`;
						} else if (notif.type === 'trial_upgrade_phantom') {
							title = '🚀 Upgrade ke Phantom Member';
							color = 0x5865f2;
							dmText =
								notif.upgradePhantom ||
								notif.dmTemplate ||
								'Untuk akses unlimited, verifikasi AG.';
						} else if (notif.type === 'trial_extended') {
							title = '⏰ Trial Diperpanjang';
							color = 0x57f287;
							dmText = notif.dmTemplate
								? notif.dmTemplate.replace(
										/\{(\w+)\}/g,
										(_, k) => notif[k] || '',
									)
								: `Admin sudah memperpanjang trial +${notif.days} hari. Baru berakhir: ${discordTime(notif.expiresAt, 'F')}`;
						} else if (notif.type === 'portal_key_rotated') {
							// Portal user self-served key rotation via /portal/api
							title = '🔑 API Key Diperbarui';
							color = 0xf59e0b;
							dmText =
								`⚠️ **API key Anda telah diperbarui melalui User Portal.**\n\n` +
								`Jika ini bukan Anda, hubungi admin segera.\n\n` +
								`**Key baru:** \`${notif.newKey || ''}\`\n` +
								`**Nama key:** ${notif.keyName || 'N/A'}\n` +
								`**Endpoint:** \`${notif.endpoint || ''}\`\n\n` +
								`Pastikan perbarui API key di aplikasi/IDE Anda.`;
						}
						if (dmText)
							await sendDMToUser(notif.discordUserId, title, dmText, color);
						// Kirim How to Use terpisah khusus trial_claimed
						if (notif.type === 'trial_claimed') {
							try {
								const models = (notif.modelList || '')
									.split('\n')
									.map((l) =>
										l
											.replace(/^•\s*`/, '')
											.replace(/`\s*$/, '')
											.trim(),
									)
									.filter(Boolean);
								await sendHowToDm(notif.discordUserId, 'trial', {
									endpoint: notif.endpoint,
									apiKey: notif.apiKey,
									models,
								});
							} catch (howtoErr) {
								console.error('[trial] sendHowToDm failed:', howtoErr.message);
							}
						}
						if (notif.keyId) {
							await proxyInternal(
								`/admin/internal/clear-notification/${notif.keyId}`,
								'POST',
							);
						}
						continue;
					}

					if (!notif.newKey) continue;
					if (notif.type === 'admin_bulk_rotate') {
						const dmText =
							`🔄 **API Key Di-rotate (Admin)**\n\n` +
							`Semua API key telah di-rotate untuk keamanan. Gunakan kredensial baru di bawah:\n\n` +
							`**Endpoint:** \`${notif.endpoint}\`\n` +
							`**Authorization:** \`Bearer ${notif.newKey}\`\n\n` +
							`Key lama sudah tidak valid. Update IDE/client Anda segera.\n` +
							`Device lama juga sudah di-reset (max 1 device per key).`;

						await sendDMToUser(
							notif.discordUserId,
							'🔑 API Key Baru — Rotasi Massal',
							dmText,
							0x5865f2,
						);

						const threadId =
							client.agverifData?.verifiedUsers?.[notif.discordUserId]
								?.threadId ||
							Object.entries(client.agverifData?.threads || {}).find(
								([, data]) => data.userId === notif.discordUserId,
							)?.[0];

						if (threadId) {
							try {
								const thread = await client.channels.fetch(threadId);
								if (thread && thread.send) {
									const { EmbedBuilder } = await import('discord.js');
									const embed = new EmbedBuilder()
										.setTitle('🔄 API Key Di-rotate — Kredensial Baru')
										.setDescription(
											`Admin telah melakukan rotasi massal API key.\n\n` +
												`**Endpoint:** \`${notif.endpoint}\`\n` +
												`**Authorization:** \`Bearer ${notif.newKey}\`\n\n` +
												`Key lama sudah tidak berlaku. Update IDE/client Anda.`,
										)
										.setColor(0x5865f2)
										.setTimestamp();
									await thread.send({ embeds: [embed] });
								}
							} catch (err) {
								console.error(
									`[notify] Failed to send bulk rotate thread for ${notif.discordUserId}:`,
									err.message,
								);
							}
						}
					} else {
						const dmText =
							`⚠️ **New Device Detected — API Key Rotated**\n\n` +
							`A new device attempted to connect to your API key, but only **1 device** is allowed.\n\n` +
							`Your key has been **automatically rotated**. Here are your new credentials:\n\n` +
							`**Endpoint:** \`${notif.endpoint}\`\n` +
							`**Authorization:** \`Bearer ${notif.newKey}\`\n\n` +
							`Your old device has been removed. Configure your IDE with the new key above.\n\n` +
							`If you need more than 1 device, please contact an admin.`;

						await sendDMToUser(
							notif.discordUserId,
							'🔑 API Key Rotated — New Device Detected',
							dmText,
							0xf59e0b,
						);

						const threadId =
							client.agverifData?.verifiedUsers?.[notif.discordUserId]
								?.threadId;
						if (threadId) {
							try {
								const thread = await client.channels.fetch(threadId);
								if (thread && thread.send) {
									const { EmbedBuilder } = await import('discord.js');
									const embed = new EmbedBuilder()
										.setTitle('⚠️ New Device Detected — Key Rotated')
										.setDescription(
											`A new device connected to your key and exceeded your maximum device limit.\n\n` +
												`Your API key has been **rotated automatically**. Check your DMs for the new key.\n\n` +
												`If this wasn't you, contact an admin immediately.`,
										)
										.setColor(0xf59e0b)
										.setTimestamp();
									await thread.send({ embeds: [embed] });
								}
							} catch (err) {
								console.error(
									`[notify] Failed to send thread message for ${notif.discordUserId}:`,
									err.message,
								);
							}
						}
					}

					await proxyInternal(
						`/admin/internal/clear-notification/${notif.keyId}`,
						'POST',
					);
				} catch (err) {
					console.error(
						`[notify] Failed to process notification for ${notif.discordUserId}:`,
						err.message,
					);
				}
			}
		} catch (err) {
			console.error(
				'[notify] Failed to poll pending notifications:',
				err.message,
			);
		}
	}

	// Run immediately then every 30 seconds
	void processPendingNotifications();
	setInterval(() => {
		processPendingNotifications().catch((err) =>
			console.error('[notify] Poll error:', err.message),
		);
	}, 30000);
});

client.on('interactionCreate', async (interaction) => {
	try {
		// ─── Ranking Search Button ───────────────────────────────────────────
		if (
			interaction.isButton() &&
			interaction.customId === 'ranking_search_user'
		) {
			await handleRankingSearchButton(interaction);
			return;
		}

		if (
			interaction.isButton() &&
			interaction.customId === 'ranking_search_user_other'
		) {
			await handleRankingSearchOtherButton(interaction);
			return;
		}

		// ─── Trial Claim Button ────────────────────────────────────────────────
		if (interaction.isButton() && interaction.customId === TRIAL_CLAIM_BUTTON) {
			await handleTrialClaimButton(interaction);
			return;
		}

		// ─── How-to-Use: open picker ────────────────────────────────────────────
		if (
			interaction.isButton() &&
			interaction.customId.startsWith(TUTORIAL_BTN_HOWTO_PREFIX + ':')
		) {
			const parts = interaction.customId.split(':');
			const targetUserId = parts[1];
			const kind = parts[2];
			if (interaction.user.id !== targetUserId) {
				try {
					await interaction.reply({
						content: '❌ Tombol ini bukan untukmu.',
						ephemeral: true,
					});
				} catch {}
				return;
			}
			const kindLabel = kind === 'trial' ? 'Trial' : 'Phantom';
			// Defer the click immediately so the interaction token stays valid
			// while we render the picker (and so we can still send an error
			// followUp if something throws).
			try {
				if (!interaction.deferred && !interaction.replied) {
					await interaction.deferReply({ ephemeral: true });
				}
			} catch {}
			try {
				await interaction.followUp({
					embeds: [
						new EmbedBuilder()
							.setTitle('📘 Pilih IDE')
							.setDescription(
								`Pilih IDE untuk lihat tutorial setup **${kindLabel} API key** di bawah ini.`,
							)
							.setColor(0x5865f2),
					],
					components: buildHowToPicker(targetUserId, kindLabel),
					ephemeral: true,
				});
			} catch (err) {
				console.error('[howto] picker error:', err.message || err);
				try {
					await interaction.followUp({
						content: `❌ Gagal tampilkan picker: ${err.message || 'unknown'}. Silakan coba lagi dari DM.`,
						ephemeral: true,
					});
				} catch {}
			}
			return;
		}

		// ─── How-to-Use: IDE selected, render tutorial ──────────────────────────
		if (
			interaction.isStringSelectMenu() &&
			interaction.customId.startsWith(TUTORIAL_MENU_IDE_PREFIX)
		) {
			const ide = interaction.values[0];
			const targetUserId = interaction.customId.slice(
				TUTORIAL_MENU_IDE_PREFIX.length,
			);
			if (interaction.user.id !== targetUserId) {
				try {
					await interaction.reply({
						content: '❌ Menu ini bukan untukmu.',
						ephemeral: true,
					});
				} catch {}
				return;
			}
			// Defer the update first to avoid the 3s timeout while we fetch context.
			try {
				if (!interaction.deferred && !interaction.replied) {
					await interaction.deferUpdate();
				}
			} catch (err) {
				console.error('[howto] deferUpdate failed:', err.message || err);
			}
			try {
				const kind = await lookupKindForUser(targetUserId);
				const ctx = await getTutorialContextForUser(targetUserId, kind);
				const embeds = buildTutorialEmbeds(ide, kind, ctx);
				if (!embeds.length) {
					throw new Error('No tutorial content generated');
				}
				const components = [];
				if (embeds.length > 1) {
					components.push(
						new ActionRowBuilder().addComponents(
							new ButtonBuilder()
								.setCustomId(
									`${TUTORIAL_PAGE_PREFIX}${targetUserId}:${ide}:prev`,
								)
								.setLabel('◀ Prev')
								.setStyle(ButtonStyle.Secondary),
							new ButtonBuilder()
								.setCustomId(
									`${TUTORIAL_PAGE_PREFIX}${targetUserId}:${ide}:next`,
								)
								.setLabel('Next ▶')
								.setStyle(ButtonStyle.Secondary),
						),
					);
				}
				if (!client.tutorialPages) client.tutorialPages = new Map();
				client.tutorialPages.set(`${targetUserId}:${ide}`, { embeds, page: 0 });
				await interaction.editReply({ embeds: [embeds[0].embed], components });
			} catch (err) {
				console.error('[howto] render error:', err.message || err);
				try {
					await interaction.editReply({
						content: `❌ Gagal render tutorial: ${err.message || 'unknown'}. Coba lagi dari DM (klik tombol "How to Use" lagi).`,
						embeds: [],
						components: [],
					});
				} catch (err2) {
					console.error(
						'[howto] editReply fallback failed:',
						err2.message || err2,
					);
					try {
						await interaction.followUp({
							content: `❌ Gagal render tutorial: ${err.message || 'unknown'}. Silakan coba lagi.`,
							ephemeral: true,
						});
					} catch {}
				}
			}
			return;
		}

		// ─── How-to-Use: pagination ─────────────────────────────────────────────
		if (
			interaction.isButton() &&
			interaction.customId.startsWith(TUTORIAL_PAGE_PREFIX)
		) {
			const rest = interaction.customId.slice(TUTORIAL_PAGE_PREFIX.length);
			const [targetUserId, ide, dir] = rest.split(':');
			if (interaction.user.id !== targetUserId) {
				await interaction.reply({
					content: '❌ Tombol ini bukan untukmu.',
					ephemeral: true,
				});
				return;
			}
			const state = client.tutorialPages?.get(`${targetUserId}:${ide}`);
			if (!state) {
				try {
					await interaction.update({
						content:
							'Sesi tutorial kadaluarsa. Silakan buka ulang dari DM (klik tombol "How to Use" lagi).',
						embeds: [],
						components: [],
					});
				} catch {
					await interaction.followUp({
						content: 'Sesi tutorial kadaluarsa. Silakan buka ulang dari DM.',
						ephemeral: true,
					});
				}
				return;
			}
			state.page =
				dir === 'next'
					? Math.min(state.page + 1, state.embeds.length - 1)
					: Math.max(state.page - 1, 0);
			try {
				await interaction.update({ embeds: [state.embeds[state.page].embed] });
			} catch (err) {
				console.error('[howto] pagination error:', err);
			}
			return;
		}

		// ─── Ranking Search Modal Submit ─────────────────────────────────────
		if (
			interaction.isModalSubmit() &&
			interaction.customId === 'ranking_search_user_other_modal'
		) {
			await handleRankingSearchModal(interaction);
			return;
		}

		if (
			interaction.isModalSubmit() &&
			interaction.customId === 'ranking_search_user_modal'
		) {
			await handleRankingSearchModal(interaction);
			return;
		}

		// ─── Ranking See Model Limit Button ──────────────────────────────────
		if (
			interaction.isButton() &&
			(interaction.customId === 'ranking_see_model_limits' ||
				interaction.customId.startsWith('ranking_see_model_limits:'))
		) {
			await handleRankingSeeModelLimits(interaction);
			return;
		}

		// ─── Add-on Config ───────────────────────────────────────────────────
		if (interaction.isButton() && interaction.customId === 'ranking_see_addons') {
			await handleRankingSeeAddons(interaction);
			return;
		}
		if (
			interaction.isStringSelectMenu() &&
			interaction.customId === 'ranking_addon_pick'
		) {
			await handleRankingAddonPick(interaction);
			return;
		}

		// ─── Token Saver panel (from Usage detail) ───────────────────────────
		if (interaction.isButton() && interaction.customId === 'ranking_token_saver') {
			await handleTokenSaverPanel(interaction);
			return;
		}
		if (
			interaction.isStringSelectMenu() &&
			interaction.customId.startsWith('ts_set:')
		) {
			await handleTokenSaverSelect(interaction);
			return;
		}

		// ─── Ranking Model Limit Filter Select ──────────────────────────────
		if (
			interaction.isStringSelectMenu() &&
			interaction.customId === 'ranking_model_limit_filter'
		) {
			await handleRankingModelLimitFilter(interaction);
			return;
		}

		// ─── Monthly Recap Button ────────────────────────────────────────────
		if (interaction.isButton() && interaction.customId === 'monthly_recap') {
			await handleMonthlyRecap(interaction);
			return;
		}

		// ─── Recap Debug Panel (debug channel) ───────────────────────────────
		if (interaction.isButton() && interaction.customId === 'recap_debug_self') {
			await handleRecapDebugSelf(interaction);
			return;
		}
		if (
			interaction.isButton() &&
			interaction.customId === 'recap_debug_other'
		) {
			await handleRecapDebugOtherButton(interaction);
			return;
		}
		if (
			interaction.isModalSubmit() &&
			interaction.customId === 'recap_debug_other_modal'
		) {
			await handleRecapDebugOtherModal(interaction);
			return;
		}

		// ─── Testimonial viewer (agverif: role-gated, debug: open) ───────────
		if (interaction.isButton() && interaction.customId === 'recap_testi_view') {
			await handleTestimonialViewer(interaction);
			return;
		}
		if (
			interaction.isButton() &&
			interaction.customId === 'recap_testi_view_debug'
		) {
			await handleTestimonialViewer(interaction);
			return;
		}

		if (interaction.isButton()) {
			if (interaction.customId === 'create_agverif_ticket') {
				const member = interaction.member;
				const userId = interaction.user.id;

				// ─── AGVERIF_ENABLED = false: Auto-claim flow ───
				if (!AGVERIF_ENABLED) {
					// Check Phantom role requirement
					if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ Akses Ditolak')
							.setDescription(
								'Anda memerlukan role **The Phantom** untuk claim API key.\n\n' +
									'Jika anda sudah memiliki paket Phantom, silakan hubungi admin.',
							)
							.setColor(0xff6b6b);

						await interaction.reply({
							embeds: [errorEmbed],
							ephemeral: true,
						});
						return;
					}

					// Check if user already has Phantom API key
					let existingKey = null;
					try {
						existingKey = await proxyInternal(`/admin/internal/user-key-type/${userId}`);
					} catch (err) {
						console.error('[auto-claim] Failed to check existing key:', err);
					}

					// If user has phantom key, resend it. Trial key doesn't count for phantom claim.
					if (existingKey?.hasPhantomKey) {
						// User already has Phantom key - get the key and re-send DM
						try {
							const keyInfo = await proxyInternal(`/admin/internal/key-for-user/${userId}`);
							if (keyInfo && keyInfo.apiKey) {
								const endpoint = keyInfo.endpoint || PROXY_PUBLIC_BASE_URL + '/v1';

								// Send credentials DM
								await sendApiCredentialsDm(userId, keyInfo.apiKey, endpoint);

								// Send How to Use guide (always phantom for this button)
								try {
									const data = await proxyInternal('/admin/internal/models/details');
									const models = (data?.data || [])
										.map((m) => m.id)
										.filter((id) => id && id !== 'auto');
									await sendHowToDm(userId, 'phantom', {
										endpoint,
										apiKey: keyInfo.apiKey,
										models,
									});
								} catch (howtoErr) {
									console.error('[auto-claim] sendHowToDm failed:', howtoErr.message);
								}

								const infoEmbed = new EmbedBuilder()
									.setTitle('✅ API Key Dikirim Ulang')
									.setDescription(
										'API key Phantom anda sudah dikirim ulang via DM.\n\n' +
											'Jika tidak menerima DM, silakan cek:\n' +
											'• Allow DM dari server ini\n' +
											'• Hubungi admin\n\n' +
											'⚠️ **Penting:** Jika role Phantom dicabut, API key akan dinonaktifkan.',
									)
									.setColor(0x57f287);

								await interaction.reply({
									embeds: [infoEmbed],
									ephemeral: true,
								});
								return;
							}
						} catch (keyErr) {
							console.error('[auto-claim] Failed to get existing key:', keyErr);
						}

						// Fallback if can't get key
						const infoEmbed = new EmbedBuilder()
							.setTitle('✅ Sudah Memiliki API Key')
							.setDescription(
								'Anda sudah memiliki API key aktif.\n\n' +
									'Jika tidak berfungsi, silakan hubungi admin untuk reset.\n\n' +
									'Note: Jika role Phantom dicabut, API key akan dinonaktifkan.',
							)
							.setColor(0x57f287);

						await interaction.reply({
							embeds: [infoEmbed],
							ephemeral: true,
						});
						return;
					}

					// Provision new API key
					let provisionResult = null;
					try {
						provisionResult = await provisionApiKeyForVerifiedUser(
							userId,
							interaction.user.username,
							'auto-claim',
							interaction.guildId,
						);
					} catch (err) {
						console.error('[auto-claim] Failed to provision key:', err);
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ Gagal Claim')
							.setDescription(
								'Gagal membuat API key. Silakan coba lagi atau hubungi admin.',
							)
							.setColor(0xff6b6b);

						await interaction.reply({
							embeds: [errorEmbed],
							ephemeral: true,
						});
						return;
					}

					// Get endpoint
					const endpoint = provisionResult.endpoint || PROXY_PUBLIC_BASE_URL + '/v1';

					// Send DM with API credentials
					let dmSent = false;
					try {
						dmSent = !!(await sendApiCredentialsDm(
							userId,
							provisionResult.apiKey,
							endpoint,
						));
					} catch (dmErr) {
						console.error('[auto-claim] DM send failed:', dmErr);
					}

					// Send How to Use guide
					try {
						const data = await proxyInternal('/admin/internal/models/details');
						const models = (data?.data || [])
							.map((m) => m.id)
							.filter((id) => id && id !== 'auto');
						await sendHowToDm(userId, 'phantom', {
							endpoint,
							apiKey: provisionResult.apiKey,
							models,
						});
					} catch (howtoErr) {
						console.error('[auto-claim] sendHowToDm failed:', howtoErr.message);
					}

					// Create thread for tracking (even in auto-claim mode)
					const channel = await client.channels.fetch(AGVERIF_CHANNEL_ID);
					if (!channel) {
						console.error('[auto-claim] Channel not found');
					} else {
						try {
							const thread = await channel.threads.create({
								name: `claim-${interaction.user.username}`,
								autoArchiveDuration: 4320,
								type: ChannelType.PrivateThread,
								reason: 'API key claim ticket',
							});

							await thread.members.add(interaction.user.id);

							// Save to verifiedUsers for tracking
							const verifiedData = {
								userId: userId,
								threadId: thread.id,
								claimedAt: Date.now(),
								dmSent: dmSent,
							};
							client.agverifData.verifiedUsers[userId] = verifiedData;
							await saveVerifiedUsersData();

							// Send info in thread
							await thread.send({
								embeds: [
									new EmbedBuilder()
										.setTitle('🎁 API Key Di Claim')
										.setDescription(
											`API key sudah ${dmSent ? 'dikirim via DM' : 'dibuat tapi DM gagal, silakan hubungi admin'}.\n\n` +
												`Jika tidak menerima DM, silakan cek:\n` +
												`• Allow DM dari server ini\n` +
												`• Hubungi admin untuk kirim ulang`,
										)
										.setColor(dmSent ? 0x57f287 : 0xffa500)
										.setTimestamp(),
								],
							});
						} catch (threadErr) {
							console.error('[auto-claim] Failed to create thread:', threadErr);
						}
					}

					// Reply to user
					const successEmbed = new EmbedBuilder()
						.setTitle(dmSent ? '✅ API Key Dikirim' : '⚠️ API Key Dibuat')
						.setDescription(
							dmSent
								? 'API key sudah dikirim via DM. Silakan cek DM anda.\n\n' +
										'⚠️ **Penting:** Jika role Phantom dicabut, API key akan dinonaktifkan.'
								: 'API key sudah dibuat tapi DM gagal terkirim.\n\n' +
										'Silakan hubungi admin untuk kirim ulang API key.\n\n' +
										'⚠️ **Penting:** Jika role Phantom dicabut, API key akan dinonaktifkan.',
						)
						.setColor(dmSent ? 0x57f287 : 0xffa500);

					await interaction.reply({
						embeds: [successEmbed],
						ephemeral: true,
					});
					return;
				}

				// ─── AGVERIF_ENABLED = true: Original photo verification flow ───
				if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ Akses Ditolak')
						.setDescription(
							'Anda memerlukan role **The Phantom** untuk menggunakan fitur verifikasi antigravity.',
						)
						.setColor(0xff6b6b);

					await interaction.reply({
						embeds: [errorEmbed],
						ephemeral: true,
					});
					return;
				}

				// Cek status verifikasi berdasarkan ROLE saat ini, bukan hanya data lokal
				const hasVerifiedRoleNow = member.roles.cache.has(VERIFIED_ROLE_ID);
				const existingVerifiedData = client.agverifData.verifiedUsers[userId];

				if (hasVerifiedRoleNow) {
					// Cek apakah thread verifikasi masih ada di Discord
					if (existingVerifiedData) {
						let threadStillExists = false;
						try {
							const thread = await client.channels.fetch(
								existingVerifiedData.threadId,
							);
							if (thread && thread.isThread()) {
								threadStillExists = true;
							}
						} catch (_) {}

						if (!threadStillExists) {
							// Thread sudah dihapus — bersihkan data dan izinkan verifikasi ulang
							await removeVerifiedUser(userId);
							if (client.agverifData.threads[existingVerifiedData.threadId]) {
								await removeThreadFromData(existingVerifiedData.threadId);
							}
							// Juga hapus role karena thread sudah tidak ada
							try {
								await member.roles.remove(
									VERIFIED_ROLE_ID,
									'Thread verifikasi sudah tidak ada, role dihapus',
								);
							} catch (_) {}
							// Lanjut buat tiket baru (jangan return)
						} else {
							// Thread masih ada — tampilkan "sudah terverifikasi"
							const infoEmbed = new EmbedBuilder()
								.setTitle('✅ Sudah Terverifikasi')
								.setDescription(
									`Anda sudah terverifikasi antigravity.\nThread verifikasi: <#${existingVerifiedData.threadId}>`,
								)
								.setColor(0x57f287);

							await interaction.reply({
								embeds: [infoEmbed],
								ephemeral: true,
							});
							return;
						}
					} else {
						// Punya role tapi tidak ada data verifikasi — tampilkan "sudah terverifikasi"
						const infoEmbed = new EmbedBuilder()
							.setTitle('✅ Sudah Terverifikasi')
							.setDescription(
								'Anda sudah terverifikasi antigravity dan memiliki role yang diperlukan.',
							)
							.setColor(0x57f287);

						await interaction.reply({
							embeds: [infoEmbed],
							ephemeral: true,
						});
						return;
					}
				}

				// Sampai di sini user TIDAK punya role verif saat ini → anggap BELUM terverifikasi,
				// walaupun mungkin masih ada data lama di verifiedUsers / threads.
				// Bereskan dulu semua state lama sebelum buat tiket baru.
				if (existingVerifiedData) {
					const oldThreadId = existingVerifiedData.threadId;
					let oldThread = null;
					try {
						oldThread = await client.channels.fetch(oldThreadId);
					} catch (_) {}

					// Hapus data verifikasi user lama
					await removeVerifiedUser(userId);

					// Hapus data thread lama dari memory/file
					if (client.agverifData.threads[oldThreadId]) {
						await removeThreadFromData(oldThreadId);
					}

					// Kalau thread lama masih ada di Discord, coba hapus juga
					if (oldThread && oldThread.isThread()) {
						try {
							await oldThread.delete(
								'Tiket verifikasi lama dihapus karena status role tidak lagi terverifikasi',
							);
						} catch (err) {
							// 10003 = Unknown Channel, thread memang sudah tidak ada
							if (err.code !== 10003) {
								console.error(
									'Failed to delete old verification thread when resetting state:',
									err,
								);
							}
						}
					}
				}

				const existingThread = Object.entries(client.agverifData.threads).find(
					([_, data]) => data.userId === userId,
				);

				if (existingThread) {
					try {
						const oldThread = await client.channels.fetch(existingThread[0]);
						if (oldThread && oldThread.isThread()) {
							await oldThread.delete('User membuat tiket verifikasi baru');
						}
						await removeThreadFromData(existingThread[0]);
					} catch (err) {
						console.error('Failed to delete old thread:', err);
					}
				}

				const channel = await client.channels.fetch(AGVERIF_CHANNEL_ID);
				if (!channel) {
					await interaction.reply({
						content: '❌ Channel tidak ditemukan.',
						ephemeral: true,
					});
					return;
				}

				const thread = await channel.threads.create({
					name: `verif-${interaction.user.username}`,
					// 3 days = 4320 minutes
					autoArchiveDuration: 4320,
					type: ChannelType.PrivateThread,
					reason: 'Antigravity verification ticket',
				});

				await thread.members.add(interaction.user.id);

				const threadData = {
					userId: interaction.user.id,
					createdAt: Date.now(),
					hasPhoto: false,
					photoMessageId: null,
					verifiedBy: null,
					verifiedAt: null,
					hasRole: false,
					lastPhotoCheck: null,
					photoDeletedAfterRole: false,
					warningMessageSent: false,
					deleteTimeout: null,
					inactiveTimeout: null,
					photoDeleteTimeout: null,
				};

				await updateThreadData(thread.id, threadData);

				const deleteTimeout = setupNoPhotoTimeout(thread.id);
				client.agverifData.threads[thread.id].deleteTimeout = deleteTimeout;

				const welcomeEmbed = new EmbedBuilder()
					.setTitle('✨ Verifikasi Antigravity')
					.setDescription(
						`Halo <@${interaction.user.id}>!\n\n` +
							'Untuk melakukan verifikasi antigravity, silakan upload foto selfie Anda dengan memegang kertas putih bertuliskan:\n\n' +
							'**"saya pengguna paket phantom, ingin verifikasi antigravity"**\n\n' +
							'**Ketentuan:**\n' +
							'• Wajah Anda harus terlihat jelas\n' +
							'• Tulisan di kertas harus terbaca\n' +
							'• Foto harus asli (bukan editan)\n\n' +
							'⚠️ **PENTING:**\n' +
							'• Jangan hapus atau tutup foto setelah diupload\n' +
							'• Jika foto dihapus, role akan dicabut otomatis\n' +
							'• Thread akan dihapus jika tidak ada foto dalam 1 jam\n\n' +
							'Setelah upload, Owner Groupy akan memverifikasi foto Anda.',
					)
					.setColor(0x5865f2)
					.setTimestamp();

				await thread.send({ embeds: [welcomeEmbed] });

				const successEmbed = new EmbedBuilder()
					.setTitle('✅ Thread Dibuat')
					.setDescription(
						`Thread verifikasi Anda telah dibuat: <#${thread.id}>\n\n` +
							'Silakan upload foto verifikasi Anda di thread tersebut.',
					)
					.setColor(0x57f287);

				await interaction.reply({
					embeds: [successEmbed],
					ephemeral: true,
				});
			}
		}
	} catch (err) {
		console.error('Error handling interaction:', err);
		try {
			await interaction.reply({
				content: '❌ Terjadi kesalahan saat memproses interaksi.',
				ephemeral: true,
			});
		} catch (_) {}
	}
});

client.on('messageCreate', async (message) => {
	try {
		if (message.author.bot) return;
		if (await handleAdminCommand(message)) return;

		if (message.channel.isThread()) {
			const threadId = message.channel.id;
			const threadData = client.agverifData.threads[threadId];

			if (!threadData) return;

			if (message.author.id === threadData.userId) {
				const hasImage = message.attachments.some((attachment) => {
					return (
						attachment.contentType &&
						attachment.contentType.startsWith('image/')
					);
				});

				if (hasImage) {
					if (threadData.hasPhoto && !threadData.photoDeletedAfterRole) {
						const warningEmbed = new EmbedBuilder()
							.setTitle('⚠️ Peringatan')
							.setDescription(
								'Anda sudah mengupload foto sebelumnya.\n\n' +
									'Hanya **1 foto per verifikasi** yang diperbolehkan.\n\n' +
									'Jika ingin mengganti foto, silakan tutup thread ini dan buat tiket baru.',
							)
							.setColor(0xffa500);

						await message.channel.send({ embeds: [warningEmbed] });

						try {
							await message.delete();
						} catch (err) {
							console.error('Failed to delete message:', err);
						}

						return;
					}

					if (threadData.deleteTimeout) {
						clearTimeout(threadData.deleteTimeout);
					}

					if (threadData.photoDeleteTimeout) {
						clearTimeout(threadData.photoDeleteTimeout);
					}

					if (threadData.warningMessageId) {
						try {
							const warningMsg = await message.channel.messages.fetch(
								threadData.warningMessageId,
							);
							if (warningMsg) await warningMsg.delete();
						} catch (_) {}
					}

					if (threadData.warningDMMessageId) {
						try {
							const user = await client.users.fetch(threadData.userId);
							if (user) {
								let dmChannel = user.dmChannel;
								if (!dmChannel) {
									dmChannel = await user.createDM();
								}
								try {
									const dmMsg = await dmChannel.messages.fetch(
										threadData.warningDMMessageId,
									);
									if (dmMsg) await dmMsg.delete();
								} catch (_) {}
							}
						} catch (_) {}
					}

					await updateThreadData(threadId, {
						hasPhoto: true,
						photoMessageId: message.id,
						lastPhotoCheck: Date.now(),
						photoDeletedAfterRole: false,
						warningMessageSent: false,
						warningMessageId: null,
						warningDMMessageId: null,
					});

					if (threadData.inactiveTimeout) {
						clearTimeout(threadData.inactiveTimeout);
					}

					const inactiveTimeout = setupInactiveTimeout(threadId);
					client.agverifData.threads[threadId].inactiveTimeout =
						inactiveTimeout;

					const imageAttachment = message.attachments.find(
						(a) => a.contentType && a.contentType.startsWith('image/'),
					);

					const evalResult = imageAttachment
						? await evaluateVerificationPhoto(imageAttachment)
						: {
								ownerNotify: false,
								autoVerifyRole: false,
							};

					if (evalResult.autoVerifyRole) {
						try {
							const guild = message.guild;
							if (guild) {
								const member = await guild.members.fetch(message.author.id);
								if (member && !member.roles.cache.has(VERIFIED_ROLE_ID)) {
									await member.roles.add(
										VERIFIED_ROLE_ID,
										'Verifikasi antigravity (cek Gemini)',
									);
								}
							}
						} catch (err) {
							console.error(
								'[agverif] Gagal memberi role verifikasi otomatis:',
								err,
							);
						}
					}

					if (evalResult.ownerNotify) {
						const roleMention = `<@&${OWNER_GROUPY_ROLE_ID}>`;
						const userMention = `<@${message.author.id}>`;

						const notificationEmbed = new EmbedBuilder()
							.setTitle('✨📸 Foto Verifikasi Diupload')
							.setDescription(
								`User ${userMention} telah mengupload foto verifikasi.`,
							)
							.setColor(0x5865f2)
							.setTimestamp();

						const notifMsg = await message.channel.send({
							content: roleMention,
							embeds: [notificationEmbed],
						});

						await updateThreadData(threadId, {
							notificationMessageId: notifMsg.id,
						});
					}
				}
			}
		}

		if (
			TOKITO_API_KEY &&
			TOKITO_CHANNEL_ID &&
			message.channelId === TOKITO_CHANNEL_ID &&
			message.author.id !== client.user.id
		) {
			await refreshPanelToBottom();
		}
	} catch (err) {
		console.error('Error handling message:', err);
	}
});

client.on('interactionCreate', async (interaction) => {
	if (!TOKITO_API_KEY) return;
	try {
		if (interaction.isButton()) {
			if (
				interaction.customId === PANEL_STATUS ||
				interaction.customId === PANEL_LATENCY ||
				interaction.customId === PANEL_DETAILS
			) {
				const access = await getMemberToolAccess(interaction.member);
				if (!access.canUseTools) {
					await interaction.reply({
						content: toolAccessDeniedMessage(access),
						ephemeral: true,
					});
					return;
				}

				const kind =
					interaction.customId === PANEL_STATUS
						? 'status'
						: interaction.customId === PANEL_LATENCY
							? 'latency'
							: 'details';

				// Immediately acknowledge to prevent 10s timeout
				await interaction.deferReply({ ephemeral: true });

				// Refresh data from proxy DB for fresh results
				await refreshLatencyFromProxy();

				// Load enriched catalog metadata for details view (and trial gpy panel)
				if (kind === 'details') {
					try {
						const detailsData = await proxyInternal(
							'/admin/internal/models/details',
						);
						runtime._modelDetailsCache = detailsData?.data || [];
					} catch (err) {
						console.error(
							'[tokito] Failed to fetch model details:',
							err.message || JSON.stringify(err),
						);
						runtime._modelDetailsCache = [];
					}
				}

				const session = createTokitoSession(interaction.user.id, kind, access);
				if (session.trialMode) {
					session.trialCache = await getTrialModelsCached();
					if (
						kind === 'details' &&
						(!runtime._modelDetailsCache ||
							runtime._modelDetailsCache.length === 0)
					) {
						try {
							const detailsData = await proxyInternal(
								'/admin/internal/models/details',
							);
							runtime._modelDetailsCache = detailsData?.data || [];
						} catch {
							/* ignore */
						}
					}
				}
				// Store interaction for message deletion on expiry
				session.interaction = interaction;
				const { embed, components } = buildTokitoEmbed(kind, session);

				// Add endpoint info footer to the embed
				embed.setFooter({
					text: `Endpoint: ${PROXY_PUBLIC_BASE_URL}  •  ${embed.data.footer?.text || ''}`.trim(),
				});

				// Edit with actual results
				await interaction.editReply({
					embeds: [embed],
					components,
				});
				return;
			}

			// Model Details button handler (old static version - replaced by above)
			if (false && interaction.customId === PANEL_DETAILS) {
				await interaction.deferReply({ ephemeral: true });

				try {
					const data = await proxyInternal('/admin/internal/models/details');
					const models = (data?.data || []).filter((m) => m.id !== 'auto');

					// Sort: online first, then by name
					models.sort((a, b) => {
						if (a.is_online && !b.is_online) return -1;
						if (!a.is_online && b.is_online) return 1;
						return (a.id || '').localeCompare(b.id || '');
					});

					// Paginate (max 10 per page to fit embed)
					const PAGE_SIZE = 10;
					const page = 0;
					const totalPages = Math.max(1, Math.ceil(models.length / PAGE_SIZE));
					const pageModels = models.slice(
						page * PAGE_SIZE,
						(page + 1) * PAGE_SIZE,
					);

					function formatModelLine(m) {
						const status = m.is_online ? '🟢' : '🔴';
						const ctx = m.context_length
							? `${Math.round(m.context_length / 1024)}K`
							: '?';
						const maxOut = m.max_output_tokens
							? `${Math.round(m.max_output_tokens / 1024)}K`
							: '?';
						const pricing = m.pricing
							? `$${m.pricing.prompt?.toFixed(2) || '?'}/$${m.pricing.completion?.toFixed(2) || '?'}`
							: 'N/A';
						const modalities = (m.input_modalities || ['text']).join(',');
						const features =
							(m.supported_features || []).slice(0, 3).join(', ') || '-';
						const latency = m.latency_ms != null ? `${m.latency_ms}ms` : '-';
						return `${status} **${m.id}**\n  ctx: ${ctx} | out: ${maxOut} | ${pricing}/M | ${modalities} | ${latency}\n  features: ${features}`;
					}

					const description = pageModels.map(formatModelLine).join('\n\n');

					const embed = new EmbedBuilder()
						.setTitle('📋 Model Details')
						.setDescription(description || 'No models found')
						.setFooter({
							text: `Page ${page + 1}/${totalPages} • ${models.length} models total`,
						})
						.setColor(0x5865f2)
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
				} catch (err) {
					console.error(
						'[tokito] Model details error:',
						err.message || JSON.stringify(err),
					);
					await interaction.editReply({
						content: 'Failed to fetch model details.',
					});
				}
				return;
			}

			const match = interaction.customId.match(
				/^tokito_(prev|next|close)_(.+)$/,
			);
			if (!match) return;

			const action = match[1];
			const sessionId = match[2];
			const session = tokitoSessions.get(sessionId);
			if (!session || session.userId !== interaction.user.id) {
				try {
					// ALWAYS defer the update immediately so Discord doesn't throw "Unknown interaction"
					await interaction.deferUpdate().catch(() => {});
					if (interaction.message && interaction.message.deletable) {
						await interaction.message.delete().catch(() => {});
					} else {
						await interaction.deleteReply().catch(() => {});
					}
				} catch (err) {
					console.error('Failed to delete expired tokito interaction:', err);
				}
				return;
			}

			if (action === 'prev') session.page -= 1;
			if (action === 'next') session.page += 1;
			if (action === 'close') {
				tokitoSessions.delete(session.id);
				await interaction.update({
					content: 'Session closed.',
					embeds: [],
					components: [],
				});
				return;
			}

			if (session.kind === 'details') {
				await ensureModelDetailsCache();
			}

			const { embed, components } = buildTokitoEmbed(session.kind, session);
			await interaction.update({ embeds: [embed], components });
			return;
		}

		if (interaction.isStringSelectMenu()) {
			const upstreamMatch = interaction.customId.match(
				/^tokito_filter_upstream_(.+)$/,
			);
			const vendorMatch = interaction.customId.match(
				/^tokito_filter_vendor_(.+)$/,
			);
			const sortMatch = interaction.customId.match(/^tokito_filter_sort_(.+)$/);
			const sessionId =
				upstreamMatch?.[1] || vendorMatch?.[1] || sortMatch?.[1];

			if (!sessionId) {
				console.warn(
					'tokito interaction: no session ID found in customId',
					interaction.customId,
				);
				// Acknowledge to prevent unknown interaction if it somehow drops through
				await interaction.deferUpdate().catch(() => {});
				if (interaction.message && interaction.message.deletable) {
					await interaction.message.delete().catch(() => {});
				}
				return;
			}

			const session = tokitoSessions.get(sessionId);
			if (!session || session.userId !== interaction.user.id) {
				try {
					// ALWAYS defer the update immediately so Discord doesn't throw "Unknown interaction"
					await interaction.deferUpdate().catch(() => {});
					if (interaction.message && interaction.message.deletable) {
						await interaction.message.delete().catch(() => {});
					} else {
						await interaction.deleteReply().catch(() => {});
					}
				} catch (err) {
					console.error('Failed to delete expired tokito interaction:', err);
				}
				return;
			}

			if (upstreamMatch) {
				session.upstreamProvider = session.trialMode
					? 'gpy'
					: interaction.values[0] || 'all';
				session.modelVendor = 'all';
				session.page = 0;
			}
			if (vendorMatch) {
				session.modelVendor = interaction.values[0] || 'all';
				session.page = 0;
			}
			if (sortMatch) {
				session.sortMode = interaction.values[0] || session.sortMode;
				session.page = 0;
			}
			if (session.kind === 'details') {
				await ensureModelDetailsCache();
			}
			const { embed, components } = buildTokitoEmbed(session.kind, session);
			await interaction.update({ embeds: [embed], components });
		}
	} catch (err) {
		console.error('tokito interaction error:', err);
	}
});

client.on('messageDelete', async (message) => {
	try {
		const threadEntry = Object.entries(client.agverifData.threads).find(
			([_, data]) => data.photoMessageId === message.id,
		);
		if (!threadEntry) return;
		const [threadId, threadData] = threadEntry;

		if (threadData.hasRole) {
			await handlePhotoDeletedAfterRole(threadId);
		} else {
			await handlePhotoDeletedBeforeRole(threadId);
		}
	} catch (err) {
		console.error('Error handling message delete:', err);
	}
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
	try {
		const oldHasRole = oldMember.roles.cache.has(VERIFIED_ROLE_ID);
		const newHasRole = newMember.roles.cache.has(VERIFIED_ROLE_ID);

		if (!oldHasRole && newHasRole) {
			const threadEntry = Object.entries(client.agverifData.threads).find(
				([_, data]) => data.userId === newMember.id && !data.hasRole,
			);

			if (threadEntry) {
				const [threadId, threadData] = threadEntry;

				try {
					const thread = await client.channels.fetch(threadId);
					if (thread && thread.isThread()) {
						if (threadData.inactiveTimeout) {
							clearTimeout(threadData.inactiveTimeout);
						}

						await updateThreadData(threadId, {
							hasRole: true,
							verifiedAt: Date.now(),
						});

						await addVerifiedUser(newMember.id, threadId, VERIFIED_ROLE_ID);

						const inactiveTimeout = setupInactiveTimeout(threadId);
						client.agverifData.threads[threadId].inactiveTimeout =
							inactiveTimeout;

						const successEmbed = new EmbedBuilder()
							.setTitle('✅ Verifikasi Berhasil!')
							.setDescription(
								`Selamat <@${newMember.id}>!\n\n` +
									'Verifikasi antigravity Anda telah berhasil dan role telah diberikan.\n\n' +
									'⚠️ **PENTING - BACA DENGAN TELITI:**\n' +
									'• **DILARANG MENUTUP ATAU MENGHAPUS FOTO** yang telah diupload\n' +
									'• Jika foto dihapus, **role akan dicabut otomatis**\n' +
									'• Thread ini akan tetap ada selama foto tidak dihapus\n' +
									'• Jangan pernah hapus thread ini\n\n' +
									'Terima kasih telah melakukan verifikasi!',
							)
							.setColor(0x57f287)
							.setTimestamp();

						const successMsg = await thread.send({
							content: `<@${newMember.id}>`,
							embeds: [successEmbed],
						});

						await updateThreadData(threadId, {
							successMessageId: successMsg.id,
						});

						let verifiedRoleName = 'Role verifikasi';
						try {
							const verifiedRole =
								await thread.guild.roles.fetch(VERIFIED_ROLE_ID);
							if (verifiedRole) {
								verifiedRoleName = `role **${verifiedRole.name}**`;
							}
						} catch (_) {}

						const threadUrl = `https://discord.com/channels/${thread.guild.id}/${threadId}`;
						const linkButton = new ButtonBuilder()
							.setLabel('Buka Thread')
							.setStyle(ButtonStyle.Link)
							.setURL(threadUrl);
						const row = new ActionRowBuilder().addComponents(linkButton);

						await sendDMToUser(
							newMember.id,
							'✅ Verifikasi Berhasil!',
							`Selamat! Verifikasi antigravity Anda telah berhasil.\n\n` +
								`${verifiedRoleName} telah diberikan kepada Anda.\n\n` +
								'**PENTING:**\n' +
								'• JANGAN hapus atau tutup foto yang telah diupload\n' +
								'• Jika foto dihapus, role akan dicabut otomatis\n\n' +
								'Terima kasih!',
							0x57f287,
							[row],
						);

						// Auto-provision proxy API key for verified Discord user
						let provision;
						try {
							provision = await provisionApiKeyForVerifiedUser(
								newMember.id,
								newMember.user.username,
								threadId,
								newMember.guild.id,
							);
						} catch (err) {
							console.error('[agverif] failed to provision proxy key:', err);
							await thread.send({
								embeds: [
									new EmbedBuilder()
										.setTitle('⚠️ Gagal Provision API Key')
										.setDescription(
											'Verifikasi role berhasil, tapi pembuatan API key gagal. Admin bisa pakai `!agrefresh <@user>`.',
										)
										.setColor(0xffa500)
										.setTimestamp(),
								],
							});
							provision = null;
						}

						if (provision) {
							const endpoint =
								provision.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`;
							// Send DM (non-critical — may fail if user has DMs disabled)
							try {
								await sendApiCredentialsDm(
									newMember.id,
									provision.apiKey,
									endpoint,
								);
								// Kirim DM How to Use terpisah
								try {
									const data = await proxyInternal(
										'/admin/internal/models/details',
									);
									const models = (data?.data || [])
										.map((m) => m.id)
										.filter((id) => id && id !== 'auto');
									await sendHowToDm(newMember.id, 'phantom', {
										endpoint,
										apiKey: provision.apiKey,
										models,
									});
								} catch (howtoErr) {
									console.error(
										'[agverif] sendHowToDm failed:',
										howtoErr.message,
									);
								}
								await thread.send({
									embeds: [
										new EmbedBuilder()
											.setTitle('🔑 API Key Dibuat')
											.setDescription(
												`API key proxy otomatis sudah dibuat untuk <@${newMember.id}> dan dikirim via DM.\n\n` +
													`Endpoint: \`${endpoint}\`\n` +
													`Kebijakan: max 1 device (multi-device => revoke/rotate).`,
											)
											.setColor(0x57f287)
											.setTimestamp(),
									],
								});
							} catch (dmErr) {
								console.warn(
									'[agverif] DM failed, sending key in thread:',
									dmErr.message,
								);
								// DM failed — send credentials in thread instead
								await thread.send({
									content: `🔑 API key untuk <@${newMember.id}> (DM gagal, dikirim di sini):\n\n**Endpoint**: \`${endpoint}\`\n**Authorization**: \`Bearer ${provision.apiKey}\``,
								});
							}
						}

						// Setelah verifikasi berhasil, ubah autoArchiveDuration menjadi 1 jam
						try {
							if (
								thread.autoArchiveDuration === null ||
								thread.autoArchiveDuration !== 60
							) {
								await thread.setAutoArchiveDuration(60);
							}
						} catch (err) {
							console.error(
								`Failed to update autoArchiveDuration to 1 hour for thread ${threadId}:`,
								err,
							);
						}
					}
				} catch (err) {
					console.error('Failed to handle role addition:', err);
				}
			}
		}

		if (oldHasRole && !newHasRole) {
			// Check if user is in verifiedUsers (photo verification mode)
			if (client.agverifData.verifiedUsers[newMember.id]) {
				const verifiedData = client.agverifData.verifiedUsers[newMember.id];
				const threadId = verifiedData.threadId;

				let threadExists = false;
				let thread = null;
				try {
					thread = await client.channels.fetch(threadId);
					if (thread && thread.isThread()) {
						threadExists = true;
					}
				} catch (_) {}

				await removeVerifiedUser(newMember.id);
				await revokeApiKeyForUser(
					newMember.id,
					'Verification role removed',
				).catch((err) => {
					console.error(
						'[agverif] failed to revoke proxy key on role removal:',
						err,
					);
				});

				if (!threadExists) {
					await removeThreadFromData(threadId);
				} else {
					// Get channel name for claim instructions
					let claimChannelMention = 'channel verifikasi';
					try {
						const claimChannel = await client.channels.fetch(AGVERIF_CHANNEL_ID);
						if (claimChannel) {
							claimChannelMention = `<#${claimChannel.id}>`;
						}
					} catch (_) {}

					// Tandai thread akan dihapus karena role dicabut
					if (client.agverifData.threads[threadId]) {
						await updateThreadData(threadId, {
							hasRole: false,
							deletedByRoleRemoval: true,
						});
					}

					// Hapus thread verifikasi (abaikan 10003 = channel sudah tidak ada)
					try {
						await thread.delete('Role verifikasi antigravity dicabut');
					} catch (err) {
						if (err.code !== 10003) {
							console.error(
								'Failed to delete verification thread after role removal:',
								err,
							);
						}
					}
					await removeThreadFromData(threadId);

					await sendDMToUser(
						newMember.id,
						'⚠️ Phantom Kadaluarsa',
						`Paket Phantom anda sudah habis atau role telah dicabut.\n\n` +
							`API key Antigravity anda telah dinonaktifkan.\n\n` +
							`**Untuk melanjutkan:**\n` +
							`1. Perpanjang paket Phantom anda\n` +
							`2. Setelah dapat role Phantom baru, claim ulang API key di ${claimChannelMention}\n\n` +
							`Jika ada pertanyaan, silakan hubungi admin.`,
						0xff6b6b,
					);
				}
			} else if (!AGVERIF_ENABLED) {
				// Auto-claim mode: Phantom role was removed, revoke/disable API key
				await revokeApiKeyForUser(
					newMember.id,
					'Phantom role removed - auto-claim mode',
				).catch((err) => {
					console.error(
						'[auto-claim] failed to revoke proxy key on Phantom role removal:',
						err,
					);
				});

				// Get channel name for claim instructions
				let claimChannelMention = 'channel verifikasi';
				try {
					const claimChannel = await client.channels.fetch(AGVERIF_CHANNEL_ID);
					if (claimChannel) {
						claimChannelMention = `<#${claimChannel.id}>`;
					}
				} catch (_) {}

				await sendDMToUser(
					newMember.id,
					'⚠️ Phantom Kadaluarsa',
					`Paket Phantom anda sudah habis atau role telah dicabut.\n\n` +
						`API key Antigravity anda telah dinonaktifkan.\n\n` +
						`**Untuk melanjutkan:**\n` +
						`1. Perpanjang paket Phantom anda\n` +
						`2. Setelah dapat role Phantom baru, claim ulang API key di ${claimChannelMention}\n\n` +
						`Jika ada pertanyaan, silakan hubungi admin.`,
					0xff6b6b,
				);
			}
		}
	} catch (err) {
		console.error('Error handling guild member update:', err);
	}
});

client.on('threadDelete', async (thread) => {
	try {
		const threadData = client.agverifData.threads[thread.id];
		if (!threadData) return;

		// Jika thread memang sudah ditandai dihapus karena role dicabut,
		// cukup bersihkan data tanpa mengubah role/DM lagi
		if (threadData.deletedByRoleRemoval) {
			await removeThreadFromData(thread.id);
			return;
		}

		if (threadData.hasRole) {
			let verifiedRoleName = 'Role verifikasi';
			try {
				const guild = thread.guild;
				const verifiedRole = await guild.roles.fetch(VERIFIED_ROLE_ID);
				if (verifiedRole) {
					verifiedRoleName = `role **${verifiedRole.name}**`;
				}

				const member = await guild.members.fetch(threadData.userId);
				if (member && member.roles.cache.has(VERIFIED_ROLE_ID)) {
					await member.roles.remove(VERIFIED_ROLE_ID);
				}
			} catch (err) {
				console.error('Failed to revoke role on thread deletion:', err);
			}

			await removeVerifiedUser(threadData.userId);
			await revokeApiKeyForUser(
				threadData.userId,
				'Verification thread deleted',
			).catch((err) => {
				console.error(
					'[agverif] failed to revoke proxy key on thread delete:',
					err,
				);
			});

			await sendDMToUser(
				threadData.userId,
				'⚠️ Thread Verifikasi Dihapus',
				'Thread verifikasi Anda telah dihapus.\n\n' +
					`${verifiedRoleName} telah dicabut karena thread dihapus.\n\n` +
					'Jika ingin verifikasi kembali, silakan buat tiket baru.',
				0xff6b6b,
			);
		}

		await removeThreadFromData(thread.id);
	} catch (err) {
		console.error('Error handling thread deletion:', err);
	}
});

client.on('guildMemberRemove', async (member) => {
	try {
		const userId = member.id;
		const verifiedData = client.agverifData.verifiedUsers[userId];
		if (!verifiedData) return;

		const threadId = verifiedData.threadId;

		let thread = null;
		try {
			thread = await client.channels.fetch(threadId);
		} catch (_) {}

		// Bersihkan state verifikasi user
		await removeVerifiedUser(userId);
		await revokeApiKeyForUser(userId, 'User left Discord server').catch(
			(err) => {
				console.error(
					'[agverif] failed to revoke proxy key on guild leave:',
					err,
				);
			},
		);

		// Jika masih ada data thread, tandai dan hapus
		if (client.agverifData.threads[threadId]) {
			await updateThreadData(threadId, {
				hasRole: false,
				deletedByRoleRemoval: true,
			});
		}

		if (thread && thread.isThread()) {
			try {
				await thread.delete(
					'User keluar dari server, menghapus thread verifikasi',
				);
			} catch (err) {
				if (err.code !== 10003) {
					console.error(
						'Failed to delete verification thread after member leave:',
						err,
					);
				}
			}
		}
		// Selalu hapus data thread (thread sudah tidak ada atau sudah kita hapus)
		await removeThreadFromData(threadId);
	} catch (err) {
		console.error('Error handling guild member remove:', err);
	}
});

process.on('SIGINT', async () => {
	await saveThreadsData();
	await saveVerifiedUsersData();
	await saveSetupState();
	process.exit();
});

process.on('SIGTERM', async () => {
	await saveThreadsData();
	await saveVerifiedUsersData();
	await saveSetupState();
	process.exit();
});

if (!BOT_TOKEN) {
	console.error(
		'❌ BOT_TOKEN tidak ditemukan! Silakan set BOT_TOKEN di file .env',
	);
	process.exit(1);
}

client
	.login(BOT_TOKEN)
	.then(() => {
		console.log('✅ Bot berhasil login!');
	})
	.catch((err) => {
		console.error('❌ Gagal login:', err);
		process.exit(1);
	});
