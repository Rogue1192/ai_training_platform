# Schema Reference Map

## Tables and Columns

### users
id, openId, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn

### businesses
id, userId, name, businessType, location, description, website, phone, address, notes, contactEmail, contactName, certifications, awards, yearsInBusiness, bbbRating, licenses, warranties, differentiators, competitors, wpAdminUrl, wpUsername, wpPasswordEncrypted, clientType, sourceWebhookId, createdAt, updatedAt

### apiKeys
id, userId, provider, encryptedKey, status, lastVerified, createdAt, updatedAt

### trainingSessions
id, userId, businessId, trainingName, topic, targetAiProvider, targetAiModel, influencerAiProvider, influencerAiModel, trainingPrompts, trainingContext, trainingGoal, iterations, retryInterval, currentProgress, status, errorMessage, trainingPhase, baselineMentioned, evaluationMentioned, influenceScore, trainingIterationsCompleted, isLegacy, campaignId, campaignQueryLocationId, createdAt, updatedAt, completedAt

### trainingConversations
id, trainingSessionId, iterationNumber, conversationHistory, promptUsed, goalAchieved, responseTime, conversationType, promptType, businessMentionedUnprompted, mentionConfidence, createdAt

### scheduledJobs
id, userId, trainingSessionId, businessId, jobName, scheduleType, cronExpression, timeOfDay, dayOfWeek, dayOfMonth, timezone, isActive, lastRun, nextRun, runCount, createdAt, updatedAt

### scheduledJobRuns
id, scheduledJobId, trainingSessionId, status, startedAt, completedAt, errorMessage, baselineMentioned, evaluationMentioned, influenceScore, iterationsCompleted, triggeredBy

### platformMetrics
id, userId, date, activeTrainings, completedGoals, apiCallsToday, avgResponseTime, createdAt

### promptTemplates
id, userId, templateType, templateName, templateContent, isActive, sortOrder, createdAt, updatedAt

### packageTiers
id, name, slug, maxQueries, maxLocations, description, monthlyPrice, isActive, sortOrder, createdAt, updatedAt

### campaigns
id, userId, businessId, packageTierId, campaignName, status, clientType, keywordResearchCompletedAt, credibilityResearchCompletedAt, contentGenerationCompletedAt, publishingCompletedAt, indexingSubmittedAt, indexingVerifiedAt, baselineCheckCompletedAt, trainingStartedAt, trainingAggressiveness, rankCheckFrequency, lastError, errorCount, sourceWebhookId, createdAt, updatedAt

### campaignQueryLocations
id, campaignId, searchQuery, location, aiSearchVolume, monthlyTrend, currentRankChatGPT, currentRankGemini, currentRankAIOverview, lastRankCheckAt, firstMentionedAt, trainingStatus, trainingSessions, createdAt, updatedAt

### credibilityData
id, businessId, campaignId, researchResults, verifiedFacts, credibilityScore, researchModel, researchCompletedAt, createdAt, updatedAt

### contentPages
id, businessId, campaignId, pageType, pageTitle, pageSlug, pageContent, metaDescription, schemaMarkup, interlinkTargets, status, publishedUrl, publishedAt, publishError, generationModel, generationPrompt, createdAt, updatedAt

### industryKeywordCache
id, industry, keywords, goldenTemplateKeywords, clientCount, isLocked, lockThreshold, lastRefreshedAt, createdAt, updatedAt

### rankSnapshots
id, campaignId, queryLocationId, chatgptMentioned, chatgptPosition, chatgptResponseSnippet, geminiMentioned, geminiPosition, geminiResponseSnippet, aiOverviewMentioned, aiOverviewPosition, aiOverviewResponseSnippet, sourcesCited, checkType, checkedAt

### clientDashboards
id, businessId, campaignId, accessToken, isActive, dashboardTitle, lastAccessedAt, accessCount, createdAt

### webhookLogs
id, source, payload, status, errorMessage, businessId, campaignId, ipAddress, processedAt, createdAt

### notificationLogs
id, businessId, campaignId, notificationType, recipientEmail, subject, body, status, resendMessageId, errorMessage, sentAt, createdAt

### llmTxtFiles
id, businessId, campaignId, content, publishedToSite, publishedAt, createdAt, updatedAt

### schemaMarkupRecommendations
id, businessId, campaignId, existingSchemaTypes, recommendedSchemaTypes, generatedSchema, publishedToSite, publishedAt, createdAt, updatedAt

## Foreign Key Relationships
- businesses.userId → users.id
- apiKeys.userId → users.id
- trainingSessions.userId → users.id
- trainingSessions.businessId → businesses.id
- trainingConversations.trainingSessionId → trainingSessions.id
- scheduledJobs.userId → users.id
- scheduledJobs.trainingSessionId → trainingSessions.id
- scheduledJobs.businessId → businesses.id
- scheduledJobRuns.scheduledJobId → scheduledJobs.id
- scheduledJobRuns.trainingSessionId → trainingSessions.id
- platformMetrics.userId → users.id
- promptTemplates.userId → users.id
- campaigns.userId → users.id
- campaigns.businessId → businesses.id
- campaigns.packageTierId → packageTiers.id
- campaignQueryLocations.campaignId → campaigns.id
- credibilityData.businessId → businesses.id
- credibilityData.campaignId → campaigns.id
- contentPages.businessId → businesses.id
- contentPages.campaignId → campaigns.id
- rankSnapshots.campaignId → campaigns.id
- rankSnapshots.queryLocationId → campaignQueryLocations.id
- clientDashboards.businessId → businesses.id
- clientDashboards.campaignId → campaigns.id
- webhookLogs (no FK constraints, just stores businessId/campaignId as ints)
- notificationLogs.businessId → businesses.id
- notificationLogs.campaignId → campaigns.id
- llmTxtFiles.businessId → businesses.id
- llmTxtFiles.campaignId → campaigns.id
- schemaMarkupRecommendations.businessId → businesses.id
- schemaMarkupRecommendations.campaignId → campaigns.id

## Enum Values
- role: user, admin
- ai_provider: openai, anthropic, google
- api_key_status: connected, disconnected
- training_status: paused, in_progress, completed, error
- schedule_type: hourly, daily, weekly, monthly, custom
- client_type: ai_only, ai_plus_seo, ai_plus_seo_plus_build
- campaign_status: pending, keyword_research, credibility_research, content_generation, publishing, indexing, baseline_check, training, monitoring, paused, error
- content_page_status: draft, generated, published, failed
- trainingPhase (varchar): pending, baseline, training, evaluation, completed
- conversationType (varchar): baseline, training, evaluation
- promptType (varchar): clean, suggestive, follow_up
- templateType (varchar): clean, suggestive, follow_up, category_based
- trainingAggressiveness (varchar): aggressive, moderate, maintenance
- rankCheckFrequency (varchar): daily, weekly, biweekly
- checkType (varchar): baseline, scheduled, recovery_check
- trainingStatus on campaignQueryLocations (varchar): pending, training, achieved, monitoring, recovering
