CREATE TABLE `apiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('openai','anthropic','google') NOT NULL,
	`encryptedKey` text NOT NULL,
	`status` enum('connected','disconnected') NOT NULL DEFAULT 'connected',
	`lastVerified` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`businessType` varchar(100),
	`location` varchar(255),
	`description` text,
	`website` varchar(500),
	`phone` varchar(50),
	`address` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platformMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` timestamp NOT NULL,
	`activeTrainings` int NOT NULL DEFAULT 0,
	`completedGoals` int NOT NULL DEFAULT 0,
	`apiCallsToday` int NOT NULL DEFAULT 0,
	`avgResponseTime` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platformMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduledJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`trainingSessionId` int,
	`businessId` int,
	`jobName` varchar(255) NOT NULL,
	`scheduleType` enum('daily','weekly','monthly','custom') NOT NULL,
	`cronExpression` varchar(100),
	`isActive` boolean NOT NULL DEFAULT true,
	`lastRun` timestamp,
	`nextRun` timestamp,
	`runCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trainingConversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trainingSessionId` int NOT NULL,
	`iterationNumber` int NOT NULL,
	`conversationHistory` json NOT NULL,
	`promptUsed` text NOT NULL,
	`goalAchieved` boolean NOT NULL DEFAULT false,
	`responseTime` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trainingConversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trainingSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`businessId` int,
	`trainingName` varchar(255) NOT NULL,
	`topic` text NOT NULL,
	`targetAiProvider` enum('openai','anthropic','google') NOT NULL,
	`targetAiModel` varchar(100) NOT NULL,
	`influencerAiProvider` enum('openai','anthropic','google') NOT NULL,
	`influencerAiModel` varchar(100) NOT NULL,
	`trainingPrompts` json NOT NULL,
	`trainingContext` text,
	`trainingGoal` text NOT NULL,
	`iterations` int NOT NULL DEFAULT 50,
	`retryInterval` int NOT NULL DEFAULT 10,
	`currentProgress` int NOT NULL DEFAULT 0,
	`status` enum('paused','in_progress','completed','error') NOT NULL DEFAULT 'paused',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `trainingSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `apiKeys` ADD CONSTRAINT `apiKeys_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platformMetrics` ADD CONSTRAINT `platformMetrics_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledJobs` ADD CONSTRAINT `scheduledJobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledJobs` ADD CONSTRAINT `scheduledJobs_trainingSessionId_trainingSessions_id_fk` FOREIGN KEY (`trainingSessionId`) REFERENCES `trainingSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledJobs` ADD CONSTRAINT `scheduledJobs_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trainingConversations` ADD CONSTRAINT `trainingConversations_trainingSessionId_trainingSessions_id_fk` FOREIGN KEY (`trainingSessionId`) REFERENCES `trainingSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trainingSessions` ADD CONSTRAINT `trainingSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trainingSessions` ADD CONSTRAINT `trainingSessions_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE set null ON UPDATE no action;