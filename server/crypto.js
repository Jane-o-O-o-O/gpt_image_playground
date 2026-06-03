import crypto from 'node:crypto'
import { getEncryptionKey, env } from './env.js'

export function hashToken(token) {
  return crypto.createHmac('sha256', env.sessionSecret).update(token).digest('hex')
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function encryptText(plainText) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptText(payload) {
  const [ivText, tagText, encryptedText] = String(payload || '').split('.')
  if (!ivText || !tagText || !encryptedText) throw new Error('Invalid encrypted payload')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384 }, (err, key) => err ? reject(err) : resolve(key))
  })
  return `scrypt:${salt.toString('base64url')}:${Buffer.from(hash).toString('base64url')}`
}

export async function verifyPassword(password, storedHash) {
  const [scheme, saltText, hashText] = String(storedHash || '').split(':')
  if (scheme !== 'scrypt' || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64url')
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(saltText, 'base64url'), 64, { N: 16384 }, (err, key) => err ? reject(err) : resolve(key))
  })
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
