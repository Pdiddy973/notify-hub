CREATE TABLE `discard_counts` (
	`hour` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`source_id` text,
	`priority` integer NOT NULL,
	`conditions` text DEFAULT '{}' NOT NULL,
	`channel_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`continue_matching` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_routes`("id", "source_id", "priority", "conditions", "channel_id", "enabled") SELECT "id", "source_id", "priority", "conditions", "channel_id", "enabled" FROM `routes`;--> statement-breakpoint
DROP TABLE `routes`;--> statement-breakpoint
ALTER TABLE `__new_routes` RENAME TO `routes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `routes_priority_idx` ON `routes` (`priority`,`id`);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `route_id` integer;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `fallback` integer DEFAULT false NOT NULL;