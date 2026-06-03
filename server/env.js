import crypto from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config()
dotenv.config({ path: '.env.local', override: false })

export const env = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  apiKeyEncryptionSecret: process.env.API_KEY_ENCRYPTION_SECRET || 'dev-api-key-secret-change-me',
  defaultApiBaseUrl: process.env.API_PROXY_URL || 'https://api.jane-zz.me/v1',
  adminEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  nodeEnv: process.env.NODE_ENV || 'development',
}

export function requireServerEnv() {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }
}

export function getEncryptionKey() {
  return crypto.createHash('sha256').update(env.apiKeyEncryptionSecret).digest()
}
