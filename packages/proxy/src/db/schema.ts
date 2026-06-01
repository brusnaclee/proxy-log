import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

// ─── Admin Configuration ───────────────────────────────────────────────────────
export const adminConfig = sqliteTable('admin_config', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	passwordHash: text('password_hash').notNull(),
	upstreamEndpoint: text('upstream_endpoint')
		.notNull()
		.default('https://api.openai.com'),
	upstreamApiKey: text('upstream_api_key').notNull().default(''),
	globalMaxDevices: integer('global_max_devices').default(0),
	realtimeEnabled: integer('realtime_enabled', { mode: 'boolean' }).default(
		false,
	),
	globalRateLimit: integer('global_rate_limit').default(0), // requests per window (0 = unlimited)
	globalRateLimitWindow: text('global_rate_limit_window').default('1h'), // e.g., '1h', '30m', '1d'
	globalPromptLimit: integer('global_prompt_limit').default(0), // prompts per window (0 = unlimited)
	globalPromptLimitWindow: text('global_prompt_limit_window').default('1d'), // e.g., '1h', '1d'
	globalPerModelPromptLimit: integer('global_per_model_prompt_limit').default(
		0,
	), // default per-model limit (0 = unlimited)
	globalPerModelPromptLimitWindow: text(
		'global_per_model_prompt_limit_window',
	).default('1d'),
	globalDailyTokenLimit: integer('global_daily_token_limit').default(0), // deprecated, kept for compat
	globalMonthlyTokenLimit: integer('global_monthly_token_limit').default(0), // deprecated, kept for compat
	globalDailyInputTokenLimit: integer('global_daily_input_token_limit').default(
		0,
	),
	globalDailyOutputTokenLimit: integer(
		'global_daily_output_token_limit',
	).default(0),

	// Bot & Tokito Settings
	discordBotToken: text('discord_bot_token').default(''),
	agverifChannelId: text('agverif_channel_id').default(''),
	tokitoChannelId: text('tokito_channel_id').default(''),
	requiredRoleId: text('required_role_id').default(''),
	ownerGroupyRoleId: text('owner_groupy_role_id').default(''),
	verifiedRoleId: text('verified_role_id').default(''),
	geminiApiKey: text('gemini_api_key').default(''),
	verifAutoEnabled: integer('verif_auto_enabled', { mode: 'boolean' }).default(
		false,
	),
	tokitoApiKey: text('tokito_api_key').default(''),

	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`),
});

// ─── API Keys ──────────────────────────────────────────────────────────────────
export const apiKeys = sqliteTable('api_keys', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().default(''),
	key: text('key').notNull().unique(), // full key for lookup: sk-proxy-xxxx
	keyPrefix: text('key_prefix').notNull(), // first 8 chars for display
	keyHash: text('key_hash').notNull(), // sha256 hash for verification
	discordUserId: text('discord_user_id'), // Discord user owner for bot-managed keys
	discordUsername: text('discord_username'),
	provisionedBy: text('provisioned_by').notNull().default('dashboard'), // dashboard | discord-bot
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	maxDevices: integer('max_devices').default(0), // 0 = unlimited
	devicePolicy: text('device_policy').notNull().default('none'), // none | allowlist | blacklist
	ipPolicy: text('ip_policy').notNull().default('none'), // none | allowlist | blacklist
	idePolicy: text('ide_policy').notNull().default('none'), // none | allowlist | blacklist
	monthlyTokenLimit: integer('monthly_token_limit').default(0), // 0 = unlimited
	rateLimit: integer('rate_limit').default(0), // overrides global if > 0
	rateLimitWindow: text('rate_limit_window'), // overrides global if set
	promptLimit: integer('prompt_limit').default(0), // overrides global prompt limit if > 0
	promptLimitWindow: text('prompt_limit_window'), // overrides global prompt limit window if set
	promptWindowStart: text('prompt_window_start'), // tracks when the current global prompt window started
	perModelPromptLimit: integer('per_model_prompt_limit').default(0), // overrides global per-model limit if > 0
	perModelPromptLimitWindow: text('per_model_prompt_limit_window'), // overrides global per-model window if set
	dailyTokenLimit: integer('daily_token_limit').default(0), // per-key override
	dailyInputTokenLimit: integer('daily_input_token_limit').default(0), // per-key override
	dailyOutputTokenLimit: integer('daily_output_token_limit').default(0), // per-key override
	pendingNotification: text('pending_notification'), // JSON: { type, discordUserId, threadId, newKey, endpoint, message }
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`),
});

// ─── Allowed/Blocked Devices (per API key) ─────────────────────────────────────
export const allowedDevices = sqliteTable('allowed_devices', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	apiKeyId: integer('api_key_id')
		.notNull()
		.references(() => apiKeys.id, { onDelete: 'cascade' }),
	fingerprint: text('fingerprint'), // device hash (nullable if IP-only rule)
	ipAddress: text('ip_address'), // IP address (nullable if device-only rule)
	label: text('label').default(''), // human-readable label
	listType: text('list_type').notNull(), // "allow" | "block"
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
});

// ─── Allowed/Blocked IDEs (per API key) ───────────────────────────────────────
export const allowedIdes = sqliteTable(
	'allowed_ides',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		apiKeyId: integer('api_key_id')
			.notNull()
			.references(() => apiKeys.id, { onDelete: 'cascade' }),
		ideName: text('ide_name').notNull(), // normalized ide name, e.g. "cursor"
		listType: text('list_type').notNull(), // "allow" | "block"
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		apiKeyIdeIdx: index('idx_allowed_ides_api_key_ide').on(
			table.apiKeyId,
			table.ideName,
		),
	}),
);

// ─── Request Logs ──────────────────────────────────────────────────────────────
export const requestLogs = sqliteTable(
	'request_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		apiKeyId: integer('api_key_id'),
		apiKeyName: text('api_key_name'),
		userAgentRaw: text('user_agent_raw'),
		osDetected: text('os_detected'),
		clientName: text('client_name'),
		ipAddress: text('ip_address'),
		deviceFingerprint: text('device_fingerprint'),
		ideDetected: text('ide_detected'),
		provider: text('provider'),
		endpointPath: text('endpoint_path'),
		sessionId: text('session_id'),
		turnId: text('turn_id'), // tracks which turn this request belongs to
		model: text('model'),
		promptTokens: integer('prompt_tokens').default(0),
		completionTokens: integer('completion_tokens').default(0),
		totalTokens: integer('total_tokens').default(0),
		cachedTokens: integer('cached_tokens').default(0),
		contextFingerprint: text('context_fingerprint'),
		contextTokensBefore: integer('context_tokens_before').default(0),
		contextDeltaTokens: integer('context_delta_tokens').default(0),
		contextEvent: text('context_event'),
		toolsUsed: text('tools_used'),
		toolCount: integer('tool_count').default(0),
		hasToolCalls: integer('has_tool_calls', { mode: 'boolean' }).default(false),
		requestPreview: text('request_preview'),
		responsePreview: text('response_preview'),
		transcriptSnapshot: text('transcript_snapshot'),
		estimatedContextLength: integer('estimated_context_length').default(0),
		messageRole: text('message_role'),
		userMessageHash: text('user_message_hash'),
		actualToolCallsInResponse: integer('actual_tool_calls_in_response', {
			mode: 'boolean',
		}).default(false),
		isCountedRequest: integer('is_counted_request', {
			mode: 'boolean',
		}).default(true),
		isBillableToken: integer('is_billable_token', { mode: 'boolean' }).default(
			false,
		),
		latencyMs: integer('latency_ms').default(0),
		statusCode: integer('status_code').default(0),
		errorMessage: text('error_message'),
		estimatedCost: integer('estimated_cost').default(0), // in micro-cents or micro-dollars. Let's use millionths of a dollar (e.g., 1000000 = $1.00)
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		createdAtIdx: index('idx_logs_created_at').on(table.createdAt),
		apiKeyIdIdx: index('idx_logs_api_key_id').on(table.apiKeyId),
		deviceFingerprintIdx: index('idx_logs_device_fingerprint').on(
			table.deviceFingerprint,
		),
		ipAddressIdx: index('idx_logs_ip_address').on(table.ipAddress),
		sessionIdIdx: index('idx_logs_session_id').on(table.sessionId),
		providerIdx: index('idx_logs_provider').on(table.provider),
		// Composite indexes for performance on hot-path queries (rate limiting, stats)
		keyCreatedIdx: index('idx_logs_key_created').on(
			table.apiKeyId,
			table.createdAt,
		),
		keyCreatedCountedIdx: index('idx_logs_key_created_counted').on(
			table.apiKeyId,
			table.createdAt,
			table.isCountedRequest,
		),
		keyCreatedModelIdx: index('idx_logs_key_created_model').on(
			table.apiKeyId,
			table.createdAt,
			table.model,
		),
		keyCreatedStatusIdx: index('idx_logs_key_created_status').on(
			table.apiKeyId,
			table.createdAt,
			table.statusCode,
		),
		// Covering index for turn-based aggregation queries (stats overview, by-key, timeseries)
		turnAggIdx: index('idx_logs_turn_agg').on(
			table.turnId,
			table.statusCode,
			table.createdAt,
		),
		modelIdx: index('idx_logs_model').on(table.model),
	}),
);

// ─── Chat Sessions (context-level observability) ───────────────────────────────
export const chatSessions = sqliteTable(
	'chat_sessions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sessionId: text('session_id').notNull().unique(),
		apiKeyId: integer('api_key_id'),
		apiKeyName: text('api_key_name'),
		ipAddress: text('ip_address'),
		deviceFingerprint: text('device_fingerprint'),
		ideDetected: text('ide_detected'),
		provider: text('provider'),
		model: text('model'),
		sessionName: text('session_name').default(''), // human-readable chat title derived from first user message
		contextFingerprint: text('context_fingerprint'),
		lastContextTokens: integer('last_context_tokens').notNull().default(0),
		requestCount: integer('request_count').notNull().default(0),
		promptCount: integer('prompt_count').notNull().default(0), // user prompt count (not tool/agent requests)
		totalTokens: integer('total_tokens').notNull().default(0),
		compactCount: integer('compact_count').notNull().default(0),
		switchCount: integer('switch_count').notNull().default(0),
		consecutiveToolFollowups: integer('consecutive_tool_followups').notNull().default(0),
		lastRequestPreview: text('last_request_preview'),
		estimatedCost: integer('estimated_cost').notNull().default(0), // millionths of a dollar
		lastUserMessageHash: text('last_user_message_hash'),
		lastMessageRole: text('last_message_role'),
		lastToolCallsActive: integer('last_tool_calls_active', {
			mode: 'boolean',
		}).default(false),
		firstSeenAt: text('first_seen_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		lastSeenAt: text('last_seen_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		apiKeyIdIdx: index('idx_sessions_api_key_id').on(table.apiKeyId),
		deviceFingerprintIdx: index('idx_sessions_device_fingerprint').on(
			table.deviceFingerprint,
		),
		lastSeenAtIdx: index('idx_sessions_last_seen_at').on(table.lastSeenAt),
		contextFingerprintIdx: index('idx_sessions_context_fingerprint').on(
			table.contextFingerprint,
		),
	}),
);

// ─── Devices Registry (unique devices per API key) ────────────────────────────
export const devices = sqliteTable(
	'devices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		apiKeyId: integer('api_key_id')
			.notNull()
			.references(() => apiKeys.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		ipAddress: text('ip_address'),
		userAgentRaw: text('user_agent_raw'),
		osDetected: text('os_detected'),
		deviceName: text('device_name'),
		ideDetected: text('ide_detected'),
		firstSeen: text('first_seen')
			.notNull()
			.default(sql`(datetime('now'))`),
		lastSeen: text('last_seen')
			.notNull()
			.default(sql`(datetime('now'))`),
		requestCount: integer('request_count').notNull().default(0),
		isBlocked: integer('is_blocked', { mode: 'boolean' })
			.notNull()
			.default(false),
	},
	(table) => ({
		apiKeyFingerprintIdx: index('idx_devices_api_key_fingerprint').on(
			table.apiKeyId,
			table.fingerprint,
		),
	}),
);

// ─── Providers ───────────────────────────────────────────────────────────────
export const providers = sqliteTable('providers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	endpoint: text('endpoint').notNull(),
	apiKey: text('api_key').notNull(), // legacy single key (kept for backward compat)
	endpointType: text('endpoint_type').notNull().default('openai'), // "openai" | "anthropic"
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	priority: integer('priority').notNull().default(0), // higher = higher priority
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`),
});

// ─── Provider API Keys (multi-key rotation per provider) ────────────────────
export const providerApiKeys = sqliteTable(
	'provider_api_keys',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		providerId: integer('provider_id')
			.notNull()
			.references(() => providers.id, { onDelete: 'cascade' }),
		apiKey: text('api_key').notNull(),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		isLimited: integer('is_limited', { mode: 'boolean' })
			.notNull()
			.default(false),
		limitedAt: text('limited_at'), // when rate limit was detected
		requestCount: integer('request_count').notNull().default(0), // for load balancing
		lastUsedAt: text('last_used_at'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		providerIdIdx: index('idx_provider_keys_provider_id').on(table.providerId),
	}),
);

// ─── Model Monitor ─────────────────────────────────────────────────────────────
export const modelMonitor = sqliteTable(
	'model_monitor',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		modelId: text('model_id').notNull(),
		provider: text('provider'),
		isOnline: integer('is_online', { mode: 'boolean' })
			.notNull()
			.default(false),
		latencyMs: integer('latency_ms').default(0),
		httpStatus: integer('http_status').default(0),
		errorMessage: text('error_message'),
		baseUrl: text('base_url'),
		checkedAt: text('checked_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		modelIdIdx: index('idx_monitor_model_id').on(table.modelId),
		checkedAtIdx: index('idx_monitor_checked_at').on(table.checkedAt),
	}),
);

// ─── Model Test State (retry tracking for offline models) ──────────────────────
export const modelTestState = sqliteTable(
	'model_test_state',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		modelId: text('model_id').notNull(),
		provider: text('provider'),
		retryCount: integer('retry_count').notNull().default(0),
		lastTestAt: text('last_test_at'),
		suspendedUntil: text('suspended_until'), // null = not suspended; ISO datetime = paused until then
	},
	(table) => ({
		uniqueModel: index('idx_test_state_model').on(
			table.modelId,
			table.provider,
		),
	}),
);

// ─── Model Prompt Limits (per-model overrides) ─────────────────────────────────
// scope="global" scopeId=0 → global override for a specific model
// scope="key"    scopeId=apiKeyId → per-key override for a specific model
export const modelLimits = sqliteTable(
	'model_limits',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		scope: text('scope').notNull().default('global'), // "global" | "key"
		scopeId: integer('scope_id').notNull().default(0), // 0 for global, api_key_id for per-key
		model: text('model').notNull(), // model ID e.g. "ag/claude-sonnet-4-6"
		promptLimit: integer('prompt_limit').notNull().default(0), // override limit for this model
		promptWindowStart: text('prompt_window_start'), // tracks when the current prompt window started
		dailyTokenLimit: integer('daily_token_limit').default(0),
		monthlyTokenLimit: integer('monthly_token_limit').default(0),
		dailyInputTokenLimit: integer('daily_input_token_limit').default(0),
		dailyOutputTokenLimit: integer('daily_output_token_limit').default(0),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		scopeModelIdx: index('idx_model_limits_scope_model').on(
			table.scope,
			table.scopeId,
			table.model,
		),
	}),
);

// ─── Cleanup State (tracks what has been cleaned) ──────────────────────────────
export const cleanupState = sqliteTable('cleanup_state', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	cleanupType: text('cleanup_type').notNull(), // "transcripts" | "3month"
	lastCleanupAt: text('last_cleanup_at'), // when last cleanup ran
	lastProcessedMonth: text('last_processed_month'), // "2026-01" format for 3-month cleanup
	cleanedMonths: text('cleaned_months').default('[]'), // JSON array of cleaned months ["2026-01", "2026-02"]
	cleanedDays: text('cleaned_days').default('[]'), // JSON array of cleaned days ["2026-05-27", "2026-05-28"]
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`),
});

// ─── Monthly Stats (archived aggregates before 3-month cleanup) ──────────────
// Stores pre-computed per-(month, api_key_id, model) aggregates so stats
// survive the 3-month rolling deletion of raw request_logs rows.
export const monthlyStats = sqliteTable(
	'monthly_stats',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		yearMonth: text('year_month').notNull(), // "2026-01" format
		apiKeyId: integer('api_key_id'), // null = global aggregate
		model: text('model').notNull().default('_all_'), // "_all_" = all models combined
		turnCount: integer('turn_count').notNull().default(0),
		inputTokens: integer('input_tokens').notNull().default(0), // context_delta sum
		outputTokens: integer('output_tokens').notNull().default(0), // completion_tokens sum
		totalTokens: integer('total_tokens').notNull().default(0),
		estimatedCost: integer('estimated_cost').notNull().default(0),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(datetime('now'))`),
	},
	(table) => ({
		ymKeyIdx: index('idx_monthly_stats_ym_key').on(
			table.yearMonth,
			table.apiKeyId,
			table.model,
		),
	}),
);

// ─── Type exports ──────────────────────────────────────────────────────────────
export type AdminConfig = typeof adminConfig.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type AllowedDevice = typeof allowedDevices.$inferSelect;
export type AllowedIde = typeof allowedIdes.$inferSelect;
export type RequestLog = typeof requestLogs.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type ProviderApiKey = typeof providerApiKeys.$inferSelect;
export type ModelMonitor = typeof modelMonitor.$inferSelect;
export type ModelTestState = typeof modelTestState.$inferSelect;
export type ModelLimit = typeof modelLimits.$inferSelect;
export type CleanupState = typeof cleanupState.$inferSelect;
export type MonthlyStats = typeof monthlyStats.$inferSelect;

export type NewAdminConfig = typeof adminConfig.$inferInsert;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type NewAllowedDevice = typeof allowedDevices.$inferInsert;
export type NewAllowedIde = typeof allowedIdes.$inferInsert;
export type NewRequestLog = typeof requestLogs.$inferInsert;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type NewDevice = typeof devices.$inferInsert;
export type NewProvider = typeof providers.$inferInsert;
export type NewProviderApiKey = typeof providerApiKeys.$inferInsert;
export type NewModelMonitor = typeof modelMonitor.$inferInsert;
export type NewModelTestState = typeof modelTestState.$inferInsert;
export type NewModelLimit = typeof modelLimits.$inferInsert;
export type NewCleanupState = typeof cleanupState.$inferInsert;
export type NewMonthlyStats = typeof monthlyStats.$inferInsert;
