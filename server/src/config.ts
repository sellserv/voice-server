import 'dotenv/config';
import { resolve } from 'path';

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env var: ${key}`);
  return val;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

const jwtSecret = env('JWT_SECRET');
const commonPlaceholders = [
  'change-me-to-a-random-string',
  'secret',
  'jwt-secret',
  'changeme',
  'password',
];
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters. Run: openssl rand -hex 32');
}
if (commonPlaceholders.includes(jwtSecret.toLowerCase())) {
  throw new Error('JWT_SECRET must not be a common placeholder value. Run: openssl rand -hex 32');
}
if (/^(.)\1+$/.test(jwtSecret)) {
  throw new Error('JWT_SECRET must not be a repeated character. Run: openssl rand -hex 32');
}
// Entropy validation: require sufficient unique characters to prevent weak secrets
// Hex strings from `openssl rand -hex 32` (2 char classes but 256 bits of entropy) are allowed
{
  const uniqueChars = new Set(jwtSecret).size;
  if (uniqueChars < 10) {
    throw new Error(
      'JWT_SECRET has insufficient entropy. Use at least 10 unique characters. Run: openssl rand -hex 32',
    );
  }
}

export const config = {
  port: envInt('PORT', 3000),
  host: env('HOST', '127.0.0.1'),
  officialInstance: env('OFFICIAL_INSTANCE', 'false') === 'true',
  jwtSecret,
  corsOrigins: env('CORS_ORIGINS', '').split(',').filter(Boolean),
  dbPath: resolve(env('DB_PATH', './data/voip-server.db')),
  uploadDir: resolve(env('UPLOAD_DIR', './uploads')),
  maxFileSize: envInt('MAX_FILE_SIZE', 20 * 1024 * 1024),
  maxDailyUploadPerUser: envInt('MAX_DAILY_UPLOAD_PER_USER', 100 * 1024 * 1024),
  maxTotalDisk: envInt('MAX_TOTAL_DISK', 5 * 1024 * 1024 * 1024),
  adminUsers: env('ADMIN_USERS', '').split(',').map(s => s.trim()).filter(Boolean),
  giphyApiKey: env('GIPHY_API_KEY', ''),
  resendApiKey: env('RESEND_API_KEY', ''),
  emailFrom: env('EMAIL_FROM', ''),
  turnstileSiteKey: env('TURNSTILE_SITE_KEY', ''),
  turnstileSecretKey: env('TURNSTILE_SECRET_KEY', ''),
  firebase: {
    serviceAccount: env('FIREBASE_SERVICE_ACCOUNT', ''),
  },
  stripe: {
    secretKey: env('STRIPE_SECRET_KEY', ''),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
    priceId: env('STRIPE_PRO_PRICE_ID', ''),
    portalReturnUrl: env('STRIPE_PORTAL_RETURN_URL', ''),
  },
  oauth2: {
    clientId: env('OAUTH2_CLIENT_ID', 'admin-console'),
    clientSecret: env('OAUTH2_CLIENT_SECRET', ''),
    redirectUri: env('OAUTH2_REDIRECT_URI', ''),
  },
  mediasoup: {
    announcedIp: env('MEDIASOUP_ANNOUNCED_IP', '127.0.0.1'),
    minPort: envInt('MEDIASOUP_MIN_PORT', 40000),
    maxPort: envInt('MEDIASOUP_MAX_PORT', 40100),
  },

  // Database adapter
  dbType: env('DB_TYPE', 'sqlite') as 'sqlite' | 'postgres',
  databaseUrl: env('DATABASE_URL', ''),

  // Redis (optional — if empty, use in-memory adapters)
  redisUrl: env('REDIS_URL', ''),

  // Voice adapter
  voiceType: env('VOICE_TYPE', 'mediasoup') as 'mediasoup' | 'livekit',
  livekit: {
    url: env('LIVEKIT_URL', ''),
    publicUrl: env('LIVEKIT_PUBLIC_URL', '') || env('LIVEKIT_URL', ''),
    apiKey: env('LIVEKIT_API_KEY', ''),
    apiSecret: env('LIVEKIT_API_SECRET', ''),
  },

  // Storage adapter
  storageType: env('STORAGE_TYPE', 'local') as 'local' | 's3',
  s3: {
    endpoint: env('S3_ENDPOINT', ''),
    bucket: env('S3_BUCKET', ''),
    accessKey: env('S3_ACCESS_KEY', ''),
    secretKey: env('S3_SECRET_KEY', ''),
    publicUrl: env('S3_PUBLIC_URL', ''),
  },
} as const;
