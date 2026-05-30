ALTER TABLE `model_limits` ADD `daily_token_limit` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `model_limits` ADD `monthly_token_limit` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `model_limits` ADD `daily_input_token_limit` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `model_limits` ADD `daily_output_token_limit` integer DEFAULT 0;