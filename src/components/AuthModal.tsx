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

function emitAuthChanged(user: ServerUser | null) {
  window.dispatchEvent(new CustomEvent('gip:auth-changed', { detail: { user } }))
}

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
        emitAuthChanged(user)
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

  useEffect(() => {
    if (authUser?.role !== 'admin' && (tab === 'api' || tab === 'admin')) setTab('profile')
  }, [authUser?.role, tab])

  if (!authModalOpen) return null

  const tabs = ['profile', ...(authUser?.role === 'admin' ? ['api', 'admin'] : [])] as Array<'profile' | 'api' | 'admin'>
  const tabGridClass = tabs.length === 1 ? 'grid-cols-1' : tabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'

  const submit = async () => {
    setBusy(true)
    try {
      const result = mode === 'login' ? await login(email, password) : await register(email, password)
      setAuthUser(result.user)
      emitAuthChanged(result.user)
      setDisplayName(result.user.displayName || '')
      const { profile } = await getServerProfile()
      if (profile) {
        setSettings(settingsFromServerProfile(useStore.getState().settings, profile))
      }
      setAuthModalOpen(false)
      showToast(mode === 'login' ? '已登录' : '账号已创建', 'success')
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
      showToast('API 配置已保存到服务器', 'success')
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
      showToast('账号信息已更新', 'success')
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
      showToast('用户已更新', 'success')
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
      emitAuthChanged(null)
      setAuthModalOpen(false)
      showToast('已退出登录', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-950">
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{authUser ? '账号中心' : mode === 'login' ? '登录账号' : '创建账号'}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {authUser ? '查看个人信息和可用额度。管理员可管理 API 配置与用户。' : '登录后可使用服务器账号、配额和受控代理能力。'}
              </p>
            </div>
            <button className="rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-200/70 hover:text-gray-800 dark:hover:bg-white/[0.08] dark:hover:text-gray-100" onClick={() => setAuthModalOpen(false)}>关闭</button>
          </div>
        </div>

        {authUser ? (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200">
              <div>当前账号：<span className="font-medium">{authUser.email}</span></div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                角色：{authUser.role === 'admin' ? '管理员' : '用户'} | 图片额度：{authUser.imageUsed}/{authUser.imageQuota} | 剩余：{authUser.imageRemaining}
              </div>
            </div>
            <div className={`grid ${tabGridClass} gap-1 rounded-xl bg-gray-100 p-1 text-sm dark:bg-white/[0.04]`}>
              {tabs.map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`rounded-lg px-3 py-1.5 ${tab === item ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/[0.1] dark:text-white' : 'text-gray-500 dark:text-gray-300'}`}
                >
                  {item === 'profile' ? '个人资料' : item === 'api' ? 'API 配置' : '用户管理'}
                </button>
              ))}
            </div>

            {tab === 'profile' && (
              <div className="space-y-3">
                <label className="block text-sm text-gray-600 dark:text-gray-300">
                  显示名称
                  <input className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </label>
                <button disabled={busy} onClick={saveAccount} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  保存个人资料
                </button>
              </div>
            )}

            {tab === 'api' && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-white/[0.08]">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100">服务器 API 配置</div>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">将当前前端 API 配置保存到服务器，用户请求会通过服务器侧配置转发。</p>
                <button disabled={busy} onClick={saveProfile} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  保存当前 API 配置
                </button>
              </div>
            )}

            {tab === 'admin' && authUser.role === 'admin' && (
              <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
                {adminUsers.map((user, index) => (
                  <div key={user.id} className="rounded-xl border border-gray-200 p-3 text-sm dark:border-white/[0.08]">
                    <div className="mb-2 font-medium text-gray-800 dark:text-gray-100">{user.email}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.displayName || ''} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, displayName: e.target.value } : item))} placeholder="显示名称" />
                      <input className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" type="number" value={user.imageQuota} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, imageQuota: Number(e.target.value) } : item))} />
                      <select className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.role} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, role: e.target.value as 'user' | 'admin' } : item))}>
                        <option value="user">用户</option>
                        <option value="admin">管理员</option>
                      </select>
                      <select className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.03]" value={user.status} onChange={(e) => setAdminUsers((users) => users.map((item, i) => i === index ? { ...item, status: e.target.value as 'active' | 'disabled' } : item))}>
                        <option value="active">启用</option>
                        <option value="disabled">禁用</option>
                      </select>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>已用 {user.imageUsed}/{user.imageQuota} | 请求 {user._count.usageLogs}</span>
                      <button disabled={busy} onClick={() => saveAdminUser(user)} className="rounded-md bg-gray-900 px-2 py-1 text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">保存</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button disabled={busy} onClick={signOut} className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-60 dark:border-white/[0.1] dark:text-gray-200">
              退出登录
            </button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              邮箱
              <input className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" placeholder="请输入邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              密码
              <input className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100" placeholder="请输入密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button disabled={busy} onClick={submit} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60">
              {busy ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
            </button>
            <button className="w-full rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '没有账号？创建一个' : '已有账号？返回登录'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
