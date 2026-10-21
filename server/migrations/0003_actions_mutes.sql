CREATE TABLE `address_blocks` (
	`address` text PRIMARY KEY NOT NULL,
	`until` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mutes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`target` text NOT NULL,
	`until` text,
	`reason` text DEFAULT '' NOT NULL,
	`keep_errors` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mutes_target_idx` ON `mutes` (`scope`,`target`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`source_id` text,
	`priority` integer NOT NULL,
	`conditions` text DEFAULT '{}' NOT NULL,
	`action` text DEFAULT 'send' NOT NULL,
	`channel_id` text,
	`mentions` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`continue_matching` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_routes`("id", "name", "source_id", "priority", "conditions", "channel_id", "enabled", "continue_matching") SELECT "id", "name", "source_id", "priority", "conditions", "channel_id", "enabled", "continue_matching" FROM `routes`;--> statement-breakpoint
DROP TABLE `routes`;--> statement-breakpoint
ALTER TABLE `__new_routes` RENAME TO `routes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `routes_priority_idx` ON `routes` (`priority`,`id`);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `content` text;