import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getCurrentUser, getServerProfile, login, logout, register, saveServerProfile, settingsFromServerProfile, type ServerUser } from '../lib/serverApi'

export default function AuthModal() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authUser, setAuthUser] = useState<ServerUser | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getCurrentUser()
      .then(async ({ user }) => {
        setAuthUser(user)
        if (!user) return
        const { profile } = await getServerProfile()
        if (profile) setSettings(settingsFromServerProfile(useStore.getState().settings, profile))
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
              Signed in as <span className="font-medium">{authUser.email}</span>
            </div>
            <button disabled={busy} onClick={saveProfile} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              Save current API settings to server
            </button>
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
