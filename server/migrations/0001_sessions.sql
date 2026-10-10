CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);