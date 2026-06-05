import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'

export interface ServerUser {
  id: string
  email: string
  displayName?: string | null
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  imageQuota: number
  imageUsed: number
  imageRemaining: number
  createdAt: string
}

export interface ServerProfile {
  id: string
  name: string
  provider: string
  baseUrl: string
  model: string
  apiMode: 'images' | 'responses'
  streamImages: boolean
  streamPartialImages: number
  responseFormatB64: boolean
  hasApiKey: boolean
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasJsonBody = options.body !== undefined && !(options.body instanceof FormData)
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    credentials: 'include',
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Request failed: ${response.status}`)
  }
  return payload as T
}

export async function getCurrentUser() {
  return requestJson<{ user: ServerUser | null }>('/api/auth/me')
}

export async function login(email: string, password: string) {
  return requestJson<{ user: ServerUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function register(email: string, password: string) {
  return requestJson<{ user: ServerUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function logout() {
  return requestJson<{ ok: true }>('/api/auth/logout', { method: 'POST' })
}

export async function getServerProfile() {
  return requestJson<{ profile: ServerProfile | null }>('/api/profile')
}

export async function getAccount() {
  return requestJson<{ user: ServerUser; usage: { requests: number; byStatus: Record<string, number> } }>('/api/account')
}

export async function updateAccount(input: { displayName: string }) {
  return requestJson<{ user: ServerUser }>('/api/account', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export interface AdminUser extends ServerUser {
  updatedAt: string
  _count: {
    usageLogs: number
    apiProfiles: number
  }
}

export async function getAdminUsers() {
  return requestJson<{ users: AdminUser[] }>('/api/admin/users')
}

export async function updateAdminUser(id: string, input: Partial<Pick<AdminUser, 'displayName' | 'role' | 'status' | 'imageQuota' | 'imageUsed'>>) {
  return requestJson<{ user: ServerUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function saveServerProfile(settings: AppSettings) {
  const active = normalizeSettings(settings).profiles.find((profile) => profile.id === settings.activeProfileId)
    ?? normalizeSettings(settings).profiles[0]
  return requestJson<{ profile: ServerProfile }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify({
      name: active?.name || 'Default',
      provider: active?.provider || 'openai',
      baseUrl: active?.baseUrl || DEFAULT_SETTINGS.baseUrl,
      apiKey: active?.apiKey || '',
      model: active?.model || DEFAULT_SETTINGS.model,
      apiMode: active?.apiMode || 'images',
      streamImages: false,
      streamPartialImages: 0,
      responseFormatB64: true,
    }),
  })
}

export function settingsFromServerProfile(current: AppSettings, profile: ServerProfile): AppSettings {
  const normalized = normalizeSettings(current)
  const serverProfile = {
    ...normalized.profiles[0],
    id: 'server-profile',
    name: profile.name || 'Server',
    provider: 'openai',
    baseUrl: '',
    apiKey: 'server-managed-key',
    model: profile.model || 'gpt-image-2',
    timeout: 600,
    apiMode: profile.apiMode || 'images',
    codexCli: false,
    apiProxy: true,
    responseFormatB64Json: true,
    streamImages: false,
    streamPartialImages: 0,
  }

  return normalizeSettings({
    ...normalized,
    baseUrl: serverProfile.baseUrl,
    apiKey: serverProfile.apiKey,
    model: serverProfile.model,
    apiMode: serverProfile.apiMode,
    apiProxy: true,
    streamImages: false,
    streamPartialImages: 0,
    profiles: [serverProfile],
    activeProfileId: serverProfile.id,
  })
}
