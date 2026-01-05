# Redis Setup for AI Training Platform

The AI Training Platform uses Redis as a job queue backend for managing training sessions. This prevents memory leaks and allows training to continue even if the server restarts.

## Why Redis is Required

The training queue system (BullMQ) requires Redis for:
- **Job persistence**: Training sessions survive server restarts
- **Distributed processing**: Multiple servers can process jobs
- **Rate limiting**: Prevents hitting AI provider rate limits
- **Retry logic**: Automatic retry on failures

## Local Development Setup

### Option 1: Docker (Recommended)

```bash
# Start Redis in Docker
docker run -d --name redis-training -p 6379:6379 redis:7-alpine

# Verify it's running
docker ps | grep redis-training
```

### Option 2: Native Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download from https://github.com/microsoftarchive/redis/releases

## Production Setup

### Railway (Recommended for this project)

1. Go to your Railway project dashboard
2. Click "New" → "Database" → "Add Redis"
3. Railway will automatically provision Redis and set environment variables
4. The app will automatically connect using the `REDIS_HOST` and `REDIS_PORT` variables

### Other Options

- **Redis Cloud**: https://redis.com/try-free/
- **AWS ElastiCache**: https://aws.amazon.com/elasticache/
- **DigitalOcean Managed Redis**: https://www.digitalocean.com/products/managed-databases-redis

## Environment Variables

Add these to your `.env` file:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # Optional, for production
```

## Verifying Redis Connection

```bash
# Test Redis connection
redis-cli ping
# Should return: PONG

# Check if queue is working
redis-cli keys "bull:training-iterations:*"
```

## Queue Monitoring

The platform includes built-in queue statistics:

```typescript
import { getQueueStats } from './server/trainingQueue';

const stats = await getQueueStats();
console.log(stats);
// {
//   waiting: 5,
//   active: 2,
//   completed: 100,
//   failed: 3,
//   delayed: 10
// }
```

## Troubleshooting

### "ECONNREFUSED ::1:6379"
Redis is not running. Start Redis using one of the methods above.

### "NOAUTH Authentication required"
Redis requires a password. Set `REDIS_PASSWORD` in your environment variables.

### Jobs not processing
Check Redis is running and the worker is started:
```bash
# Check Redis
redis-cli ping

# Check worker logs
# Look for: "[Training Worker] Worker started"
```

## Performance Tuning

For high-volume training:

```bash
# In redis.conf or via environment
maxmemory 2gb
maxmemory-policy allkeys-lru
```

## Security

**Production checklist:**
- [ ] Enable Redis password authentication
- [ ] Use TLS/SSL for Redis connections
- [ ] Restrict Redis network access (firewall rules)
- [ ] Regular backups of Redis data
- [ ] Monitor Redis memory usage

## Alternative: Running Without Redis (Not Recommended)

If you absolutely cannot use Redis, you can temporarily disable the queue system by:

1. Commenting out the worker initialization in `server/_core/index.ts`
2. Modifying `startTrainingSession` to use the old synchronous approach

**Warning**: This will bring back the memory leak issues and training sessions won't survive server restarts.
