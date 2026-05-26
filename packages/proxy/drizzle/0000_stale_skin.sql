CREATE TABLE `admin_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password_hash` text NOT NULL,
	`upstream_endpoint` text DEFAULT 'https://api.openai.com' NOT NULL,
	`upstream_api_key` text DEFAULT '' NOT NULL,
	`global_max_devices` integer DEFAULT 0,
	`realtime_enabled` integer DEFAULT false,
	`global_rate_limit` integer DEFAULT 0,
	`global_rate_limit_window` text DEFAULT '1h',
	`global_prompt_limit` integer DEFAULT 0,
	`global_prompt_limit_window` text DEFAULT '1d',
	`global_per_model_prompt_limit` integer DEFAULT 0,
	`global_per_model_prompt_limit_window` text DEFAULT '1d',
	`discord_bot_token` text DEFAULT '',
	`agverif_channel_id` text DEFAULT '',
	`tokito_channel_id` text DEFAULT '',
	`required_role_id` text DEFAULT '',
	`owner_groupy_role_id` text DEFAULT '',
	`verified_role_id` text DEFAULT '',
	`gemini_api_key` text DEFAULT '',
	`verif_auto_enabled` integer DEFAULT false,
	`tokito_api_key` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allowed_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`api_key_id` integer NOT NULL,
	`fingerprint` text,
	`ip_address` text,
	`label` text DEFAULT '',
	`list_type` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `allowed_ides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`api_key_id` integer NOT NULL,
	`ide_name` text NOT NULL,
	`list_type` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`discord_user_id` text,
	`discord_username` text,
	`provisioned_by` text DEFAULT 'dashboard' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`max_devices` integer DEFAULT 0,
	`device_policy` text DEFAULT 'none' NOT NULL,
	`ip_policy` text DEFAULT 'none' NOT NULL,
	`ide_policy` text DEFAULT 'none' NOT NULL,
	`monthly_token_limit` integer DEFAULT 0,
	`rate_limit` integer DEFAULT 0,
	`rate_limit_window` text,
	`prompt_limit` integer DEFAULT 0,
	`prompt_limit_window` text,
	`per_model_prompt_limit` integer DEFAULT 0,
	`per_model_prompt_limit_window` text,
	`pending_notification` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`api_key_id` integer,
	`api_key_name` text,
	`ip_address` text,
	`device_fingerprint` text,
	`ide_detected` text,
	`provider` text,
	`model` text,
	`session_name` text DEFAULT '',
	`context_fingerprint` text,
	`last_context_tokens` integer DEFAULT 0 NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`prompt_count` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`compact_count` integer DEFAULT 0 NOT NULL,
	`switch_count` integer DEFAULT 0 NOT NULL,
	`last_request_preview` text,
	`estimated_cost` integer DEFAULT 0 NOT NULL,
	`last_user_message_hash` text,
	`last_message_role` text,
	`last_tool_calls_active` integer DEFAULT false,
	`first_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`api_key_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`ip_address` text,
	`user_agent_raw` text,
	`os_detected` text,
	`device_name` text,
	`ide_detected` text,
	`first_seen` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen` text DEFAULT (datetime('now')) NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`is_blocked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `model_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`scope_id` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`prompt_limit` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_monitor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_id` text NOT NULL,
	`provider` text,
	`is_online` integer DEFAULT false NOT NULL,
	`latency_ms` integer DEFAULT 0,
	`http_status` integer DEFAULT 0,
	`error_message` text,
	`base_url` text,
	`checked_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`api_key_id` integer,
	`api_key_name` text,
	`user_agent_raw` text,
	`os_detected` text,
	`client_name` text,
	`ip_address` text,
	`device_fingerprint` text,
	`ide_detected` text,
	`provider` text,
	`endpoint_path` text,
	`session_id` text,
	`model` text,
	`prompt_tokens` integer DEFAULT 0,
	`completion_tokens` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0,
	`context_fingerprint` text,
	`context_tokens_before` integer DEFAULT 0,
	`context_delta_tokens` integer DEFAULT 0,
	`context_event` text,
	`tools_used` text,
	`tool_count` integer DEFAULT 0,
	`has_tool_calls` integer DEFAULT false,
	`request_preview` text,
	`response_preview` text,
	`transcript_snapshot` text,
	`estimated_context_length` integer DEFAULT 0,
	`message_role` text,
	`user_message_hash` text,
	`actual_tool_calls_in_response` integer DEFAULT false,
	`is_counted_request` integer DEFAULT true,
	`latency_ms` integer DEFAULT 0,
	`status_code` integer DEFAULT 0,
	`error_message` text,
	`estimated_cost` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_allowed_ides_api_key_ide` ON `allowed_ides` (`api_key_id`,`ide_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_session_id_unique` ON `chat_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_api_key_id` ON `chat_sessions` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_device_fingerprint` ON `chat_sessions` (`device_fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_sessions_last_seen_at` ON `chat_sessions` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_context_fingerprint` ON `chat_sessions` (`context_fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_devices_api_key_fingerprint` ON `devices` (`api_key_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_model_limits_scope_model` ON `model_limits` (`scope`,`scope_id`,`model`);--> statement-breakpoint
CREATE INDEX `idx_monitor_model_id` ON `model_monitor` (`model_id`);--> statement-breakpoint
CREATE INDEX `idx_monitor_checked_at` ON `model_monitor` (`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_logs_created_at` ON `request_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_logs_api_key_id` ON `request_logs` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_device_fingerprint` ON `request_logs` (`device_fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_logs_ip_address` ON `request_logs` (`ip_address`);--> statement-breakpoint
CREATE INDEX `idx_logs_session_id` ON `request_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_provider` ON `request_logs` (`provider`);