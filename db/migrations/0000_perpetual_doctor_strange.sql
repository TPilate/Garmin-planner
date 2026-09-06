CREATE TABLE `leave_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`type` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leave_periods_range_idx` ON `leave_periods` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `roster_months` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`confirmed_at` integer,
	`created_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_months_year_month_unique` ON `roster_months` (`year`,`month`);--> statement-breakpoint
CREATE TABLE `shift_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`crosses_midnight` integer DEFAULT false NOT NULL,
	`duration_minutes` integer NOT NULL,
	`category` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`code` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`roster_month_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	FOREIGN KEY (`code`) REFERENCES `shift_codes`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roster_month_id`) REFERENCES `roster_months`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shifts_roster_month_idx` ON `shifts` (`roster_month_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_date_unique` ON `shifts` (`date`);--> statement-breakpoint
CREATE TABLE `garmin_daily_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`resting_hr` integer,
	`hrv_last_night` integer,
	`hrv_status` text,
	`sleep_score` integer,
	`sleep_duration_minutes` integer,
	`body_battery_high` integer,
	`body_battery_low` integer,
	`training_readiness_score` integer,
	`stress_avg` integer,
	`vo2max` integer,
	`source` text NOT NULL,
	`normalized_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `garmin_daily_metrics_date_unique` ON `garmin_daily_metrics` (`date`);--> statement-breakpoint
CREATE TABLE `raw_garmin_payloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`metric_type` text NOT NULL,
	`raw_json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `raw_garmin_lookup_idx` ON `raw_garmin_payloads` (`source`,`date`,`metric_type`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `ocr_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roster_month_id` integer NOT NULL,
	`image_path` text NOT NULL,
	`image_sha256` text NOT NULL,
	`raw_model_response` text NOT NULL,
	`parsed_pairs` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`plausibility_check` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`roster_month_id`) REFERENCES `roster_months`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ocr_uploads_month_idx` ON `ocr_uploads` (`roster_month_id`);--> statement-breakpoint
CREATE TABLE `logged_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`session_template_id` integer,
	`planned_intensity_ceiling` text,
	`actual_rpe` integer,
	`actual_duration_minutes` integer,
	`notes` text,
	`garmin_activity_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_template_id`) REFERENCES `session_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `logged_sessions_date_idx` ON `logged_sessions` (`date`);--> statement-breakpoint
CREATE TABLE `session_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`discipline` text,
	`target_intensity` text,
	`structure_json` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
