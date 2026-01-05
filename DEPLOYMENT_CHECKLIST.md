# Railway Deployment Checklist

Follow these steps in order for a successful deployment.

## Pre-Deployment

- [ ] Commit and push all code to GitHub
- [ ] Verify all tests pass locally (`pnpm test`)
- [ ] Review environment variables needed

## Railway Setup (15 minutes)

### 1. Create Project
- [ ] Go to https://railway.app
- [ ] Click "New Project" → "Deploy from GitHub repo"
- [ ] Select `Rogue1192/ai-trainer`
- [ ] Wait for initial build

### 2. Add Databases
- [ ] Click "New" → "Database" → "Add MySQL"
- [ ] Click "New" → "Database" → "Add Redis"
- [ ] Wait for provisioning (~2 minutes)

### 3. Configure Environment Variables
Click on your web service → "Variables" tab → Add:

```
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
JWT_SECRET=<generate-random-32-char-string>
NODE_ENV=production
```

**Generate JWT_SECRET:**
```bash
openssl rand -base64 32
```

- [ ] All variables added
- [ ] JWT_SECRET is unique and secure
- [ ] Click "Deploy" to restart with new variables

### 4. Run Database Migrations

**Option A: Railway CLI**
```bash
npm i -g @railway/cli
railway login
railway link
railway run pnpm db:push
```

**Option B: One-time Service**
- [ ] In Railway, click "New" → "Empty Service"
- [ ] Go to "Settings" → Set same variables as web service
- [ ] Go to "Settings" → Set start command: `pnpm db:push`
- [ ] Deploy once, then delete service

- [ ] Migrations completed successfully
- [ ] Check logs for "Migration complete"

## Post-Deployment

### 5. Verify Deployment
- [ ] Get your Railway URL (Settings → Networking)
- [ ] Visit the URL
- [ ] Login page loads correctly
- [ ] No errors in browser console

### 6. Configure Application
- [ ] Log in to the application
- [ ] Go to Settings page
- [ ] Add OpenAI API key (if using)
- [ ] Add Anthropic API key (if using)
- [ ] Add Google AI API key (if using)
- [ ] Test API key verification

### 7. Test Core Features
- [ ] Create a test business
- [ ] Create a test training session
- [ ] Start a training session
- [ ] Check logs for training progress
- [ ] Verify training appears in history
- [ ] Test pause/resume functionality

### 8. Monitor
- [ ] Check Railway logs for errors
- [ ] Check MySQL database has tables
- [ ] Check Redis is connected
- [ ] Monitor memory/CPU usage

## Optional: Custom Domain

- [ ] Go to Settings → Networking → Add Custom Domain
- [ ] Add CNAME record to your DNS provider
- [ ] Wait for DNS propagation (~5-60 minutes)
- [ ] Verify HTTPS certificate issued

## Troubleshooting

### Build Fails
```bash
# Check logs in Railway dashboard
# Common issues:
# - Missing dependencies → check package.json
# - Node version mismatch → verify Node 22.x
```

### Database Connection Error
```bash
# Verify DATABASE_URL is set correctly
# Check MySQL service is running
# Try restarting web service
```

### Redis Connection Error
```bash
# Verify REDIS_HOST and REDIS_PORT are set
# Check Redis service is running
# Ensure Redis is in same Railway project
```

### App Won't Start
```bash
# Check environment variables are set
# Verify migrations ran successfully
# Check logs for specific error messages
```

## Success Criteria

✅ App is accessible at Railway URL
✅ Login works
✅ Can create businesses
✅ Can create training sessions
✅ Training sessions execute successfully
✅ No errors in logs
✅ Database tables populated correctly

## Estimated Time

- Setup: 10-15 minutes
- Testing: 5-10 minutes
- **Total: 15-25 minutes**

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- GitHub Issues: https://github.com/Rogue1192/ai-trainer/issues

---

**Last Updated**: December 28, 2025
