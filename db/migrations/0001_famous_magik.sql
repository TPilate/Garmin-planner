CREATE TABLE `discipline_goals` (
	`discipline` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`weekly_frequency_target` integer NOT NULL,
	`block_length_weeks` integer DEFAULT 4 NOT NULL,
	`plan_start_date` text NOT NULL,
	`baseline_json` text,
	`created_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now')*1000) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`discipline` text NOT NULL,
	`target_intensity` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`phase` text DEFAULT 'any' NOT NULL,
	`structure_json` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_session_templates`("id", "name", "discipline", "target_intensity", "duration_minutes", "phase", "structure_json", "is_archived", "created_at", "updated_at") SELECT "id", "name", COALESCE("discipline", ''), COALESCE("target_intensity", ''), 30, 'any', "structure_json", "is_archived", "created_at", "updated_at" FROM `session_templates`;--> statement-breakpoint
DROP TABLE `session_templates`;--> statement-breakpoint
ALTER TABLE `__new_session_templates` RENAME TO `session_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `logged_sessions` ADD `status` text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `logged_sessions_date_unique` ON `logged_sessions` (`date`);