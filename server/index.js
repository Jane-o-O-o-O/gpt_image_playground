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
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    imageQuota: user.imageQuota,
    imageUsed: user.imageUsed,
    imageRemaining: Math.max(0, user.imageQuota - user.imageUsed),
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
  if (user.status !== 'active') {
    reply.code(403).send({ error: 'ACCOUNT_DISABLED', message: 'Your account is disabled' })
    return null
  }
  return user
}

async function requireAdmin(request, reply) {
  const user = await requireUser(request, reply)
  if (!user) return null
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'ADMIN_REQUIRED', message: 'Admin access required' })
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

async function getLatestAdminProfile() {
  return prisma.apiProfile.findFirst({
    where: { user: { role: 'admin', status: 'active' } },
    orderBy: { updatedAt: 'desc' },
  })
}

async function getEffectiveProfileForUser(user) {
  const ownProfile = await prisma.apiProfile.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return ownProfile ?? getLatestAdminProfile()
}

function buildUpstreamUrl(baseUrl, endpointPath) {
  const cleanBase = String(baseUrl || env.defaultApiBaseUrl).trim().replace(/\/+$/, '')
  const cleanEndpoint = endpointPath.replace(/^\/+/, '')
  return `${cleanBase}/${cleanEndpoint}`
}

function getRequestedImageCount(request) {
  const n = Number(request.body?.n)
  return Number.isFinite(n) && n > 0 ? Math.min(10, Math.trunc(n)) : 1
}

function isImageGenerationEndpoint(endpointPath) {
  return endpointPath === 'images/generations' || endpointPath === 'images/edits'
}

function getImageMimeFromContentType(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  return mime.startsWith('image/') ? mime : 'image/png'
}

async function imageUrlToBase64(url, authorization) {
  const headers = new Headers()
  if (authorization) headers.set('Authorization', authorization)
  const response = await fetch(url, {
    cache: 'no-store',
    headers,
  })
  if (!response.ok) {
    throw new Error(`Image URL fetch failed: HTTP ${response.status}`)
  }
  const mime = getImageMimeFromContentType(response.headers.get('content-type'))
  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    b64_json: buffer.toString('base64'),
    mime,
  }
}

async function convertImageResponseUrlsToBase64(payload, authorization) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) return payload
  const data = await Promise.all(payload.data.map(async (item) => {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || item.b64_json) return item
    const image = await imageUrlToBase64(item.url, authorization)
    const next = { ...item, b64_json: image.b64_json }
    delete next.url
    return next
  }))
  return { ...payload, data }
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
  const userCount = await prisma.user.count()
  const role = userCount === 0 || (env.adminEmail && email === env.adminEmail) ? 'admin' : 'user'
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role,
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

app.get('/api/account', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const usage = await prisma.usageLog.groupBy({
    by: ['status'],
    where: { userId: user.id },
    _count: { _all: true },
  })
  return {
    user: publicUser(user),
    usage: {
      requests: usage.reduce((sum, item) => sum + item._count._all, 0),
      byStatus: Object.fromEntries(usage.map((item) => [item.status, item._count._all])),
    },
  }
})

app.put('/api/account', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const displayName = typeof request.body?.displayName === 'string'
    ? request.body.displayName.trim().slice(0, 80)
    : null
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { displayName },
  })
  return { user: publicUser(updated) }
})

app.get('/api/admin/users', async (request, reply) => {
  const admin = await requireAdmin(request, reply)
  if (!admin) return
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      imageQuota: true,
      imageUsed: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          usageLogs: true,
          apiProfiles: true,
        },
      },
    },
  })
  return {
    users: users.map((user) => ({
      ...user,
      imageRemaining: Math.max(0, user.imageQuota - user.imageUsed),
    })),
  }
})

app.put('/api/admin/users/:id', async (request, reply) => {
  const admin = await requireAdmin(request, reply)
  if (!admin) return
  const data = {}
  if (typeof request.body?.displayName === 'string') data.displayName = request.body.displayName.trim().slice(0, 80)
  if (request.body?.role === 'admin' || request.body?.role === 'user') data.role = request.body.role
  if (request.body?.status === 'active' || request.body?.status === 'disabled') data.status = request.body.status
  if (Number.isFinite(Number(request.body?.imageQuota))) data.imageQuota = Math.max(0, Math.trunc(Number(request.body.imageQuota)))
  if (Number.isFinite(Number(request.body?.imageUsed))) data.imageUsed = Math.max(0, Math.trunc(Number(request.body.imageUsed)))
  const updated = await prisma.user.update({
    where: { id: request.params.id },
    data,
  })
  return { user: publicUser(updated) }
})

app.get('/api/profile', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const profile = await getEffectiveProfileForUser(user)
  return { profile: profile ? publicProfile(profile) : null }
})

app.put('/api/profile', async (request, reply) => {
  const user = await requireAdmin(request, reply)
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

  const profile = await getEffectiveProfileForUser(user)

  const endpointPath = request.params['*']
  const requestedImages = isImageGenerationEndpoint(endpointPath) ? getRequestedImageCount(request) : 0
  if (requestedImages > 0 && user.imageUsed + requestedImages > user.imageQuota) {
    reply.code(402).send({
      error: 'IMAGE_QUOTA_EXCEEDED',
      message: 'Image quota exceeded',
      imageQuota: user.imageQuota,
      imageUsed: user.imageUsed,
      requestedImages,
    })
    return
  }
  const upstreamUrl = buildUpstreamUrl(profile?.baseUrl, endpointPath)
  const startedAt = Date.now()
  const headers = new Headers()
  const incomingHeaders = request.headers
  const incomingAuthorization = typeof incomingHeaders.authorization === 'string' ? incomingHeaders.authorization : ''
  if (!profile && !incomingAuthorization) {
    reply.code(400).send({ error: 'PROFILE_REQUIRED', message: '请先由管理员保存服务器 API 配置' })
    return
  }
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!value) continue
    const lower = key.toLowerCase()
    if (['host', 'origin', 'referer', 'cookie', 'set-cookie', 'authorization'].includes(lower)) continue
    headers.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  headers.set('Authorization', profile ? `Bearer ${decryptText(profile.encryptedApiKey)}` : incomingAuthorization)

  const requestBody = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? { ...request.body }
    : request.body ?? {}
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(requestBody)
  if (body && !headers.has('content-type')) headers.set('Content-Type', 'application/json')

  let status = 0
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
    })
    status = upstreamResponse.status
    if (upstreamResponse.ok && requestedImages > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { imageUsed: { increment: requestedImages } },
      }).catch(() => undefined)
      await prisma.imageTask.create({
        data: {
          userId: user.id,
          prompt: typeof requestBody?.prompt === 'string' ? requestBody.prompt : '',
          model: typeof requestBody?.model === 'string' ? requestBody.model : profile?.model ?? '',
          size: typeof requestBody?.size === 'string' ? requestBody.size : null,
          status: 'done',
          imageCount: requestedImages,
          completedAt: new Date(),
        },
      }).catch(() => undefined)
    }
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        endpoint: `/${endpointPath}`,
        model: typeof requestBody?.model === 'string' ? requestBody.model : profile?.model ?? '',
        status,
        durationMs: Date.now() - startedAt,
      },
    }).catch(() => undefined)
    const responseContentType = upstreamResponse.headers.get('content-type') || ''
    const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer())
    if (!upstreamResponse.ok) {
      request.log.warn({
        endpoint: endpointPath,
        status: upstreamResponse.status,
        contentType: responseContentType,
        bodyPreview: responseBuffer.toString('utf8', 0, Math.min(responseBuffer.length, 2048)),
      }, 'upstream returned non-ok response')
    }
    reply.code(upstreamResponse.status)
    upstreamResponse.headers.forEach((value, key) => {
      if (['set-cookie', 'content-encoding', 'content-length'].includes(key.toLowerCase())) return
      reply.header(key, value)
    })
    if (upstreamResponse.ok && isImageGenerationEndpoint(endpointPath)) {
      try {
        const payload = JSON.parse(responseBuffer.toString('utf8'))
        const authorization = headers.get('Authorization') || ''
        const convertedPayload = await convertImageResponseUrlsToBase64(payload, authorization).catch((error) => {
          request.log.warn({
            err: error,
            endpoint: endpointPath,
          }, 'failed to convert image URLs to base64; returning upstream payload')
          return payload
        })
        reply.header('content-type', 'application/json; charset=utf-8')
        return reply.send(convertedPayload)
      } catch {
        // Non-JSON image generation responses are forwarded as-is.
      }
    }
    return reply.send(responseBuffer)
  } catch (error) {
    request.log.error({
      err: error,
      endpoint: endpointPath,
      status,
    }, 'api proxy request failed')
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        endpoint: `/${endpointPath}`,
        model: typeof requestBody?.model === 'string' ? requestBody.model : profile?.model ?? '',
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
