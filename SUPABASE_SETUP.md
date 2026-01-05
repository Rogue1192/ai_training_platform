# Supabase Setup Guide

This guide will help you set up Supabase for both authentication and database in the AI Training Platform.

## Prerequisites

- A Supabase account (sign up at https://supabase.com)
- Your Supabase project created (https://supabase.com/dashboard/project/dhmqeiqeemksoglvhjro)

## Step 1: Get Supabase Credentials

### Authentication Keys

1. Go to your Supabase project dashboard
2. Click **Settings** (gear icon) → **API**
3. Copy these values:

   - **Project URL**: `https://dhmqeiqeemksoglvhjro.supabase.co`
   - **anon public** key (under "Project API keys")
   - **service_role** key (under "Project API keys")

### Database Connection String

1. In the same **Settings** → **Database** section
2. Scroll down to **Connection string**
3. Select **URI** tab
4. Copy the connection string (looks like: `postgresql://postgres:[YOUR-PASSWORD]@db.dhmqeiqeemksoglvhjro.supabase.co:5432/postgres`)
5. Replace `[YOUR-PASSWORD]` with your database password

**Important**: If you don't know your database password:
- Go to **Settings** → **Database**
- Click **"Reset Database Password"**
- Copy the new password and update your connection string

## Step 2: Configure Environment Variables

### For Local Development

Create a `.env` file in the project root:

```env
# Supabase Auth
SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
VITE_SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>

# Supabase Database
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.dhmqeiqeemksoglvhjro.supabase.co:5432/postgres

# Redis (for training queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=<your-random-jwt-secret>

# Node Environment
NODE_ENV=development
```

### For Railway Deployment

Add these environment variables in Railway:

1. Go to your Railway project
2. Click on your **ai-trainer** service
3. Go to **Variables** tab
4. Add these variables:

```
SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
VITE_SUPABASE_URL=https://dhmqeiqeemksoglvhjro.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.dhmqeiqeemksoglvhjro.supabase.co:5432/postgres
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
JWT_SECRET=<your-random-jwt-secret>
NODE_ENV=production
```

## Step 3: Run Database Migrations

### Option A: Using Drizzle CLI (Recommended)

```bash
# Install dependencies
pnpm install

# Push schema to Supabase database
pnpm db:push
```

### Option B: Using Supabase SQL Editor

1. Go to your Supabase project
2. Click **SQL Editor** in the left sidebar
3. Click **"New query"**
4. Copy the contents of `drizzle/0000_smiling_sir_ram.sql`
5. Paste into the SQL editor
6. Click **"Run"** or press Cmd/Ctrl + Enter

## Step 4: Configure Authentication

### Disable Email Confirmation (Development Only)

For faster development without email verification:

1. Go to **Authentication** → **Providers**
2. Click on **Email**
3. Toggle **OFF** "Enable email confirmations"
4. Click **Save**

### Enable Email Confirmation (Production)

For production, keep email confirmations enabled:

1. Go to **Authentication** → **Email Templates**
2. Customize the confirmation email template
3. Configure SMTP settings in **Settings** → **Auth** → **SMTP Settings**

## Step 5: Test the Setup

### Test Authentication

1. Start your development server: `pnpm dev`
2. Visit http://localhost:3000/login
3. Create a test account with email/password
4. Verify you can log in successfully

### Test Database

1. After logging in, try creating a business in the Businesses section
2. Check Supabase dashboard → **Table Editor** → **businesses** table
3. You should see your test data

## Troubleshooting

### "supabaseUrl is required" Error

- Make sure all four Supabase environment variables are set
- Restart your development server after adding variables
- Check that variable names match exactly (case-sensitive)

### Database Connection Failed

- Verify your DATABASE_URL is correct
- Make sure you replaced `[YOUR-PASSWORD]` with actual password
- Check that your IP is allowed in Supabase (Settings → Database → Connection pooling)
- Try resetting your database password

### Authentication Not Working

- Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
- Check browser console for errors
- Make sure you're using the `anon public` key, not the `service_role` key for VITE_SUPABASE_ANON_KEY

### Migrations Failed

- Check that DATABASE_URL has correct permissions
- Verify the database user has CREATE TABLE privileges
- Try running migrations one table at a time

## Security Notes

- **Never commit `.env` file to git** - it contains sensitive credentials
- **Use service_role key only on the backend** - it bypasses Row Level Security
- **Use anon public key on the frontend** - it respects Row Level Security policies
- **Rotate keys regularly** in production environments
- **Enable Row Level Security (RLS)** on all tables in production

## Next Steps

After setup is complete:

1. Add your AI provider API keys in Settings
2. Create your first business/client
3. Set up a training session
4. Configure scheduled jobs for automated training

## Support

If you encounter issues:

1. Check Supabase logs: **Logs** → **Postgres Logs**
2. Check application logs in your terminal
3. Verify all environment variables are set correctly
4. Ensure database migrations ran successfully
