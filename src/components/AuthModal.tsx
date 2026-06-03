import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  getAccount,
  getAdminUsers,
  getCurrentUser,
  getServerProfile,
  login,
  logout,
  register,
  saveServerProfile,
  settingsFromServerProfile,
  updateAccount,
  updateAdminUser,
  type AdminUser,
  type ServerUser,
} from '../lib/serverApi'

export default function AuthModal() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authUser, setAuthUser] = useState<ServerUser | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tab, setTab] = useState<'profile' | 'api' | 'admin'>('profile')
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getCurrentUser()
      .then(async ({ user }) => {
        setAuthUser(user)
        setDisplayName(user?.displayName || '')
        if (!user) return
        const { profile } = await getServerProfile()
        if (profile) setSettings(settingsFromServerProfile(useStore.getState().settings, profile))
        if (user.role === 'admin') {
          const result = await getAdminUsers().catch(() => ({ users: [] }))
          setAdminUsers(result.users)
        }
      })
      .catch(() => undefined)
  }, [setAuthUser, setSettings])

  useEffect(() => {
    const open = () => setAuthModalOpen(true)
    window.addEventListener('gip:open-auth', open)
    return () => window.removeEventListener('gip:open-auth', open)
  }, [])

  if (!authModalOpen) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = mode === 'login' ? await login(email, password) : await register(email, password)
      setAuthUser(result.user)
      setDisplayName(result.user.displayName || '')
      const { profile } = await getServerProfile()
      if (profile) {
        setSettings(settingsFromServerProfile(useStore.getState().settings, profile))
      }
      setAuthModalOpen(false)
      showToast(mode === 'login' ? 'Signed in' : 'Account created', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async () => {
    setBusy(true)
    try {
      const { profile } = await saveServerProfile(settings)
      setSettings(settingsFromServerProfile(useStore.getState().settings, profile))
      showToast('API settings saved to server', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveAccount = async () => {
    setBusy(true)
    try {
      const { user } = await updateAccount({ displayName })
      setAuthUser(user)
      showToast('Account updated', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const refreshAccount = async () => {
    try {
      const { user } = await getAccount()
      setAuthUser(user)
      setDisplayName(user.displayName || '')
      if (user.role === 'admin') {
        const result = await getAdminUsers()
        setAdminUsers(result.users)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const saveAdminUser = async (user: AdminUser) => {
    setBusy(true)
    try {
      await updateAdminUser(user.id, {
        displayName: user.displayName || '',
        role: user.role,
        status: user.status,
        imageQuota: user.imageQuota,
        imageUsed: user.imageUsed,
      })
      await refreshAccount()
      showToast('User updated', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    try {
      await logout()
      setAuthUser(null)
      setAuthModalOpen(false)
      showToast('Signed out', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-white/[0.08] dark:bg-gray-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{authUser ? 'Account' : mode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <button className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]" onClick={() => setAuthModalOpen(false)}>Close</button>
        </div>

        {authUser ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">
              <div>Signed in as <span className="font-medium">{authUser.email}</span></div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Role: {authUser.role} | Images: {authUser.imageUsed}/{authUser.imageQuota} | Remaining: {authUser.imageRemaining}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 text-sm dark:bg-white/[0.04]">
              {(['profile', 'api', ...(authUser.role === 'admin' ? ['admin'] : [])] as Array<'profile' | 'api' | 'admin'>).map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`rounded-lg px-3 py-1.5 ${tab === item ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/[0.1] dark:text-white' : 'text-gray-500 dark:text-gray-300'}`}
                >
                  {item === 'profile' ? 'Profile' : item === 'api' ? 'API' : 'Admin'}
                </button>
              ))}
            </div>

            {tab === 'profile' && (
              <div className="space-y-3">
                <label className="block text-sm text-gray-600 dark:text-gray-300">
                  Display name
                  <input className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </label>
                <button disabled={busy} onClick={saveAccount} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  Save profile
                </button>
              </div>
            )}

            {tab === 'api' && (
              <button disabled={busy} onClick={saveProfile} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                Save current API settings to server
              </button>
            )}

            {tab === 'admin' && authUser.role === 'admin' && (
              <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
                {adminUsers.map((user, index) => (
                  <div key={user.id} className="rounded-xl border border-gray-200 p-3 text-sm dark:border-white/[0.08]">
                    <div className="mb-2 font-medium text-gray-800 dark:text-gray-100">{user.email}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.displayName || ''} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, displayName: e.target.value } : item))} placeholder="Display name" />
                      <input className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" type="number" value={user.imageQuota} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, imageQuota: Number(e.target.value) } : item))} />
                      <select className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.role} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, role: e.target.value as 'user' | 'admin' } : item))}>
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      <select className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.status} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, status: e.target.value as 'active' | 'disabled' } : item))}>
                        <option value="active">active</option>
                        <option value="disabled">disabled</option>
                      </select>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>Used {user.imageUsed}/{user.imageQuota} | Requests {user._count.usageLogs}</span>
                      <button disabled={busy} onClick={() => saveAdminUser(user)} className="rounded-md bg-gray-900 px-2 py-1 text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">Save</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button disabled={busy} onClick={signOut} className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-60 dark:border-white/[0.1] dark:text-gray-200">
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy} onClick={submit} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
            <button className="w-full rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
