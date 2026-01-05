# Supabase Authentication Setup Guide

This guide walks you through setting up Supabase Auth for the AI Training Platform.

## Step 1: Create Supabase Project

1. Go to https://supabase.com and sign in (or create account)
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: `ai-training-platform` (or your choice)
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to your users
   - **Pricing Plan**: Free tier is fine for development
4. Click **"Create new project"**
5. Wait 2-3 minutes for project to be provisioned

## Step 2: Get API Keys

1. In your Supabase project dashboard, go to **Settings** (gear icon) → **API**
2. You'll see two important values:

**Project URL:**
```
https://xxxxxxxxxxxxx.supabase.co
```

**anon public key:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**service_role key** (scroll down):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **Important**: Keep the `service_role` key secret! Never expose it in frontend code.

## Step 3: Configure Authentication

1. In Supabase dashboard, go to **Authentication** → **Providers**
2. Enable **Email** provider (should be enabled by default)
3. Configure email settings:
   - **Enable email confirmations**: Toggle ON for production, OFF for development
   - **Secure email change**: Toggle ON
   - **Secure password change**: Toggle ON

### Optional: Add Social Providers

You can also enable Google, GitHub, etc. for social login:
1. Go to **Authentication** → **Providers**
2. Enable desired providers (Google, GitHub, etc.)
3. Follow Supabase instructions to configure OAuth apps

## Step 4: Set Environment Variables

### For Railway Deployment:

1. Go to your Railway project
2. Click on your **web service**
3. Go to **"Variables"** tab
4. Add these variables:

```bash
# Supabase Configuration
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Keep existing variables
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
JWT_SECRET=<your-existing-jwt-secret>
NODE_ENV=production
```

### For Local Development:

Create a `.env` file in the project root:

```bash
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Database
DATABASE_URL=mysql://user:password@localhost:3306/ai_training

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-random-secret-here
```

## Step 5: Test Authentication

1. Deploy or restart your application
2. Visit `/login` route
3. Try creating an account:
   - Enter email and password
   - Click "Sign up"
   - Check your email for confirmation (if enabled)
4. Try logging in with the account

## Step 6: Configure Email Templates (Optional)

Customize the emails Supabase sends:

1. Go to **Authentication** → **Email Templates**
2. Customize templates for:
   - **Confirm signup**: Welcome email with confirmation link
   - **Invite user**: Team invitation emails
   - **Magic Link**: Passwordless login
   - **Change Email Address**: Email change confirmation
   - **Reset Password**: Password reset emails

## Step 7: Set Up Row Level Security (RLS)

Since we're using our own MySQL database for business data, you don't need to set up RLS in Supabase. Supabase is only handling authentication.

However, if you want to store additional data in Supabase's PostgreSQL database:

1. Go to **Table Editor**
2. Create tables as needed
3. Go to **Authentication** → **Policies**
4. Enable RLS and create policies

## Authentication Flow

### Sign Up:
1. User enters email/password on `/login`
2. Frontend calls `supabase.auth.signUp()`
3. Supabase creates user account
4. Confirmation email sent (if enabled)
5. User clicks confirmation link
6. User can now log in

### Sign In:
1. User enters credentials on `/login`
2. Frontend calls `supabase.auth.signInWithPassword()`
3. Supabase returns session token
4. Frontend stores token in localStorage
5. All API requests include token in Authorization header
6. Backend verifies token with Supabase
7. Backend syncs user to MySQL database

### API Requests:
```typescript
// Frontend automatically includes token
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;

// tRPC client adds to headers
headers: {
  Authorization: `Bearer ${token}`
}

// Backend verifies token
const { data: { user } } = await supabase.auth.getUser(token);
```

## Troubleshooting

### "Invalid API key"
- Check that SUPABASE_URL and keys are correct
- Verify no extra spaces in environment variables
- Make sure you're using the right key (anon for frontend, service_role for backend)

### "Email not confirmed"
- Check spam folder for confirmation email
- Disable email confirmation in development:
  - Go to Authentication → Providers → Email
  - Toggle OFF "Enable email confirmations"

### "User already registered"
- User with that email already exists
- Use "Sign in" instead of "Sign up"
- Or delete user from Supabase dashboard: Authentication → Users

### Authentication not working after deployment
- Verify all environment variables are set in Railway
- Check Railway logs for errors
- Ensure VITE_ prefixed variables are set (needed for frontend)

## Security Best Practices

✅ **DO:**
- Use `service_role` key only on backend
- Use `anon` key on frontend
- Enable email confirmation in production
- Use strong passwords (min 8 characters)
- Enable 2FA for Supabase dashboard
- Regularly rotate service_role key

❌ **DON'T:**
- Expose service_role key in frontend code
- Commit API keys to Git
- Use weak passwords
- Disable email confirmation in production
- Share service_role key publicly

## Next Steps

After authentication is working:

1. **Add user roles**: Extend the `users` table with role column
2. **Implement authorization**: Check user roles in backend procedures
3. **Add password reset**: Implement forgot password flow
4. **Add profile management**: Let users update their profile
5. **Add team invitations**: Allow users to invite team members

## Support

- **Supabase Docs**: https://supabase.com/docs/guides/auth
- **Supabase Discord**: https://discord.supabase.com
- **Project Issues**: https://github.com/Rogue1192/ai_training_platform/issues

---

**Estimated Setup Time**: 10-15 minutes
