import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, boolean, serial, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Admin Configuration ───────────────────────────────────────────────────────
export const adminConfig = pgTable('admin_config', {
	id: serial('id').primaryKey(),
	passwordHash: text('password_hash').notNull(),
	upstreamEndpoint: text('upstream_endpoint').notNull().default('https://api.openai.com'),
	upstreamApiKey: text('upstream_api_key').notNull().default(''),
	globalMaxDevices: integer('global_max_devices').default(0),
	realtimeEnabled: boolean('realtime_enabled').default(false),
	globalRateLimit: integer('global_rate_limit').default(1000),
	globalRateLimitWindow: text('global_rate_limit_window').default('5h'),
	globalPromptLimit: integer('global_prompt_limit').default(50),
	globalPromptLimitWindow: text('global_prompt_limit_window').default('5h'),
	/** Percent of each hop In+Out applied to daily/monthly token limits (1–100). Logs stay 100%. */
	tokenLimitWeightPercent: integer('token_limit_weight_percent').notNull().default(10),
	globalPerModelPromptLimit: integer('global_per_model_prompt_limit').default(0),
	globalPerModelPromptLimitWindow: text('global_per_model_prompt_limit_window').default('1d'),
	globalDailyTokenLimit: integer('global_daily_token_limit').default(0),
	globalMonthlyTokenLimit: integer('global_monthly_token_limit').default(0),
	globalDailyInputTokenLimit: integer('global_daily_input_token_limit').default(0),
	globalDailyOutputTokenLimit: integer('global_daily_output_token_limit').default(0),
	discordBotToken: text('discord_bot_token').default(''),
	agverifChannelId: text('agverif_channel_id').default(''),
	tokitoChannelId: text('tokito_channel_id').default(''),
	requiredRoleId: text('required_role_id').default(''),
	ownerGroupyRoleId: text('owner_groupy_role_id').default(''),
	verifiedRoleId: text('verified_role_id').default(''),
	geminiApiKey: text('gemini_api_key').default(''),
	verifAutoEnabled: boolean('verif_auto_enabled').default(false),
	tokitoApiKey: text('tokito_api_key').default(''),
	trialEnabled: boolean('trial_enabled').notNull().default(false),
	trialAccessMode: text('trial_access_mode').notNull().default('groupy_members'),
	trialRequiredRoleId: text('trial_required_role_id').default('1354682641961582632'),
	trialDefaultDurationDays: integer('trial_default_duration_days').notNull().default(1),
	trialMaxPerAccount: integer('trial_max_per_account').notNull().default(1),
	trialDailyTokenLimit: integer('trial_daily_token_limit').notNull().default(1_000_000),
	trialPromptLimit: integer('trial_prompt_limit').notNull().default(50),
	trialPromptLimitWindow: text('trial_prompt_limit_window').notNull().default('5h'),
	trialModelSelectionMode: text('trial_model_selection_mode').notNull().default('all_gpy'),
	trialModelWhitelist: text('trial_model_whitelist').notNull().default('[]'),
	trialUpstreams: text('trial_upstreams').notNull().default(''),
	trialPanelMessageId: text('trial_panel_message_id'),
	trialEmbedConfig: text('trial_embed_config').notNull().default('{}'),
	trialDmTemplates: text('trial_dm_templates').notNull().default('{}'),
	// ─── Token Saver (9router-style pipeline) ───────────────────────────────────
	tokenSaverRtkEnabled: boolean('token_saver_rtk_enabled').notNull().default(true),
	tokenSaverRtkMaxChars: integer('token_saver_rtk_max_chars').notNull().default(2000),
	tokenSaverHeadroomEnabled: boolean('token_saver_headroom_enabled').notNull().default(false),
	tokenSaverHeadroomUrl: text('token_saver_headroom_url').notNull().default(''),
	tokenSaverCavemanEnabled: boolean('token_saver_caveman_enabled').notNull().default(false),
	tokenSaverCavemanLevel: integer('token_saver_caveman_level').notNull().default(2),
	tokenSaverPonytailEnabled: boolean('token_saver_ponytail_enabled').notNull().default(false),
	tokenSaverPonytailLevel: text('token_saver_ponytail_level').notNull().default('lite'),
	/** off | notif_only | auto — default notif_only (manual catalog publish) */
	monitorAutoMode: text('monitor_auto_mode').notNull().default('notif_only'),
	/** full = prompt_tokens+cached_tokens (match upstream In); billable = net context_delta */
	tokenInputMode: text('token_input_mode').notNull().default('per_turn_peak'),
	/** JSON string array of model patterns that require an active add-on. Empty = nothing hard-locked. */
	addonRequiredModels: text('addon_required_models').notNull().default('[]'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── API Keys ──────────────────────────────────────────────────────────────────
export const apiKeys = pgTable('api_keys', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().default(''),
	key: text('key').notNull().unique(),
	keyPrefix: text('key_prefix').notNull(),
	keyHash: text('key_hash').notNull(),
	discordUserId: text('discord_user_id'),
	discordUsername: text('discord_username'),
	provisionedBy: text('provisioned_by').notNull().default('dashboard'),
	isActive: boolean('is_active').notNull().default(true),
	maxDevices: integer('max_devices').default(0),
	devicePolicy: text('device_policy').notNull().default('none'),
	ipPolicy: text('ip_policy').notNull().default('none'),
	idePolicy: text('ide_policy').notNull().default('none'),
	monthlyTokenLimit: integer('monthly_token_limit').default(0),
	rateLimit: integer('rate_limit').default(0),
	rateLimitWindow: text('rate_limit_window'),
	/** Fixed-window start for API-call (hop) quota — mirrors prompt_window_start. */
	rateWindowStart: text('rate_window_start'),
	promptLimit: integer('prompt_limit').default(0),
	promptLimitWindow: text('prompt_limit_window'),
	promptWindowStart: text('prompt_window_start'),
	perModelPromptLimit: integer('per_model_prompt_limit').default(0),
	perModelPromptLimitWindow: text('per_model_prompt_limit_window'),
	dailyTokenLimit: integer('daily_token_limit').default(0),
	dailyInputTokenLimit: integer('daily_input_token_limit').default(0),
	dailyOutputTokenLimit: integer('daily_output_token_limit').default(0),
	pendingNotification: text('pending_notification'),
	isTrial: boolean('is_trial').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Allowed/Blocked Devices (per API key) ─────────────────────────────────────
export const allowedDevices = pgTable('allowed_devices', {
	id: serial('id').primaryKey(),
	apiKeyId: integer('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
	fingerprint: text('fingerprint'),
	ipAddress: text('ip_address'),
	label: text('label').default(''),
	listType: text('list_type').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Allowed/Blocked IDEs (per API key) ───────────────────────────────────────
export const allowedIdes = pgTable('allowed_ides', {
	id: serial('id').primaryKey(),
	apiKeyId: integer('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
	ideName: text('ide_name').notNull(),
	listType: text('list_type').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	apiKeyIdeIdx: index('idx_allowed_ides_api_key_ide').on(table.apiKeyId, table.ideName),
}));

// ─── Request Logs ──────────────────────────────────────────────────────────────
export const requestLogs = pgTable('request_logs', {
	id: serial('id').primaryKey(),
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
	turnId: text('turn_id'),
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
	hasToolCalls: boolean('has_tool_calls').default(false),
	requestPreview: text('request_preview'),
	responsePreview: text('response_preview'),
	transcriptSnapshot: text('transcript_snapshot'),
	estimatedContextLength: integer('estimated_context_length').default(0),
	messageRole: text('message_role'),
	userMessageHash: text('user_message_hash'),
	actualToolCallsInResponse: boolean('actual_tool_calls_in_response').default(false),
	isCountedRequest: boolean('is_counted_request').default(true),
	isBillableToken: boolean('is_billable_token').default(false),
	latencyMs: integer('latency_ms').default(0),
	statusCode: integer('status_code').default(0),
	errorMessage: text('error_message'),
	estimatedCost: integer('estimated_cost').default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	createdAtIdx: index('idx_logs_created_at').on(table.createdAt),
	apiKeyIdIdx: index('idx_logs_api_key_id').on(table.apiKeyId),
	deviceFingerprintIdx: index('idx_logs_device_fingerprint').on(table.deviceFingerprint),
	ipAddressIdx: index('idx_logs_ip_address').on(table.ipAddress),
	sessionIdIdx: index('idx_logs_session_id').on(table.sessionId),
	providerIdx: index('idx_logs_provider').on(table.provider),
	keyCreatedIdx: index('idx_logs_key_created').on(table.apiKeyId, table.createdAt),
	keyCreatedCountedIdx: index('idx_logs_key_created_counted').on(table.apiKeyId, table.createdAt, table.isCountedRequest),
	keyCreatedModelIdx: index('idx_logs_key_created_model').on(table.apiKeyId, table.createdAt, table.model),
	keyCreatedStatusIdx: index('idx_logs_key_created_status').on(table.apiKeyId, table.createdAt, table.statusCode),
	turnAggIdx: index('idx_logs_turn_agg').on(table.turnId, table.statusCode, table.createdAt),
	modelIdx: index('idx_logs_model').on(table.model),
}));

// ─── Chat Sessions ───────────────────────────────────────────────────────────
export const chatSessions = pgTable('chat_sessions', {
	id: serial('id').primaryKey(),
	sessionId: text('session_id').notNull().unique(),
	apiKeyId: integer('api_key_id'),
	apiKeyName: text('api_key_name'),
	ipAddress: text('ip_address'),
	deviceFingerprint: text('device_fingerprint'),
	ideDetected: text('ide_detected'),
	provider: text('provider'),
	model: text('model'),
	sessionName: text('session_name').default(''),
	contextFingerprint: text('context_fingerprint'),
	lastContextTokens: integer('last_context_tokens').notNull().default(0),
	requestCount: integer('request_count').notNull().default(0),
	promptCount: integer('prompt_count').notNull().default(0),
	totalTokens: integer('total_tokens').notNull().default(0),
	compactCount: integer('compact_count').notNull().default(0),
	switchCount: integer('switch_count').notNull().default(0),
	consecutiveToolFollowups: integer('consecutive_tool_followups').notNull().default(0),
	lastRequestPreview: text('last_request_preview'),
	estimatedCost: integer('estimated_cost').notNull().default(0),
	lastUserMessageHash: text('last_user_message_hash'),
	lastMessageRole: text('last_message_role'),
	lastToolCallsActive: boolean('last_tool_calls_active').default(false),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
}, (table) => ({
	apiKeyIdIdx: index('idx_sessions_api_key_id').on(table.apiKeyId),
	deviceFingerprintIdx: index('idx_sessions_device_fingerprint').on(table.deviceFingerprint),
	lastSeenAtIdx: index('idx_sessions_last_seen_at').on(table.lastSeenAt),
	contextFingerprintIdx: index('idx_sessions_context_fingerprint').on(table.contextFingerprint),
}));

// ─── Devices Registry ────────────────────────────────────────────────────────
export const devices = pgTable('devices', {
	id: serial('id').primaryKey(),
	apiKeyId: integer('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
	fingerprint: text('fingerprint').notNull(),
	ipAddress: text('ip_address'),
	userAgentRaw: text('user_agent_raw'),
	osDetected: text('os_detected'),
	deviceName: text('device_name'),
	ideDetected: text('ide_detected'),
	firstSeen: timestamp('first_seen').notNull().defaultNow(),
	lastSeen: timestamp('last_seen').notNull().defaultNow(),
	requestCount: integer('request_count').notNull().default(0),
	isBlocked: boolean('is_blocked').notNull().default(false),
}, (table) => ({
	apiKeyFingerprintIdx: uniqueIndex('idx_devices_api_key_fingerprint').on(table.apiKeyId, table.fingerprint),
}));

// ─── Providers ───────────────────────────────────────────────────────────────
export const providers = pgTable('providers', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	endpoint: text('endpoint').notNull(),
	apiKey: text('api_key').notNull(),
	endpointType: text('endpoint_type').notNull().default('openai'),
	isActive: boolean('is_active').notNull().default(true),
	priority: integer('priority').notNull().default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Provider API Keys ────────────────────────────────────────────────────────
export const providerApiKeys = pgTable('provider_api_keys', {
	id: serial('id').primaryKey(),
	providerId: integer('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
	apiKey: text('api_key').notNull(),
	isActive: boolean('is_active').notNull().default(true),
	isLimited: boolean('is_limited').notNull().default(false),
	limitedAt: text('limited_at'),
	/** Last probe/list error message (e.g. "Invalid API key", "HTTP 401"). */
	lastError: text('last_error'),
	lastCheckedAt: text('last_checked_at'),
	/** Models returned by last successful /models probe (0 = never or empty). */
	lastModelCount: integer('last_model_count').default(0),
	requestCount: integer('request_count').notNull().default(0),
	lastUsedAt: text('last_used_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	providerIdIdx: index('idx_provider_keys_provider_id').on(table.providerId),
}));

// ─── Custom Models (per provider) ────────────────────────────────────────────
export const customModels = pgTable('custom_models', {
	id: serial('id').primaryKey(),
	providerId: integer('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
	modelId: text('model_id').notNull(),
	displayName: text('display_name'),
	description: text('description'),
	contextLength: integer('context_length'),
	maxOutputTokens: integer('max_output_tokens'),
	inputPricePerMtok: integer('input_price_per_mtok').default(0),
	outputPricePerMtok: integer('output_price_per_mtok').default(0),
	inputModalities: text('input_modalities'),
	outputModalities: text('output_modalities'),
	supportedFeatures: text('supported_features'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	providerIdIdx: index('idx_custom_models_provider_id').on(table.providerId),
	modelIdIdx: index('idx_custom_models_model_id').on(table.modelId),
}));

// ─── Model Monitor ─────────────────────────────────────────────────────────────
export const modelMonitor = pgTable('model_monitor', {
	id: serial('id').primaryKey(),
	modelId: text('model_id').notNull(),
	provider: text('provider'),
	isOnline: boolean('is_online').notNull().default(false),
	latencyMs: integer('latency_ms').default(0),
	httpStatus: integer('http_status').default(0),
	errorMessage: text('error_message'),
	baseUrl: text('base_url'),
	checkedAt: timestamp('checked_at').notNull().defaultNow(),
}, (table) => ({
	modelIdIdx: index('idx_monitor_model_id').on(table.modelId),
	checkedAtIdx: index('idx_monitor_checked_at').on(table.checkedAt),
	// Unique (model_id, provider) enforced via expression index in db/index.ts
	// (COALESCE(provider,'')) — drizzle pgTable can't express COALESCE unique easily.
}));

// ─── Model Test State ──────────────────────────────────────────────────────────
export const modelTestState = pgTable('model_test_state', {
	id: serial('id').primaryKey(),
	modelId: text('model_id').notNull(),
	provider: text('provider'),
	retryCount: integer('retry_count').notNull().default(0),
	lastTestAt: text('last_test_at'),
	suspendedUntil: text('suspended_until'),
}, (table) => ({
	uniqueModel: index('idx_test_state_model').on(table.modelId, table.provider),
}));

// ─── Model Limits ─────────────────────────────────────────────────────────────
export const modelLimits = pgTable('model_limits', {
	id: serial('id').primaryKey(),
	scope: text('scope').notNull().default('global'),
	scopeId: integer('scope_id').notNull().default(0),
	model: text('model').notNull(),
	promptLimit: integer('prompt_limit').notNull().default(0),
	promptWindowStart: text('prompt_window_start'),
	dailyTokenLimit: integer('daily_token_limit').default(0),
	monthlyTokenLimit: integer('monthly_token_limit').default(0),
	dailyInputTokenLimit: integer('daily_input_token_limit').default(0),
	dailyOutputTokenLimit: integer('daily_output_token_limit').default(0),
	isPattern: boolean('is_pattern').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	scopeModelIdx: index('idx_model_limits_scope_model').on(table.scope, table.scopeId, table.model),
}));

// ─── Cleanup State ──────────────────────────────────────────────────────────────
export const cleanupState = pgTable('cleanup_state', {
	id: serial('id').primaryKey(),
	cleanupType: text('cleanup_type').notNull().unique(),
	lastCleanupAt: text('last_cleanup_at'),
	lastProcessedMonth: text('last_processed_month'),
	cleanedMonths: text('cleaned_months').default('[]'),
	cleanedDays: text('cleaned_days').default('[]'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Monthly Stats ──────────────────────────────────────────────────────────────
export const monthlyStats = pgTable('monthly_stats', {
	id: serial('id').primaryKey(),
	yearMonth: text('year_month').notNull(),
	apiKeyId: integer('api_key_id'),
	model: text('model').notNull().default('_all_'),
	turnCount: integer('turn_count').notNull().default(0),
	inputTokens: integer('input_tokens').notNull().default(0),
	outputTokens: integer('output_tokens').notNull().default(0),
	totalTokens: integer('total_tokens').notNull().default(0),
	estimatedCost: integer('estimated_cost').notNull().default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	ymKeyIdx: index('idx_monthly_stats_ym_key').on(table.yearMonth, table.apiKeyId, table.model),
}));

// ─── Model Metadata ─────────────────────────────────────────────────────────────
export const modelMetadata = pgTable('model_metadata', {
	id: serial('id').primaryKey(),
	modelId: text('model_id').notNull().unique(),
	displayName: text('display_name'),
	description: text('description'),
	contextLength: integer('context_length'),
	maxOutputTokens: integer('max_output_tokens'),
	inputPricePerMtok: integer('input_price_per_mtok').default(0),
	outputPricePerMtok: integer('output_price_per_mtok').default(0),
	inputModalities: text('input_modalities'),
	outputModalities: text('output_modalities'),
	supportedFeatures: text('supported_features'),
	source: text('source').default('unknown'),
	// Identity lock: advertised name injected as topmost system prompt so
	// clients don't see upstream's real model (e.g. gpt-5.5-pro → Nemotron).
	advertisedName: text('advertised_name'),
	developer: text('developer'),
	identityPrompt: text('identity_prompt'),
	identityLocked: boolean('identity_locked').notNull().default(true),
	enrichSource: text('enrich_source'),
	enrichedAt: timestamp('enriched_at'),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Monthly Recap (Wrapped) ─────────────────────────────────────────────────
// Per-user, per-month generated recap. statsJson = aggregate numeric/category
// metrics only (NO conversation content). narrativeJson = AI-generated text +
// chosen media asset ids. Cached per WIB day (generatedDate); regenerated daily.
export const userRecaps = pgTable('user_recaps', {
	id: serial('id').primaryKey(),
	apiKeyId: integer('api_key_id'),
	discordUserId: text('discord_user_id').notNull(),
	discordUsername: text('discord_username'),
	avatarUrl: text('avatar_url'),
	apiKeyName: text('api_key_name'),
	yearMonth: text('year_month').notNull(), // "YYYY-MM"
	generatedDate: text('generated_date').notNull(), // WIB "YYYY-MM-DD"
	statsJson: text('stats_json').notNull().default('{}'),
	narrativeJson: text('narrative_json').notNull().default('{}'),
	rankRequests: integer('rank_requests').default(0),
	rankTokens: integer('rank_tokens').default(0),
	shareToken: text('share_token'),
	shareTokenUsed: boolean('share_token_used').default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	userMonthIdx: uniqueIndex('idx_user_recaps_user_month').on(table.discordUserId, table.yearMonth),
	nameIdx: index('idx_user_recaps_name').on(table.apiKeyName),
}));

export const recapLeaderboard = pgTable('recap_leaderboard', {
	id: serial('id').primaryKey(),
	yearMonth: text('year_month').notNull(), // "YYYY-MM"
	category: text('category').notNull(), // 'requests' | 'tokens'
	rank: integer('rank').notNull(),
	discordUserId: text('discord_user_id'),
	discordUsername: text('discord_username'),
	avatarUrl: text('avatar_url'),
	value: integer('value').notNull().default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	ymCatRankIdx: uniqueIndex('idx_recap_lb_ym_cat_rank').on(table.yearMonth, table.category, table.rank),
}));

export const recapTestimonials = pgTable('recap_testimonials', {
	id: serial('id').primaryKey(),
	discordUserId: text('discord_user_id').notNull(),
	discordUsername: text('discord_username'),
	avatarUrl: text('avatar_url'),
	apiKeyName: text('api_key_name'),
	yearMonth: text('year_month').notNull(), // "YYYY-MM"
	stars: integer('stars').notNull().default(5),
	body: text('body').notNull().default(''),
	rankRequests: integer('rank_requests').default(0),
	rankTokens: integer('rank_tokens').default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	userMonthIdx: uniqueIndex('idx_recap_testi_user_month').on(table.discordUserId, table.yearMonth),
	ymIdx: index('idx_recap_testi_ym').on(table.yearMonth),
}));

// ─── Trial Users ───────────────────────────────────────────────────────────────
export const trialUsers = pgTable('trial_users', {
	id: serial('id').primaryKey(),
	discordUserId: text('discord_user_id').notNull(),
	discordUsername: text('discord_username'),
	apiKeyId: integer('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
	claimedAt: timestamp('claimed_at').notNull().defaultNow(),
	expiresAt: timestamp('expires_at').notNull(),
	endedAt: timestamp('ended_at'),
	endReason: text('end_reason'),
	overrideDays: integer('override_days'),
	overrideMaxTrials: integer('override_max_trials'),
	overrideDailyTokenLimit: integer('override_daily_token_limit'),
	overridePromptLimit: integer('override_prompt_limit'),
	overridePromptLimitWindow: text('override_prompt_limit_window'),
	suspended: boolean('suspended').notNull().default(false),
	lastNotifiedAt: timestamp('last_notified_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	userIdx: index('idx_trial_users_discord').on(table.discordUserId),
	apiKeyIdx: uniqueIndex('idx_trial_users_api_key').on(table.apiKeyId),
}));

// ─── Type exports ──────────────────────────────────────────────────────────────
export type AdminConfig = typeof adminConfig.$inferSelect;
export type TrialUser = typeof trialUsers.$inferSelect;
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
export type ModelMetadata = typeof modelMetadata.$inferSelect;

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
export type NewModelMetadata = typeof modelMetadata.$inferInsert;
export type NewTrialUser = typeof trialUsers.$inferInsert;

// ─── Add-ons (assignable model access + quota packs) ───────────────────────────
export const addons = pgTable('addons', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	/** JSON string array of model id / substring patterns, e.g. ["chatgpt-5.6","gpt-5"] */
	modelAllowlist: text('model_allowlist').notNull().default('[]'),
	/** allowlist | all_except — all_except uses modelDenylist */
	accessMode: text('access_mode').notNull().default('allowlist'),
	/** JSON string array of excluded patterns when accessMode=all_except */
	modelDenylist: text('model_denylist').notNull().default('[]'),
	/** JSON object pattern -> daily token limit, e.g. {"chatgpt-5.6":5000000} */
	modelDailyLimits: text('model_daily_limits').notNull().default('{}'),
	dailyTokenLimit: integer('daily_token_limit').notNull().default(0),
	monthlyTokenLimit: integer('monthly_token_limit').notNull().default(0),
	dailyInputTokenLimit: integer('daily_input_token_limit').notNull().default(0),
	dailyOutputTokenLimit: integer('daily_output_token_limit').notNull().default(0),
	promptLimit: integer('prompt_limit').notNull().default(0),
	promptLimitWindow: text('prompt_limit_window').notNull().default('1d'),
	/** When > 0, assignment clamps api_keys.maxDevices */
	maxDevices: integer('max_devices').notNull().default(0),
	/** Default assignment length in days (0 = no auto expiry). Assign UI + API use this unless expiresAt overridden. */
	defaultDurationDays: integer('default_duration_days').notNull().default(0),
	/** Optional Discord role: note / future auto-assign */
	discordRoleId: text('discord_role_id'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const addonAssignments = pgTable('addon_assignments', {
	id: serial('id').primaryKey(),
	addonId: integer('addon_id').notNull().references(() => addons.id, { onDelete: 'cascade' }),
	discordUserId: text('discord_user_id'),
	apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'cascade' }),
	startsAt: timestamp('starts_at').notNull().defaultNow(),
	expiresAt: timestamp('expires_at'),
	isActive: boolean('is_active').notNull().default(true),
	assignedBy: text('assigned_by').notNull().default('dashboard'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	addonIdx: index('idx_addon_assignments_addon').on(table.addonId),
	discordIdx: index('idx_addon_assignments_discord').on(table.discordUserId),
	keyIdx: index('idx_addon_assignments_key').on(table.apiKeyId),
}));

export type Addon = typeof addons.$inferSelect;
export type NewAddon = typeof addons.$inferInsert;
export type AddonAssignment = typeof addonAssignments.$inferSelect;
export type NewAddonAssignment = typeof addonAssignments.$inferInsert;

// ─── User Portal Settings ────────────────────────────────────────────────────────
export const userPortalSettings = pgTable('user_portal_settings', {
  discordUserId: text('discord_user_id').primaryKey(),
  passwordHash: text('password_hash'), // null = auto-login (no password required)
  passwordSetAt: timestamp('password_set_at'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  lastLoginAt: timestamp('last_login_at'),
  // ─── Token Saver overrides (tri-state: null = use global, true/false = override) ───
  tokenSaverRtkOverride: boolean('token_saver_rtk_override'),
  tokenSaverHeadroomOverride: boolean('token_saver_headroom_override'),
  tokenSaverCavemanOverride: boolean('token_saver_caveman_override'),
  tokenSaverPonytailOverride: boolean('token_saver_ponytail_override'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type UserPortalSettings = typeof userPortalSettings.$inferSelect;
export type NewUserPortalSettings = typeof userPortalSettings.$inferInsert;
