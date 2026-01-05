# Railway Deployment Guide for AI Training Platform

This guide walks you through deploying the AI Training Platform to Railway with all required services.

## Prerequisites

- Railway account (sign up at https://railway.app)
- GitHub account with the ai-trainer repository
- Credit card for Railway (they offer $5 free credit monthly)

---

## Step 1: Create Railway Project

1. Go to https://railway.app and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize Railway to access your GitHub account
5. Select the **`Rogue1192/ai-trainer`** repository
6. Railway will automatically detect the project and start building

---

## Step 2: Add MySQL Database

The platform requires a MySQL database for storing businesses, training sessions, and API keys.

1. In your Railway project dashboard, click **"New"**
2. Select **"Database"** → **"Add MySQL"**
3. Railway will provision a MySQL instance and automatically set these environment variables:
   - `MYSQL_URL`
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_DATABASE`

4. **Important**: The app expects `DATABASE_URL`, so we need to add it:
   - Click on your **web service** (not the database)
   - Go to **"Variables"** tab
   - Click **"New Variable"**
   - Add: `DATABASE_URL` = `${{MySQL.MYSQL_URL}}`
   - This references the MySQL connection string

---

## Step 3: Add Redis Database

Redis is required for the job queue system that manages training sessions.

1. In your Railway project dashboard, click **"New"**
2. Select **"Database"** → **"Add Redis"**
3. Railway will provision Redis and set these variables:
   - `REDIS_URL`
   - `REDIS_HOST`
   - `REDIS_PORT`

4. The app will automatically use these variables (already configured in `trainingQueue.ts`)

---

## Step 4: Configure Environment Variables

Add the required environment variables to your web service:

1. Click on your **web service**
2. Go to **"Variables"** tab
3. Add these variables:

### Required Variables:

```
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
JWT_SECRET=<generate-a-random-string-here>
NODE_ENV=production
```

### Generate JWT_SECRET:

You can generate a secure random string using:
```bash
# On Linux/Mac
openssl rand -base64 32

# Or use an online generator
# https://generate-secret.vercel.app/32
```

### Optional Variables (for OAuth):

If you're using Manus OAuth (already configured in the template):
```
OAUTH_SERVER_URL=<your-oauth-server>
VITE_OAUTH_PORTAL_URL=<your-oauth-portal>
VITE_APP_ID=<your-app-id>
OWNER_OPEN_ID=<your-open-id>
OWNER_NAME=<your-name>
```

---

## Step 5: Configure Build Settings

Railway should auto-detect the build settings, but verify:

1. Click on your **web service**
2. Go to **"Settings"** tab
3. Verify these settings:

**Build Command:**
```
pnpm install && pnpm build
```

**Start Command:**
```
pnpm start
```

**Root Directory:** (leave empty or set to `/`)

---

## Step 6: Run Database Migrations

After the first deployment, you need to push the database schema:

1. In Railway, click on your **web service**
2. Go to **"Deployments"** tab
3. Click on the latest deployment
4. Click **"View Logs"**
5. You should see the app starting

To run migrations, you have two options:

### Option A: Use Railway CLI (Recommended)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run migrations
railway run pnpm db:push
```

### Option B: Add Migration to Start Script

Modify `package.json` to run migrations on startup:

```json
{
  "scripts": {
    "start": "pnpm db:push && NODE_ENV=production node dist/index.js"
  }
}
```

Then redeploy.

---

## Step 7: Verify Deployment

1. Railway will provide a public URL (e.g., `https://your-app.up.railway.app`)
2. Click on **"Settings"** → **"Networking"** to see your URL
3. Visit the URL to verify the app is running
4. You should see the login page

---

## Step 8: Set Up Custom Domain (Optional)

1. In Railway, click on your **web service**
2. Go to **"Settings"** → **"Networking"**
3. Click **"Add Custom Domain"**
4. Enter your domain (e.g., `ai-trainer.yourdomain.com`)
5. Railway will provide DNS records to add to your domain registrar:
   - Add a CNAME record pointing to Railway's domain

---

## Step 9: Monitor Your Deployment

### View Logs:
1. Click on your **web service**
2. Go to **"Deployments"**
3. Click on a deployment to view logs

### Check Metrics:
1. Go to **"Observability"** tab
2. View CPU, Memory, and Network usage

### Check Database:
1. Click on your **MySQL** service
2. Go to **"Data"** tab to view tables
3. Or use **"Connect"** to get connection details for a SQL client

---

## Step 10: Configure AI Provider API Keys

Once deployed, you need to add your AI provider API keys:

1. Visit your deployed app URL
2. Log in (or create an account)
3. Go to **Settings** page
4. Add your API keys for:
   - OpenAI
   - Anthropic
   - Google AI

These will be encrypted and stored securely in the database.

---

## Troubleshooting

### Build Fails

**Error: "Cannot find module"**
- Check that all dependencies are in `package.json`
- Try: `railway run pnpm install`

**Error: "Build command failed"**
- Check build logs for specific errors
- Verify Node version (should be 22.x)

### Database Connection Fails

**Error: "ECONNREFUSED" or "Database not available"**
- Verify `DATABASE_URL` is set correctly
- Check MySQL service is running
- Try restarting the web service

### Redis Connection Fails

**Error: "Redis connection refused"**
- Verify Redis service is running
- Check `REDIS_HOST` and `REDIS_PORT` are set
- Redis should be on the same Railway project

### App Crashes on Startup

**Check logs for:**
- Missing environment variables
- Database migration errors
- Port binding issues

**Common fixes:**
- Ensure `PORT` is not hardcoded (Railway sets it automatically)
- Check all required env vars are set
- Verify database is accessible

---

## Cost Estimates

Railway pricing (as of 2024):

- **Free Tier**: $5 credit/month
  - Good for testing
  - May need to upgrade for production

- **Hobby Plan**: $5/month + usage
  - MySQL: ~$5-10/month
  - Redis: ~$5/month
  - Web Service: ~$5-15/month (depending on usage)
  - **Total**: ~$20-35/month

- **Pro Plan**: $20/month + usage
  - Better for production workloads

---

## Production Checklist

Before going live:

- [ ] All environment variables configured
- [ ] Database migrations run successfully
- [ ] Redis is connected and working
- [ ] AI provider API keys added
- [ ] Test creating a business
- [ ] Test creating a training session
- [ ] Test starting a training session
- [ ] Monitor logs for errors
- [ ] Set up custom domain (optional)
- [ ] Configure backups for MySQL
- [ ] Set up monitoring/alerts

---

## Scaling Considerations

As your usage grows:

1. **Vertical Scaling**: Upgrade Railway service resources
2. **Database**: Consider upgrading MySQL instance size
3. **Redis**: Monitor memory usage, upgrade if needed
4. **Workers**: The queue system can handle multiple workers
5. **Monitoring**: Set up error tracking (Sentry, LogRocket)

---

## Backup Strategy

**Database Backups:**
Railway provides automatic backups for MySQL, but you should also:

1. Set up automated exports:
```bash
railway run mysqldump -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE > backup.sql
```

2. Store backups in S3 or similar storage

**Redis Backups:**
Redis data is ephemeral (job queue), but you can enable persistence:
- Railway Redis includes RDB snapshots
- Configure in Redis settings if needed

---

## Support

- **Railway Docs**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway
- **Project Issues**: https://github.com/Rogue1192/ai-trainer/issues

---

## Quick Deploy Summary

```bash
# 1. Create Railway project from GitHub
# 2. Add MySQL database
# 3. Add Redis database
# 4. Set environment variables:
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
JWT_SECRET=<random-string>
NODE_ENV=production

# 5. Run migrations
railway run pnpm db:push

# 6. Visit your app URL and configure API keys
```

That's it! Your AI Training Platform should now be live on Railway.
