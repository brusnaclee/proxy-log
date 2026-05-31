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
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

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
	process.env.AGVERIF_CHANNEL_ID || '1470106180255744123';
let REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID || '1354646304042651728';
let OWNER_GROUPY_ROLE_ID =
	process.env.OWNER_GROUPY_ROLE_ID || '1354642878063710260';
let VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1486334226671337472';
let BOT_TOKEN = process.env.BOT_TOKEN;
let VERIF_AUTO_ENABLED =
	String(process.env.VERIF_AUTO || 'false').toLowerCase() === 'true';
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
	parseInt(process.env.TOKITO_REQUEST_TIMEOUT_MS) || 30000;
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

async function proxyInternal(pathname, method = 'GET', body = null) {
	const headers = {
		'Content-Type': 'application/json',
		'x-internal-secret': INTERNAL_API_SECRET,
	};
	const res = await fetch(`${PROXY_INTERNAL_BASE_URL}${pathname}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data.error || `Proxy internal API failed: ${res.status}`);
	}
	return data;
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
	const result = await sendDMToUser(
		userId,
		'🔑 API Key Proxy Anda',
		`Verifikasi Anda berhasil. Berikut kredensial akses API proxy:\n\n` +
			`**Endpoint**: \`${endpoint}\`\n` +
			`**Authorization**: \`Bearer ${apiKey}\`\n\n` +
			`Contoh request ke OpenAI-compatible endpoint:\n` +
			`\`${endpoint}/chat/completions\`\n\n` +
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
					'`!agsetratelimit <@user|id> <limit> <window>`\n' +
					'`!agsetpromptlimit <@user|id> <limit> <window>`\n' +
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
					'Gunakan format: !agsetratelimit <user> <limit> <window> (contoh: !agsetratelimit @user 100 1h)',
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
					`Rate limit untuk user diubah menjadi **${limit}** request per **${windowStr}**.`,
				);
			} else {
				await message.reply(
					'Gagal mengubah rate limit: ' + (res.error || 'Unknown error'),
				);
			}
			return true;
		}

		if (cmd === '!agsetpromptlimit') {
			if (!a2 || !parts[3]) {
				await message.reply(
					'Gunakan format: !agsetpromptlimit <user> <limit> <window> (contoh: !agsetpromptlimit @user 50 1d)',
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
			const data = await proxyInternal(`/admin/internal/user/${discordUserId}`);
			if (!data.found) {
				await message.reply('User belum punya API key proxy.');
				return true;
			}
			await message.reply(
				`**Status ${data.key.discordUsername || data.key.discordUserId}**\n` +
					`Key: ${data.key.keyMasked}\n` +
					`Active: ${data.key.isActive}\n` +
					`Requests: ${data.stats.requests}\n` +
					`Tokens: ${data.stats.tokens}\n` +
					`Devices: ${data.stats.uniqueDevices}\n` +
					`Policies: device=${data.key.devicePolicy}, ip=${data.key.ipPolicy}, ide=${data.key.idePolicy}\n` +
					`Rate Limit: ${data.key.rateLimit || 'Global'} per ${data.key.rateLimitWindow || 'Global'}\n` +
					`Prompt Limit: ${data.key.promptLimit || 'Global'} per ${data.key.promptLimitWindow || 'Global'}\n` +
					`Per-Model Limit: ${data.key.perModelPromptLimit || 'Global'}`,
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
				try {
					await sendApiCredentialsDm(
						discordUserId,
						data.apiKey,
						data.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`,
					);
					await message.reply(
						'API key berhasil di-refresh dan dikirim via DM ke user.',
					);
				} catch (dmErr) {
					console.warn('[agrefresh] DM failed, sending key in channel:', dmErr.message);
					await message.reply(
						`API key berhasil di-refresh. DM gagal, dikirim di sini:\n\n**Endpoint**: \`${data.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`}\`\n**Authorization**: \`Bearer ${data.apiKey}\``,
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
				console.warn('[agunblock] DM failed, sending key in channel:', dmErr.message);
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
		if (!trimmed) { client.agverifData.threads = {}; return; }
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.threads = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn('[agverif] threads.json unreadable, resetting:', err.message);
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
		if (!trimmed) { client.agverifData.verifiedUsers = {}; return; }
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.verifiedUsers = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn('[agverif] verified_users.json unreadable, resetting:', err.message);
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
		if (!trimmed) { client.agverifData.setupState = { messageId: null, channelId: null }; return; }
		const data = JSON.parse(trimmed);
		if (data && typeof data === 'object') {
			client.agverifData.setupState = data;
		}
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn('[agverif] setup_state.json unreadable, resetting:', err.message);
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
			console.log('[tokito-monitor] fetched', res.length, 'providers from proxy');
			return res;
		}
	} catch (err) {
		console.error('[tokito-monitor] failed to fetch providers:', err.message);
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
	const base = prov.endpoint.replace(/\/+$/, '');
	const candidates = [`${base}/models`, `${base}/v1/models`];
	const cleanKey = sanitizeProviderApiKey(prov.apiKey);
	const authAttempts = cleanKey ? [cleanKey, ''] : [''];

	for (const url of candidates) {
		for (const key of authAttempts) {
			try {
				const headers = { Accept: 'application/json' };
				if (key) headers.Authorization = `Bearer ${key}`;
				const res = await fetch(url, { headers });
				if (!res.ok) continue;
				const payload = await res.json();
				const arr = Array.isArray(payload) ? payload : payload?.data || [];
				if (arr.length === 0) continue;
				return { arr, url, baseUrl: base, apiKey: key || cleanKey || prov.apiKey };
			} catch (_) {}
		}
	}
	return null;
}

async function pollModelStatus() {
	let providers = await fetchProvidersFromProxy();

	if (!providers || providers.length === 0) {
		console.log('[tokito-monitor] no providers configured, falling back to TOKITO_BASE_URL');
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
				const keysResult = await proxyInternal(`/admin/providers/${prov.id}/keys`, 'GET');
				if (Array.isArray(keysResult)) {
					const activeKeys = keysResult
						.filter(k => k.isActive && !k.isLimited)
						.map(k => k.apiKey);
					if (activeKeys.length > 0) {
						runtime.providerKeys.set(prov.name, activeKeys);
						console.log(`[tokito-monitor] loaded ${activeKeys.length} active keys for provider: ${prov.name}`);
					}
				}
			} catch (err) {
				console.error(`[tokito-monitor] failed to fetch keys for ${prov.name}:`, err.message);
			}

			const result = await fetchProviderModelList(prov);
			if (!result) {
				console.error(`[tokito-monitor] failed to fetch models from ${prov.name}`);
				continue;
			}
			const { arr, url, baseUrl, apiKey } = result;
			for (const m of arr) {
				const id = m.id || m.name;
				allModels.push(id);
				const entry = { modelId: id, provider: prov.name, baseUrl, apiKey };
				runtime.modelEntries.push(entry);
				runtime.modelProviderMap.set(id, { provider: prov.name, baseUrl, apiKey });
			}
			console.log(`[tokito-monitor] fetched ${arr.length} models from provider: ${prov.name} (${url})`);
		} catch (err) {
			console.error(`[tokito-monitor] error fetching from ${prov.name}:`, err.message);
		}
	}

	runtime.models = allModels;

	// Drop cached latency for providers no longer active
	const validKeys = new Set(runtime.modelEntries.map(entryKey));
	for (const key of runtime.latency.keys()) {
		if (!validKeys.has(key)) runtime.latency.delete(key);
	}
}

async function pushMetricsToProxy() {
	const payload = runtime.modelEntries.map((entry) => {
		const key = entryKey(entry);
		const lt = runtime.latency.get(key) || { ms: 0, status: 0, ok: false, error: null };
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

/** Refresh runtime.latency from proxy database (for fresh data on button click). */
async function refreshLatencyFromProxy() {
	try {
		const result = await proxyInternal('/admin/internal/monitor/models', 'GET');
		if (result?.data && Array.isArray(result.data)) {
			// Update model entries and latency cache from DB
			const newEntries = [];
			const newLatency = new Map();

			for (const row of result.data) {
				const entry = {
					modelId: row.modelId,
					provider: row.provider,
					baseUrl: row.baseUrl || '',
					apiKey: '',
				};
				newEntries.push(entry);
				const key = entryKey(entry);
				newLatency.set(key, {
					ok: Boolean(row.isOnline),
					ms: row.latencyMs || 0,
					checkedAt: row.checkedAt ? new Date(row.checkedAt).getTime() : Date.now(),
					status: row.httpStatus || 0,
					error: row.errorMessage || null,
				});
			}

			// Update runtime with fresh data from DB
			if (newEntries.length > 0) {
				runtime.modelEntries = newEntries;
				runtime.latency = newLatency;
				runtime.models = [...new Set(newEntries.map(e => e.modelId))];
				// Don't update lastLatencyAt here - only sweeps should set it
			}

			console.log(`[tokito-monitor] refreshed ${newEntries.length} models from proxy DB`);
		}
	} catch (err) {
		console.error('[tokito-monitor] failed to refresh from proxy:', err.message);
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
			const timeout = setTimeout(() => controller.abort(), TOKITO_REQUEST_TIMEOUT_MS);
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
			try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
			result = { ok: res.ok, status: res.status, body };
		} catch (err) {
			result = { ok: false, status: 0, body: { error: err.message } };
		}

		const ms = Date.now() - started;
		const key = entryKey(entry);
		runtime.latency.set(key, {
			ok: result.ok,
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

async function testSingleModel(entry) {
	const started = Date.now();
	const baseUrl = entry.baseUrl;
	const provider = entry.provider;

	// Get all available keys for this provider
	const providerKeys = runtime.providerKeys.get(provider) || [];
	// Use entry's apiKey as fallback, plus any additional keys from the pool
	const keysToTry = [entry.apiKey, ...providerKeys.filter(k => k !== entry.apiKey)];

	let result;
	for (const apiKey of keysToTry) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), TOKITO_REQUEST_TIMEOUT_MS);
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
			try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
			result = { ok: res.ok, status: res.status, body };
			
			// If 429, try next key
			if (res.status === 429 && keysToTry.length > 1) {
				continue;
			}
			// Otherwise, use this result
			break;
		} catch (err) {
			result = { ok: false, status: 0, body: { error: err.message } };
			break; // Network error, don't retry with other keys
		}
	}

	const ms = Date.now() - started;
	return {
		ok: result.ok,
		ms,
		checkedAt: Date.now(),
		status: result.status,
		error: result.body?.error?.message || (result.ok ? null : 'Failed'),
	};
}

// ─── Smart Retry: Full sweep — test ALL models, push results individually ─────

async function runFullSweep() {
	await pollModelStatus();
	if (!runtime.modelEntries.length) return;

	console.log(`[tokito-monitor] full sweep: testing ${runtime.modelEntries.length} models`);

	for (const entry of runtime.modelEntries) {
		const key = entryKey(entry);

		// Skip models currently suspended (waiting for cooldown)
		const retryState = runtime.modelRetryState.get(key);
		if (retryState?.suspendedUntil) {
			const suspendedUntil = new Date(retryState.suspendedUntil).getTime();
			if (Date.now() < suspendedUntil) {
				continue;
			}
		}

		const latency = await testSingleModel(entry);
		runtime.latency.set(key, latency);
		await pushSingleModelStatus(entry, latency);

		if (latency.ok) {
			// Online: clear retry state
			runtime.modelRetryState.delete(key);
		} else if (latency.status === 429) {
			// Rate limited: DON'T increment retry count - model is working, just busy
			// Store as rate limited state but don't mark as offline
			runtime.modelRetryState.set(key, {
				retryCount: 0, // Don't count 429 as failure
				lastTestAt: new Date().toISOString(),
				suspendedUntil: null,
				isRateLimited: true,
			});
		} else {
			// Actual failure (5xx, timeout, connection error): increment retry count
			const current = runtime.modelRetryState.get(key) || { retryCount: 0 };
			const newRetryCount = current.retryCount + 1;
			// After 3 failures, suspend for 24 hours
			const suspendedUntil = newRetryCount >= 3 
				? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
				: null;
			runtime.modelRetryState.set(key, {
				retryCount: newRetryCount,
				lastTestAt: new Date().toISOString(),
				suspendedUntil,
			});
		}

		// Small delay between tests to avoid rate limiting
		await new Promise(r => setTimeout(r, 500));
	}

	runtime.lastLatencyAt = Date.now();
	console.log('[tokito-monitor] full sweep complete');
}

// ─── Smart Retry: Retry sweep — test only offline models that aren't suspended ─

async function runRetrySweep() {
	if (!runtime.modelEntries.length) return;

	const entriesToRetry = [];
	for (const entry of runtime.modelEntries) {
		const key = entryKey(entry);
		const retryState = runtime.modelRetryState.get(key);

		if (!retryState) continue; // not tracked as offline
		if (retryState.isRateLimited) continue; // skip rate-limited models (429)
		if (retryState.retryCount >= 3) continue; // max retries reached, suspended for 24h

		if (retryState.suspendedUntil) {
			const suspendedUntil = new Date(retryState.suspendedUntil).getTime();
			if (Date.now() < suspendedUntil) continue; // still suspended
		}

		entriesToRetry.push(entry);
	}

	if (entriesToRetry.length === 0) return;

	console.log(`[tokito-monitor] retry sweep: testing ${entriesToRetry.length} offline models`);

	for (const entry of entriesToRetry) {
		const key = entryKey(entry);
		const latency = await testSingleModel(entry);
		runtime.latency.set(key, latency);
		await pushSingleModelStatus(entry, latency);

		if (latency.ok) {
			runtime.modelRetryState.delete(key);
			console.log(`[tokito-monitor] model back online: ${entry.modelId}`);
		} else if (latency.status === 429) {
			// Rate limited: mark as rate limited, don't count as failure
			runtime.modelRetryState.set(key, {
				retryCount: 0,
				lastTestAt: new Date().toISOString(),
				suspendedUntil: null,
				isRateLimited: true,
			});
		} else {
			const current = runtime.modelRetryState.get(key) || { retryCount: 0 };
			const newRetryCount = current.retryCount + 1;
			const suspendedUntil = newRetryCount >= 3 
				? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
				: null;
			runtime.modelRetryState.set(key, {
				retryCount: newRetryCount,
				lastTestAt: new Date().toISOString(),
				suspendedUntil,
			});
		}
	}

	runtime.lastLatencyAt = Date.now();
	console.log('[tokito-monitor] retry sweep complete');
}

// ─── Smart Retry: Midnight reset — clear all retry states ─────────────────────

async function midnightReset() {
	try {
		await proxyInternal('/admin/internal/monitor/models/state/reset', 'PATCH');
		runtime.modelRetryState.clear();
		console.log('[tokito-monitor] midnight reset complete — all models eligible for testing');
	} catch (err) {
		console.error('[tokito-monitor] midnight reset failed:', err.message);
	}
}

// ─── Smart Retry: Recover retry state from proxy on bot startup ───────────────

async function recoverRetryState() {
	try {
		const data = await proxyInternal('/admin/internal/monitor/models/state', 'GET');
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
			console.log(`[tokito-monitor] recovered retry state for ${states.length} models`);
		}
	} catch (err) {
		console.error('[tokito-monitor] failed to recover retry state:', err.message);
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
		console.log(`[tokito-monitor] next midnight reset in ${Math.round(delay / 60000)} minutes`);
		setTimeout(async () => {
			await midnightReset();
			scheduleNext(); // schedule the next one
		}, delay);
	}

	scheduleNext();
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
	);
}

function buildPanelEmbed() {
	return new EmbedBuilder()
		.setTitle('API Checker Panel')
		.setColor(0x3498db)
		.setDescription(
			'Monitoring endpoint Tokito untuk validasi status model AI dan performa respons secara berkala.',
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
					'Klik `Model Status` untuk melihat online/offline per model, atau `Latency Benchmark` untuk melihat waktu respons terbaru.',
				inline: false,
			},
			{
				name: 'Current Active Endpoint',
				value: PROXY_PUBLIC_BASE_URL,
				inline: false,
			},
		)
		.setFooter({
			text: `Groupy API: ${PROXY_PUBLIC_BASE_URL}`,
		});
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
	const channel = await client.channels
		.fetch(TOKITO_CHANNEL_ID)
		.catch((e) => {
			console.error('[tokito] Failed to fetch channel:', e.message);
			return null;
		});
	if (!channel || !channel.isTextBased()) {
		console.log('[tokito] ensurePanelMessage: Channel not found or not text based. ID:', TOKITO_CHANNEL_ID);
		return;
	}

	const recent = await channel.messages.fetch({ limit: 50 });
	const panelMessages = recent.filter(
		(msg) =>
			msg.author.id === client.user.id &&
			msg.components?.some((row) =>
				row.components?.some(
					(c) => c.customId === PANEL_STATUS || c.customId === PANEL_LATENCY,
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

function createTokitoSession(userId, kind) {
	// Cleanup previous sessions for this user to prevent memory leak
	for (const [key, sess] of tokitoSessions.entries()) {
		if (sess.userId === userId) {
			tokitoSessions.delete(key);
		}
	}

	const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const session = {
		id,
		userId,
		kind,
		page: 0,
		upstreamProvider: 'all',
		modelVendor: 'all',
		sortMode: 'status_online_first',
	};
	tokitoSessions.set(id, session);
	return session;
}

const { StringSelectMenuBuilder } = require('discord.js');
function buildTokitoRows(
	kind,
	sessionId,
	page,
	totalPages,
	upstreamProvider,
	modelVendor,
	sortMode,
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

	const upstreamOptions = ['all', ...new Set(runtime.modelEntries.map(e => e.provider))].slice(0, 25);
	const upstreamMenu = new StringSelectMenuBuilder()
		.setCustomId(`tokito_filter_upstream_${sessionId}`)
		.setPlaceholder('Upstream provider')
		.addOptions(
			upstreamOptions.map((p) => ({ label: p, value: p, default: p === upstreamProvider })),
		);

	let vendorSource = runtime.modelEntries;
	if (upstreamProvider !== 'all') {
		vendorSource = vendorSource.filter((e) => e.provider === upstreamProvider);
	}
	const vendorOptions = ['all', ...new Set(vendorSource.map((e) => providerOf(e.modelId)))].slice(0, 25);
	const vendorMenu = new StringSelectMenuBuilder()
		.setCustomId(`tokito_filter_vendor_${sessionId}`)
		.setPlaceholder('Model vendor (ag/minimax/...)')
		.addOptions(
			vendorOptions.map((v) => ({ label: v, value: v, default: v === modelVendor })),
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

function listModels(kind, upstreamProvider, modelVendor, sortMode) {
	let items = [...runtime.modelEntries];

	// Add auto model as a special entry at the beginning
	const autoEntry = {
		modelId: 'auto',
		provider: 'proxy',
		baseUrl: '',
		apiKey: '',
	};
	items.unshift(autoEntry);

	if (upstreamProvider !== 'all') {
		items = items.filter((e) => e.provider === upstreamProvider || e.modelId === 'auto');
	}
	if (modelVendor !== 'all') {
		items = items.filter((e) => providerOf(e.modelId) === modelVendor || e.modelId === 'auto');
	}

	items.sort((a, b) => a.modelId.localeCompare(b.modelId));
	// Keep auto at the top
	items.sort((a, b) => (a.modelId === 'auto' ? -1 : b.modelId === 'auto' ? 1 : 0));

	if (sortMode === 'status_online_first') {
		items.sort(
			(a, b) => {
				if (a.modelId === 'auto') return -1;
				if (b.modelId === 'auto') return 1;
				// Online first, then by latency (fastest first)
				const aOnline = runtime.latency.get(entryKey(a))?.ok ? 0 : 1;
				const bOnline = runtime.latency.get(entryKey(b))?.ok ? 0 : 1;
				if (aOnline !== bOnline) return aOnline - bOnline;
				const am = runtime.latency.get(entryKey(a))?.ms ?? Number.MAX_SAFE_INTEGER;
				const bm = runtime.latency.get(entryKey(b))?.ms ?? Number.MAX_SAFE_INTEGER;
				return am - bm;
			},
		);
	}
	if (sortMode === 'provider_asc') {
		items.sort((a, b) => {
			if (a.modelId === 'auto') return -1;
			if (b.modelId === 'auto') return 1;
			return (a.provider || '').localeCompare(b.provider || '') || a.modelId.localeCompare(b.modelId);
		});
	}
	if (sortMode === 'latency_fastest' || sortMode === 'latency_slowest') {
		items.sort((a, b) => {
			if (a.modelId === 'auto') return -1;
			if (b.modelId === 'auto') return 1;
			const am = runtime.latency.get(entryKey(a))?.ms ?? Number.MAX_SAFE_INTEGER;
			const bm = runtime.latency.get(entryKey(b))?.ms ?? Number.MAX_SAFE_INTEGER;
			return sortMode === 'latency_fastest' ? am - bm : bm - am;
		});
	}
	return items;
}

function buildTokitoEmbed(kind, session) {
	const entries = listModels(kind, session.upstreamProvider, session.modelVendor, session.sortMode);
	const totalPages = Math.max(1, Math.ceil(entries.length / TOKITO_PAGE_SIZE));
	const page = Math.max(0, Math.min(session.page, totalPages - 1));
	session.page = page;

	const slice = entries.slice(
		page * TOKITO_PAGE_SIZE,
		(page + 1) * TOKITO_PAGE_SIZE,
	);
	const lines = slice.map((entry) => {
		// Auto model: show special description
		if (entry.modelId === 'auto') {
			return `🤖 \`auto\` | **Auto-select**: picks fastest online model automatically | Use \`model: auto\` in your request`;
		}

		const key = entryKey(entry);
		const vendor = providerOf(entry.modelId);
		const lt = runtime.latency.get(key);
		
		if (kind === 'status') {
			if (!lt || lt.status == null) {
				return `⚪ \`${entry.provider}/${entry.modelId}\` | not tested yet | vendor: **${vendor}**`;
			}
			const icon = lt.ok ? '🟢' : (lt.status === 429 ? '🟡' : '🔴');
			const httpInfo = lt.status === 429 ? 'rate limited' : (lt.status ? `HTTP ${lt.status}` : 'timeout');
			return `${icon} \`${entry.provider}/${entry.modelId}\` | ${httpInfo} | vendor: **${vendor}**`;
		}
		
		if (!lt) return `⚪ \`${entry.provider}/${entry.modelId}\` | not tested yet`;
		const icon = lt.ok ? '🟢' : (lt.status === 429 ? '🟡' : '🔴');
		const statusInfo = lt.status === 429 ? 'rate limited' : `HTTP ${lt.status}`;
		return `${icon} \`${entry.provider}/${entry.modelId}\` | ${lt.ms} ms | ${statusInfo}`;
	});

	const titleStyled =
		kind === 'status'
			? 'Tokito API • Model Status'
			: 'Tokito API • Latency Benchmark';
	const updatedAt = runtime.lastLatencyAt;

	let online = 0,
		down = 0,
		timeout = 0,
		rateLimited = 0,
		untested = 0;
	for (const entry of runtime.modelEntries) {
		// Skip auto model in counts
		if (entry.modelId === 'auto') continue;
		const key = entryKey(entry);
		const lt = runtime.latency.get(key);
		if (!lt) {
			untested += 1;
			continue;
		}
		if (lt.status === 0 || lt.status == null) timeout += 1;
		else if (lt.ok) online += 1;
		else if (lt.status === 429) rateLimited += 1;
		else down += 1;
	}

	const summaryParts = [`Online: ${online}`, `Down: ${down}`, `Timeout: ${timeout}`];
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
			{ name: 'Upstream', value: session.upstreamProvider, inline: true },
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

		const button = new ButtonBuilder()
			.setCustomId('create_agverif_ticket')
			.setLabel('🔐 Verifikasi Antigravity')
			.setStyle(ButtonStyle.Primary);

		const row = new ActionRowBuilder().addComponents(button);

		const embed = new EmbedBuilder()
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
		if (err.code !== 'ENOENT') console.error('[ranking] Failed to load ranking state:', err);
		rankingState = { channelId: null, messages: { modelByRequests: null, modelByTokens: null, userByRequests: null, userByTokens: null, searchUser: null } };
	}
}

async function saveRankingState() {
	try {
		await fs.mkdir(AGVERIF_DATA_DIR, { recursive: true });
		await fs.writeFile(RANKING_STATE_PATH, JSON.stringify(rankingState, null, 2), 'utf8');
	} catch (err) {
		console.error('[ranking] Failed to save ranking state:', err);
	}
}

// ─── Build Ranking Embeds ──────────────────────────────────────────────────────
function buildRankingEmbed(title, color, todayItems, monthItems, formatItem) {
	const todayLines = todayItems.length
		? todayItems.map((item, i) => `**${i + 1}.** ${formatItem(item)}`).join('\n')
		: '_Belum ada data_';
	const monthLines = monthItems.length
		? monthItems.map((item, i) => `**${i + 1}.** ${formatItem(item)}`).join('\n')
		: '_Belum ada data_';

	return new EmbedBuilder()
		.setTitle(title)
		.setColor(color)
		.addFields(
			{ name: '📅 Hari Ini', value: todayLines.slice(0, 1000), inline: true },
			{ name: '📆 Bulan Ini', value: monthLines.slice(0, 1000), inline: true },
		)
		.setFooter({ text: `🔄 Auto-refresh setiap 1 menit  •  ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` });
}

function buildSearchEmbed() {
	return new EmbedBuilder()
		.setTitle('🔍 Cari Usage User')
		.setDescription(
			'Klik tombol di bawah untuk mencari data penggunaan API seorang user.\n' +
			'Masukkan **Discord User ID** saat diminta.',
		)
		.setColor(0x57f287);
}

function buildSearchRow() {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('ranking_search_user')
			.setLabel('🔍 Cari Usage User')
			.setStyle(ButtonStyle.Primary),
	);
}

// ─── Refresh Ranking Embeds ────────────────────────────────────────────────────
async function refreshRankingEmbeds() {
	if (!AGVERIF_CHANNEL_ID) return;
	const { messages } = rankingState;
	if (!messages.modelByRequests || !messages.modelByTokens || !messages.userByRequests || !messages.userByTokens) return;

	let ranking;
	try {
		ranking = await proxyInternal('/admin/internal/stats/ranking');
	} catch (err) {
		console.error('[ranking] Failed to fetch ranking data:', err.message);
		return;
	}

	const channel = await client.channels.fetch(AGVERIF_CHANNEL_ID).catch(() => null);
	if (!channel || !channel.isTextBased()) return;

	const { today, month } = ranking;

	// Embed 1: Top Models by Requests
	try {
		const msg = await channel.messages.fetch(messages.modelByRequests).catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'🏆 Top Models — By Requests',
				0x5865f2,
				today.topModelsByRequests,
				month.topModelsByRequests,
				(item) => `\`${item.model}\` — **${item.count.toLocaleString()}** req`,
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) { console.error('[ranking] Edit modelByRequests failed:', err.message); }

	// Embed 2: Top Models by Tokens
	try {
		const msg = await channel.messages.fetch(messages.modelByTokens).catch(() => null);
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
	} catch (err) { console.error('[ranking] Edit modelByTokens failed:', err.message); }

	// Embed 3: Top Users by Requests
	try {
		const msg = await channel.messages.fetch(messages.userByRequests).catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'👤 Top Users — By Requests',
				0x22d3ee,
				today.topUsersByRequests,
				month.topUsersByRequests,
				(item) => {
					let name = item.discordUsername || 'Unknown';
					if (item.discordUserId && item.discordUsername === item.discordUserId) {
						name = `<@${item.discordUserId}>`;
					}
					return `**${name}** — **${item.requests.toLocaleString()}** req`;
				},
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) { console.error('[ranking] Edit userByRequests failed:', err.message); }

	// Embed 4: Top Users by Tokens
	try {
		const msg = await channel.messages.fetch(messages.userByTokens).catch(() => null);
		if (msg) {
			const embed = buildRankingEmbed(
				'👤 Top Users — By Tokens',
				0x10b981,
				today.topUsersByTokens,
				month.topUsersByTokens,
				(item) => {
					let name = item.discordUsername || 'Unknown';
					if (item.discordUserId && item.discordUsername === item.discordUserId) {
						name = `<@${item.discordUserId}>`;
					}
					return `**${name}** — ${formatTokens(item.tokens)} tok (📥 ${formatTokens(item.promptTokens || 0)} / 📤 ${formatTokens(item.completionTokens || 0)})`;
				},
			);
			await msg.edit({ embeds: [embed] });
		}
	} catch (err) { console.error('[ranking] Edit userByTokens failed:', err.message); }
}

// ─── Ensure Ranking Messages (check/repair/create) ────────────────────────────
async function ensureRankingMessages() {
	if (!AGVERIF_CHANNEL_ID) {
		console.log('[ranking] AGVERIF_CHANNEL_ID not set, skipping ranking setup.');
		return;
	}

	const channel = await client.channels.fetch(AGVERIF_CHANNEL_ID).catch((e) => {
		console.error('[ranking] Failed to fetch channel:', e.message);
		return null;
	});
	if (!channel || !channel.isTextBased()) {
		console.log('[ranking] Channel not found or not text-based.');
		return;
	}

	// Check if all 5 messages exist, are from this bot, and are in correct order
	const { messages } = rankingState;
	const msgIds = [messages.modelByRequests, messages.modelByTokens, messages.userByRequests, messages.userByTokens, messages.searchUser];
	const allExist = msgIds.every(Boolean);

	let valid = false;
	let existingMsgs = [];

	if (allExist) {
		try {
			existingMsgs = await Promise.all(msgIds.map((id) => channel.messages.fetch(id).catch(() => null)));
			// All must exist, be from bot, and be in ascending time order
			const allFound = existingMsgs.every((m) => m && m.author.id === client.user.id);
			if (allFound) {
				// Check order: each message must be newer than the previous
				const timestamps = existingMsgs.map((m) => m.createdTimestamp);
				const inOrder = timestamps.every((t, i) => i === 0 || t > timestamps[i - 1]);
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

		// Also delete old agverif setup message so we resend it below the new ones
		if (client.agverifData.setupState.messageId) {
			try {
				const oldVerif = await channel.messages.fetch(client.agverifData.setupState.messageId).catch(() => null);
				if (oldVerif && oldVerif.author.id === client.user.id) await oldVerif.delete();
			} catch {}
			client.agverifData.setupState.messageId = null;
			await saveSetupState();
		}

		// Initial embed content (will be refreshed right after)
		const placeholder = new EmbedBuilder().setTitle('⏳ Loading...').setDescription('Data sedang dimuat...').setColor(0x888888);

		const m1 = await channel.send({ embeds: [placeholder] });
		const m2 = await channel.send({ embeds: [placeholder] });
		const m3 = await channel.send({ embeds: [placeholder] });
		const m4 = await channel.send({ embeds: [placeholder] });
		const m5 = await channel.send({
			embeds: [buildSearchEmbed()],
			components: [buildSearchRow()],
		});

		rankingState.channelId = AGVERIF_CHANNEL_ID;
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
	await refreshRankingEmbeds().catch((e) => console.error('[ranking] Initial refresh failed:', e.message));
}

// ─── Handle Search User Interaction ───────────────────────────────────────────
async function handleRankingSearchButton(interaction) {
	const modal = new ModalBuilder()
		.setCustomId('ranking_search_user_modal')
		.setTitle('🔍 Cari Usage User');

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
	const discordUserId = interaction.fields.getTextInputValue('discord_user_id').trim();
	await interaction.deferReply({ ephemeral: true });

	let data;
	try {
		data = await proxyInternal(`/admin/internal/stats/user-detail/${discordUserId}`);
	} catch (err) {
		const msg = err.message || 'Unknown error';
		if (msg.includes('User not found') || msg.includes('404')) {
			await interaction.editReply({ content: `❌ User dengan ID \`${discordUserId}\` tidak ditemukan atau belum memiliki API key.` });
		} else {
			await interaction.editReply({ content: `❌ Gagal mengambil data: ${msg}` });
		}
		return;
	}

	const { discordUsername, isActive, keyPrefix, today, month, promptLimit, promptLimitWindow, promptUsed, promptResetMins, modelUsage, perModelPromptLimit, perModelPromptLimitWindow, dailyTokenLimit, monthlyTokenLimit, dailyTokensUsed, monthlyTokensUsed, dailyInputTokenLimit, dailyOutputTokenLimit, dailyInputUsed, dailyOutputUsed } = data;
	const displayName = discordUsername || `User ${discordUserId}`;

	function periodField(p) {
		const lines = [
			`📨 Requests: **${p.requests.toLocaleString()}**`,
			`🔢 Total Tokens: **${formatTokens(p.tokens)}**`,
			`📥 Input: **${formatTokens(p.promptTokens)}**`,
			`📤 Output: **${formatTokens(p.completionTokens)}**`,
			// Context tokens removed
			`💰 Est. Cost: **${formatCostMicro(p.estimatedCost)}**`,
		];
		if (p.topModels && p.topModels.length > 0) {
			lines.push(`\n**Top Models:**`);
			p.topModels.forEach((m) => {
				lines.push(`\`${m.model}\` (${m.requests.toLocaleString()} req, ${formatTokens(m.tokens)} tok)`);
			});
		}
		return lines.join('\n');
	}

	const globalLimitStr = promptLimit > 0 
		? `**${promptUsed} / ${promptLimit}** req (${promptLimitWindow})` + (promptUsed >= promptLimit ? ` 🔴 Resets in ~${promptResetMins}m` : '')
		: '**Unlimited**';

	let modelLimitStr = '';
	if (modelUsage && modelUsage.length > 0) {
		const activeModels = modelUsage.filter((m) => m.used > 0 || m.limit > 0);
		if (activeModels.length > 0) {
			modelLimitStr = activeModels.map(m => 
				`- \`${m.model}\`: **${m.used} / ${m.limit > 0 ? m.limit : '∞'}**` + (m.limit > 0 && m.used >= m.limit ? ` 🔴 Resets in ~${m.resetMins}m` : '')
			).join('\n');
		} else {
			modelLimitStr = perModelPromptLimit > 0 ? `Default: **${perModelPromptLimit}** req (${perModelPromptLimitWindow})` : '**Unlimited**';
		}
	} else {
		modelLimitStr = perModelPromptLimit > 0 ? `Default: **${perModelPromptLimit}** req (${perModelPromptLimitWindow})` : '**Unlimited**';
	}

	const dailyTokenStr = dailyTokenLimit > 0
		? `**${formatTokens(dailyTokensUsed)} / ${formatTokens(dailyTokenLimit)}**` + (dailyTokensUsed >= dailyTokenLimit ? ' 🔴 Limit Reached' : '')
		: `**${formatTokens(dailyTokensUsed)} / Unlimited**`;
	const monthlyTokenStr = monthlyTokenLimit > 0
		? `**${formatTokens(monthlyTokensUsed)} / ${formatTokens(monthlyTokenLimit)}**` + (monthlyTokensUsed >= monthlyTokenLimit ? ' 🔴 Limit Reached' : '')
		: `**${formatTokens(monthlyTokensUsed)} / Unlimited**`;
	const dailyInputStr = dailyInputTokenLimit > 0
		? `**${formatTokens(dailyInputUsed)} / ${formatTokens(dailyInputTokenLimit)}**` + (dailyInputUsed >= dailyInputTokenLimit ? ' 🔴' : '')
		: `**${formatTokens(dailyInputUsed)} / Unlimited**`;
	const dailyOutputStr = dailyOutputTokenLimit > 0
		? `**${formatTokens(dailyOutputUsed)} / ${formatTokens(dailyOutputTokenLimit)}**` + (dailyOutputUsed >= dailyOutputTokenLimit ? ' 🔴' : '')
		: `**${formatTokens(dailyOutputUsed)} / Unlimited**`;

	const isSelf = interaction.user.id === discordUserId;
	const keyDisplay = isSelf ? (data.key || `${keyPrefix}...`) : '[HIDDEN]';

	const embed = new EmbedBuilder()
		.setTitle(`📊 Usage: ${displayName}`)
		.setDescription(`Discord ID: \`${discordUserId}\`\nAPI Key: \`${keyDisplay}\`\nStatus: ${isActive ? '🟢 Active' : '🔴 Inactive'}\n\n**🎯 Prompt Limits**\nGlobal: ${globalLimitStr}\nPer-Model:\n${modelLimitStr}\n\n**🔢 Token Limits**\nInput Harian: ${dailyInputStr}\nOutput Harian: ${dailyOutputStr}\nTotal Harian: ${dailyTokenStr}\nBulanan: ${monthlyTokenStr}`)
		.setColor(isActive ? 0x57f287 : 0xff6b6b)
		.addFields(
			{ name: '📅 Hari Ini', value: periodField(today), inline: true },
			{ name: '📆 Bulan Ini', value: periodField(month), inline: true },
		)
		.setTimestamp();

	await interaction.editReply({ embeds: [embed] });
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
	await setupVerificationButton();
	startPhotoCheckInterval();
	startRoleSyncInterval();

	// Start 1-minute ranking refresh
	setInterval(() => {
		refreshRankingEmbeds().catch((err) =>
			console.error('[ranking] Refresh error:', err.message),
		);
	}, RANKING_REFRESH_INTERVAL_MS);

	if (TOKITO_API_KEY) {
		console.log(`[tokito] Monitor active. Panel Channel ID: ${TOKITO_CHANNEL_ID}`);
		await ensurePanelMessage();
		await pollModelStatus();
		await recoverRetryState();
		await runFullSweep();

		// Full sweep: every 1 hour (test all models)
		setInterval(() => {
			runFullSweep().catch((err) =>
				console.error('runFullSweep error:', err.message),
			);
		}, 3600000);

		// Retry sweep: every 10 minutes (test only offline models)
		setInterval(() => {
			runRetrySweep().catch((err) =>
				console.error('runRetrySweep error:', err.message),
			);
		}, 600000);

		// Midnight reset: reset retry counts at 00:00 Asia/Jakarta
		scheduleMidnightReset();
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
				if (!notif.discordUserId || !notif.newKey) continue;
				try {
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
							client.agverifData?.verifiedUsers?.[notif.discordUserId]?.threadId ||
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
								console.error(`[notify] Failed to send bulk rotate thread for ${notif.discordUserId}:`, err.message);
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

						await sendDMToUser(notif.discordUserId, '🔑 API Key Rotated — New Device Detected', dmText, 0xf59e0b);

						const threadId = client.agverifData?.verifiedUsers?.[notif.discordUserId]?.threadId;
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
								console.error(`[notify] Failed to send thread message for ${notif.discordUserId}:`, err.message);
							}
						}
					}

					await proxyInternal(`/admin/internal/clear-notification/${notif.keyId}`, 'POST');
				} catch (err) {
					console.error(`[notify] Failed to process notification for ${notif.discordUserId}:`, err.message);
				}
			}
		} catch (err) {
			console.error('[notify] Failed to poll pending notifications:', err.message);
		}
	}

	// Run immediately then every 30 seconds
	void processPendingNotifications();
	setInterval(() => {
		processPendingNotifications().catch(err =>
			console.error('[notify] Poll error:', err.message)
		);
	}, 30000);
});

client.on('interactionCreate', async (interaction) => {
	try {
		// ─── Ranking Search Button ───────────────────────────────────────────
		if (interaction.isButton() && interaction.customId === 'ranking_search_user') {
			await handleRankingSearchButton(interaction);
			return;
		}

		// ─── Ranking Search Modal Submit ─────────────────────────────────────
		if (interaction.isModalSubmit() && interaction.customId === 'ranking_search_user_modal') {
			await handleRankingSearchModal(interaction);
			return;
		}

		if (interaction.isButton()) {
			if (interaction.customId === 'create_agverif_ticket') {
				const member = interaction.member;
				const userId = interaction.user.id;

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
					// Jika user memang masih punya role verif, anggap sudah terverifikasi
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
				interaction.customId === PANEL_LATENCY
			) {
				const kind =
					interaction.customId === PANEL_STATUS ? 'status' : 'latency';
				
				// Immediately acknowledge to prevent 10s timeout
				await interaction.deferReply({ ephemeral: true });
				
				// Refresh data from proxy DB for fresh results
				await refreshLatencyFromProxy();
				
				const session = createTokitoSession(interaction.user.id, kind);
				// Store interaction for message deletion on expiry
				session.interaction = interaction;
				const { embed, components } = buildTokitoEmbed(kind, session);
				
				// Edit with actual results
				await interaction.editReply({
					embeds: [embed],
					components,
				});
				return;
			}

			const match = interaction.customId.match(
				/^tokito_(prev|next|close)_(.+)$/,
			);
			if (!match) return;

			const action = match[1];
			const sessionId = match[2];
			const session = tokitoSessions.get(sessionId);
			if (
				!session ||
				session.userId !== interaction.user.id
			) {
				try {
					// ALWAYS defer the update immediately so Discord doesn't throw "Unknown interaction"
					await interaction.deferUpdate().catch(() => {});
					if (interaction.message && interaction.message.deletable) {
						await interaction.message.delete().catch(() => {});
					} else {
						await interaction.deleteReply().catch(() => {});
					}
				} catch (err) {
					console.error("Failed to delete expired tokito interaction:", err);
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
			const sessionId = upstreamMatch?.[1] || vendorMatch?.[1] || sortMatch?.[1];
			
			if (!sessionId) {
				console.warn("tokito interaction: no session ID found in customId", interaction.customId);
				// Acknowledge to prevent unknown interaction if it somehow drops through
				await interaction.deferUpdate().catch(() => {});
				if (interaction.message && interaction.message.deletable) {
					await interaction.message.delete().catch(() => {});
				}
				return;
			}

			const session = tokitoSessions.get(sessionId);
			if (
				!session ||
				session.userId !== interaction.user.id
			) {
				try {
					// ALWAYS defer the update immediately so Discord doesn't throw "Unknown interaction"
					await interaction.deferUpdate().catch(() => {});
					if (interaction.message && interaction.message.deletable) {
						await interaction.message.delete().catch(() => {});
					} else {
						await interaction.deleteReply().catch(() => {});
					}
				} catch (err) {
					console.error("Failed to delete expired tokito interaction:", err);
				}
				return;
			}

			if (upstreamMatch) {
				session.upstreamProvider = interaction.values[0] || 'all';
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
							const endpoint = provision.endpoint || `${PROXY_PUBLIC_BASE_URL}/v1`;
							// Send DM (non-critical — may fail if user has DMs disabled)
							try {
								await sendApiCredentialsDm(
									newMember.id,
									provision.apiKey,
									endpoint,
								);
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
								console.warn('[agverif] DM failed, sending key in thread:', dmErr.message);
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
					return;
				}

				let verifiedRoleName = 'Role verifikasi';
				try {
					const verifiedRole =
						await newMember.guild.roles.fetch(VERIFIED_ROLE_ID);
					if (verifiedRole) {
						verifiedRoleName = `role **${verifiedRole.name}**`;
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
					'⚠️ Role Verifikasi Dicabut',
					`${verifiedRoleName} antigravity Anda telah dicabut.\n\n` +
						'Jika ini adalah kesalahan, silakan hubungi admin.',
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
