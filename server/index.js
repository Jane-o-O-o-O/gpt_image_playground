import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { PrismaClient } from '@prisma/client'
import { env, requireServerEnv } from './env.js'
import { createSessionToken, decryptText, encryptText, hashPassword, hashToken, verifyPassword } from './crypto.js'

requireServerEnv()

const prisma = new PrismaClient()
const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 })
const SESSION_COOKIE = 'gip_session'
const SESSION_DAYS = 30

await app.register(cookie, {
  secret: env.sessionSecret,
})

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
  }
}

function setSessionCookie(reply, token, expiresAt) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    expires: expiresAt,
  })
}

function clearSessionCookie(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

async function createSession(reply, userId) {
  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  })
  setSessionCookie(reply, token, expiresAt)
}

async function getUserFromRequest(request) {
  const token = request.cookies?.[SESSION_COOKIE]
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  return session.user
}

async function requireUser(request, reply) {
  const user = await getUserFromRequest(request)
  if (!user) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Please sign in first' })
    return null
  }
  return user
}

function parseProfileBody(body) {
  const record = body && typeof body === 'object' ? body : {}
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  return {
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Default',
    provider: typeof record.provider === 'string' && record.provider.trim() ? record.provider.trim() : 'openai',
    baseUrl: typeof record.baseUrl === 'string' && record.baseUrl.trim() ? record.baseUrl.trim().replace(/\/+$/, '') : env.defaultApiBaseUrl,
    apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : 'gpt-image-2',
    apiMode: record.apiMode === 'responses' ? 'responses' : 'images',
    streamImages: Boolean(record.streamImages),
    streamPartialImages: Number.isFinite(Number(record.streamPartialImages)) ? Math.max(0, Math.min(3, Math.trunc(Number(record.streamPartialImages)))) : 0,
    responseFormatB64: record.responseFormatB64 !== false,
  }
}

function publicProfile(profile, includeKeyStatus = true) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiMode: profile.apiMode,
    streamImages: profile.streamImages,
    streamPartialImages: profile.streamPartialImages,
    responseFormatB64: profile.responseFormatB64,
    ...(includeKeyStatus ? { hasApiKey: Boolean(profile.encryptedApiKey) } : {}),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function buildUpstreamUrl(baseUrl, endpointPath) {
  const cleanBase = String(baseUrl || env.defaultApiBaseUrl).trim().replace(/\/+$/, '')
  const cleanEndpoint = endpointPath.replace(/^\/+/, '')
  return `${cleanBase}/${cleanEndpoint}`
}

app.get('/api/health', async () => ({ status: 'ok' }))

app.get('/api/auth/me', async (request) => {
  const user = await getUserFromRequest(request)
  return { user: user ? publicUser(user) : null }
})

app.post('/api/auth/register', async (request, reply) => {
  const email = normalizeEmail(request.body?.email)
  const password = String(request.body?.password || '')
  if (!email || !email.includes('@')) {
    reply.code(400).send({ error: 'INVALID_EMAIL', message: 'Invalid email' })
    return
  }
  if (password.length < 8) {
    reply.code(400).send({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' })
    return
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    reply.code(409).send({ error: 'EMAIL_EXISTS', message: 'Email already exists' })
    return
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
    },
  })
  await createSession(reply, user.id)
  return { user: publicUser(user) }
})

app.post('/api/auth/login', async (request, reply) => {
  const email = normalizeEmail(request.body?.email)
  const password = String(request.body?.password || '')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' })
    return
  }
  await createSession(reply, user.id)
  return { user: publicUser(user) }
})

app.post('/api/auth/logout', async (request, reply) => {
  const token = request.cookies?.[SESSION_COOKIE]
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }
  clearSessionCookie(reply)
  return { ok: true }
})

app.get('/api/profile', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const profile = await prisma.apiProfile.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return { profile: profile ? publicProfile(profile) : null }
})

app.put('/api/profile', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = parseProfileBody(request.body)
  const existing = await prisma.apiProfile.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } })
  const encryptedApiKey = body.apiKey
    ? encryptText(body.apiKey)
    : existing?.encryptedApiKey || ''
  if (!encryptedApiKey) {
    reply.code(400).send({ error: 'API_KEY_REQUIRED', message: 'API key is required' })
    return
  }
  const data = {
    name: body.name,
    provider: body.provider,
    baseUrl: body.baseUrl,
    encryptedApiKey,
    model: body.model,
    apiMode: body.apiMode,
    streamImages: body.streamImages,
    streamPartialImages: body.streamPartialImages,
    responseFormatB64: body.responseFormatB64,
  }
  const profile = existing
    ? await prisma.apiProfile.update({ where: { id: existing.id }, data })
    : await prisma.apiProfile.create({ data: { ...data, userId: user.id } })
  return { profile: publicProfile(profile) }
})

app.all('/api-proxy/*', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return

  const profile = await prisma.apiProfile.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  if (!profile) {
    reply.code(400).send({ error: 'PROFILE_REQUIRED', message: 'Save API settings first' })
    return
  }

  const endpointPath = request.params['*']
  const upstreamUrl = buildUpstreamUrl(profile.baseUrl, endpointPath)
  const startedAt = Date.now()
  const headers = new Headers()
  const incomingHeaders = request.headers
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!value) continue
    const lower = key.toLowerCase()
    if (['host', 'origin', 'referer', 'cookie', 'set-cookie', 'authorization'].includes(lower)) continue
    headers.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  headers.set('Authorization', `Bearer ${decryptText(profile.encryptedApiKey)}`)

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body ?? {})
  if (body && !headers.has('content-type')) headers.set('Content-Type', 'application/json')

  let status = 0
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
    })
    status = upstreamResponse.status
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        endpoint: `/${endpointPath}`,
        model: typeof request.body?.model === 'string' ? request.body.model : profile.model,
        status,
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined)
    reply.code(upstreamResponse.status)
    upstreamResponse.headers.forEach((value, key) => {
      if (['set-cookie', 'content-encoding', 'content-length'].includes(key.toLowerCase())) return
      reply.header(key, value)
    })
    return reply.send(Buffer.from(await upstreamResponse.arrayBuffer()))
  } catch (error) {
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        endpoint: `/${endpointPath}`,
        model: typeof request.body?.model === 'string' ? request.body.model : profile.model,
        status: status || 502,
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined)
    reply.code(502).send({ error: 'UPSTREAM_FAILED', message: error instanceof Error ? error.message : String(error) })
  }
})

app.addHook('onClose', async () => {
  await prisma.$disconnect()
})

app.listen({ port: env.port, host: '0.0.0.0' })
