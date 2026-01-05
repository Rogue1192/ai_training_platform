-- AI Training Platform Database Migration
-- Run this in Railway MySQL Query console

-- Create users table
CREATE TABLE IF NOT EXISTS `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);

-- Create apiKeys table
CREATE TABLE IF NOT EXISTS `apiKeys` (
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

-- Create businesses table
CREATE TABLE IF NOT EXISTS `businesses` (
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

-- Create platformMetrics table
CREATE TABLE IF NOT EXISTS `platformMetrics` (
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

-- Create scheduledJobs table
CREATE TABLE IF NOT EXISTS `scheduledJobs` (
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

-- Create trainingConversations table
CREATE TABLE IF NOT EXISTS `trainingConversations` (
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

-- Create trainingSessions table
CREATE TABLE IF NOT EXISTS `trainingSessions` (
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

-- Add foreign key constraints (only if they don't exist)
-- Note: Railway might show errors if constraints already exist, that's okay

ALTER TABLE `apiKeys` 
ADD CONSTRAINT `apiKeys_userId_users_id_fk` 
FOREIGN KEY (`userId`) REFERENCES `users`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `businesses` 
ADD CONSTRAINT `businesses_userId_users_id_fk` 
FOREIGN KEY (`userId`) REFERENCES `users`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `platformMetrics` 
ADD CONSTRAINT `platformMetrics_userId_users_id_fk` 
FOREIGN KEY (`userId`) REFERENCES `users`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `scheduledJobs` 
ADD CONSTRAINT `scheduledJobs_userId_users_id_fk` 
FOREIGN KEY (`userId`) REFERENCES `users`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `scheduledJobs` 
ADD CONSTRAINT `scheduledJobs_trainingSessionId_trainingSessions_id_fk` 
FOREIGN KEY (`trainingSessionId`) REFERENCES `trainingSessions`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `scheduledJobs` 
ADD CONSTRAINT `scheduledJobs_businessId_businesses_id_fk` 
FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `trainingConversations` 
ADD CONSTRAINT `trainingConversations_trainingSessionId_trainingSessions_id_fk` 
FOREIGN KEY (`trainingSessionId`) REFERENCES `trainingSessions`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `trainingSessions` 
ADD CONSTRAINT `trainingSessions_userId_users_id_fk` 
FOREIGN KEY (`userId`) REFERENCES `users`(`id`) 
ON DELETE cascade ON UPDATE no action;

ALTER TABLE `trainingSessions` 
ADD CONSTRAINT `trainingSessions_businessId_businesses_id_fk` 
FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) 
ON DELETE set null ON UPDATE no action;

-- Verify tables were created
SHOW TABLES;
