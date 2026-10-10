CREATE TABLE `adapters` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`version` integer,
	`load_status` text NOT NULL,
	`last_error` text,
	`approved_permissions` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`last_synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`embed` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`discord_message_id` text,
	`sent_at` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `deliveries` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `deliveries_message_idx` ON `deliveries` (`message_id`);--> statement-breakpoint
CREATE TABLE `discarded` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`repeat_count` integer DEFAULT 1 NOT NULL,
	`client_address` text NOT NULL,
	`source_tried` text NOT NULL,
	`reason` text NOT NULL,
	`user_agent` text,
	`method` text NOT NULL,
	`content_type` text,
	`content_length` integer NOT NULL,
	`token_hint` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discarded_sender_idx` ON `discarded` (`client_address`,`source_tried`,`reason`);--> statement-breakpoint
CREATE INDEX `discarded_last_seen_idx` ON `discarded` (`last_seen`);--> statement-breakpoint
CREATE TABLE `health_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`check_name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`resolved_at` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `health_events_check_idx` ON `health_events` (`check_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`received_at` text NOT NULL,
	`headers` text NOT NULL,
	`raw_payload` text NOT NULL,
	`raw_content_type` text NOT NULL,
	`status` text NOT NULL,
	`normalized` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `messages_received_idx` ON `messages` (`received_at`);--> statement-breakpoint
CREATE INDEX `messages_source_idx` ON `messages` (`source_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`priority` integer NOT NULL,
	`conditions` text DEFAULT '{}' NOT NULL,
	`channel_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routes_source_idx` ON `routes` (`source_id`,`priority`);--> statement-breakpoint
CREATE TABLE `samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`token` text NOT NULL,
	`previous_token` text,
	`previous_token_expires_at` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`style` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checked_at` text NOT NULL,
	`running_version` text NOT NULL,
	`latest_version` text,
	`status` text NOT NULL,
	`applied_at` text,
	`result` text
);
