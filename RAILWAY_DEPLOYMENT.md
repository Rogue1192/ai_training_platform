# Railway Deployment Guide (Supabase Database)

This guide will help you deploy the AI Training Platform to Railway using Supabase for both authentication and database.

## Architecture Overview

- **Railway**: Hosts the web application and Redis
- **Supabase**: Provides authentication and PostgreSQL database
- **No MySQL needed**: Everything uses Supabase PostgreSQL

## Prerequisites

- Railway account (https://railway.app)
- Supabase project set up (follow SUPABASE_SETUP.md first)
- GitHub repository with your code

## Step 1: Create Railway Project

1. Go to https://railway.app
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose `Rogue1192/ai_training_platform`
5. Railway will automatically detect the configuration

## Step 2: Add Redis Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"Redis"**
3. Redis will be automatically provisioned

## Step 3: Configure Environment Variables

Click on your **ai-trainer** web service, go to **Variables** tab, and add:

### Supabase Configuration

```
SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Settings → API>
VITE_SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
VITE_SUPABASE_ANON_KEY=<from Supabase Settings → API>
```

### Database Configuration

```
DATABASE_URL=<from Supabase Settings → Database → Connection string>
```

Format: `postgresql://postgres:[PASSWORD]@db.dhmqeiqeemksoglvhjro.supabase.co:5432/postgres`

### Redis Configuration

```
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
```

### Security Configuration

```
JWT_SECRET=<generate with: openssl rand -base64 32>
NODE_ENV=production
```

## Step 4: Run Database Migrations

### Option A: Temporary Start Command (Recommended)

1. Go to **Settings** tab
2. Find **"Start Command"**
3. Change from `pnpm start` to:
   ```
   pnpm db:push && pnpm start
   ```
4. Click **"Deploy"** (top right)
5. Watch the logs - you should see migration output
6. After successful deployment, change Start Command back to:
   ```
   pnpm start
   ```

### Option B: Use Supabase SQL Editor

1. Go to Supabase project → **SQL Editor**
2. Copy contents of `drizzle/0000_smiling_sir_ram.sql`
3. Paste and run in SQL Editor
4. Deploy normally on Railway

## Step 5: Verify Deployment

1. Click on your web service
2. Go to **"Deployments"** tab
3. Click on the latest deployment
4. Check logs for:
   - ✅ "Server running on..."
   - ✅ "[Supabase] Initialized successfully"
   - ❌ No "supabaseUrl is required" errors

5. Click the deployment URL to open your app
6. Try logging in at `/login`

## Estimated Costs

### Development (Free Tier)
- Railway: $5/month credit (free)
- Supabase: Free tier (500MB database, 50MB storage)
- **Total**: $0/month

### Production
- Railway Web Service: ~$5-10/month
- Railway Redis: ~$5/month
- Supabase Pro: $25/month (8GB database, 100GB storage)
- **Total**: ~$35-40/month

## Troubleshooting

### Deployment Fails with "supabaseUrl is required"

**Cause**: Missing Supabase environment variables

**Fix**:
1. Verify all 4 Supabase variables are set in Railway
2. Check variable names match exactly (case-sensitive)
3. Redeploy after adding variables

### Database Connection Errors

**Cause**: Incorrect DATABASE_URL or Supabase IP restrictions

**Fix**:
1. Verify DATABASE_URL format is correct
2. Make sure password is correct (no brackets)
3. In Supabase: Settings → Database → disable "Restrict connections to IPv4"

### Redis Connection Errors

**Cause**: Redis service not linked or wrong variables

**Fix**:
1. Make sure Redis service is created in Railway
2. Verify REDIS_HOST and REDIS_PORT use Railway references: `${{Redis.REDIS_HOST}}`
3. Restart the web service

### Migrations Don't Run

**Cause**: Start command doesn't include migration

**Fix**:
1. Use temporary start command: `pnpm db:push && pnpm start`
2. Or run migrations manually in Supabase SQL Editor
3. Check logs for migration errors

### App Loads But Can't Login

**Cause**: Frontend Supabase variables missing

**Fix**:
1. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
2. These MUST start with `VITE_` to be available in frontend
3. Redeploy after adding variables

## Monitoring

### View Logs

1. Click on your web service
2. Go to **"Deployments"** tab
3. Click on active deployment
4. View real-time logs

### Check Database

1. Go to Supabase dashboard
2. Click **"Table Editor"**
3. View your tables and data
4. Check **"Logs"** → **"Postgres Logs"** for database errors

### Monitor Redis

1. In Railway, click on Redis service
2. Go to **"Metrics"** tab
3. View memory usage and connection stats

## Security Best Practices

1. **Rotate secrets regularly**
   - JWT_SECRET
   - Supabase service_role key

2. **Enable Row Level Security (RLS)** in Supabase
   - Go to Table Editor
   - Enable RLS on all tables
   - Create policies for user access

3. **Use environment-specific keys**
   - Different Supabase projects for dev/staging/prod
   - Different JWT secrets per environment

4. **Monitor logs**
   - Check for unauthorized access attempts
   - Monitor API usage in Supabase dashboard

5. **Backup database**
   - Supabase Pro includes daily backups
   - Export data regularly for extra safety

## CI/CD

Railway automatically deploys when you push to GitHub:

1. Push code to `main` branch
2. Railway detects changes
3. Builds and deploys automatically
4. Check deployment logs for errors

To disable auto-deploy:
1. Go to **Settings** → **Source**
2. Toggle off **"Auto Deploy"**

## Custom Domain

1. Go to **Settings** → **"Domains"**
2. Click **"+ Custom Domain"**
3. Enter your domain (e.g., `ai-trainer.yourdomain.com`)
4. Add DNS records as shown
5. Wait for DNS propagation (5-30 minutes)

## Support

If you encounter issues:

1. Check Railway logs for errors
2. Check Supabase logs (Postgres + Auth)
3. Verify all environment variables
4. Test locally first with same variables
5. Contact Railway support: https://railway.app/help

## Next Steps

After successful deployment:

1. Set up custom domain
2. Configure email templates in Supabase
3. Add your AI provider API keys in Settings
4. Create your first training session
5. Monitor usage and costs
