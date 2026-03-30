# Database-to-Code Audit Findings

## db.ts Audit

### Column References Checked
All column references in db.ts match schema.ts exactly:
- users: openId, name, email, loginMethod, role, lastSignedIn, createdAt ✅
- businesses: userId, id, createdAt ✅
- apiKeys: userId, provider, id, createdAt ✅
- trainingSessions: userId, id, status, createdAt ✅
- trainingConversations: trainingSessionId, iterationNumber, responseTime, createdAt ✅
- scheduledJobs: userId, id, createdAt ✅
- scheduledJobRuns: scheduledJobId, trainingSessionId, status, startedAt, completedAt, errorMessage, baselineMentioned, evaluationMentioned, influenceScore, iterationsCompleted, triggeredBy, jobName(join) ✅
- platformMetrics: userId, date ✅
- promptTemplates: userId, templateType, templateName, templateContent, isActive, sortOrder, createdAt, updatedAt ✅

### Issues Found: NONE
All queries reference valid columns. All joins use correct foreign keys.

### Potential Concern
- getAllScheduledJobRuns (line 410-429): select statement only picks a subset of columns (missing baselineMentioned, evaluationMentioned, influenceScore, triggeredBy). This is intentional for the team-wide view but means the return type `ScheduledJobRun & { jobName }` is slightly inaccurate — it's a partial. Cast as `any` covers it but could mask issues. LOW PRIORITY.

## dbCampaigns.ts Audit

### Column References Checked
All column references match schema.ts:
- packageTiers: name, slug, maxQueries, maxLocations, description, monthlyPrice, isActive, sortOrder ✅
- campaigns: userId, businessId, packageTierId, campaignName, status, clientType, all timestamp fields, trainingAggressiveness, rankCheckFrequency, lastError, errorCount, sourceWebhookId ✅
- campaignQueryLocations: campaignId, searchQuery, location, aiSearchVolume, monthlyTrend, all rank fields ✅
- credibilityData: businessId, researchResults, verifiedFacts, credibilityScore ✅
- contentPages: campaignId, pageType, pageTitle, pageSlug, pageContent, status, publishedUrl ✅
- industryKeywordCache: industry, keywords, goldenTemplateKeywords, clientCount, isLocked, lockThreshold ✅
- rankSnapshots: campaignId, queryLocationId, checkedAt ✅
- clientDashboards: accessToken, isActive, campaignId, lastAccessedAt, accessCount ✅
- webhookLogs: source, payload, status, errorMessage, createdAt ✅
- notificationLogs: all fields ✅
- llmTxtFiles: businessId, content ✅
- schemaMarkupRecommendations: businessId ✅
- businesses (join): name, businessType, website ✅

### getCampaignsWithBusinessInfo join
Both userId-filtered and team-wide versions select ALL campaign columns explicitly. Verified each matches schema.ts. ✅

### Issues Found: NONE
All queries, joins, and column references are correct.
