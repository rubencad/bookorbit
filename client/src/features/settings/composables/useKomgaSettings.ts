import { computed, ref } from 'vue'
import type { CreateKomgaUserRequest, KomgaApiStatus, KomgaUser, UpdateKomgaUserRequest } from '@bookorbit/types'
import { api } from '@/lib/api'

interface ApiErrorBody {
  message?: string
}

async function readMessage(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody
  return typeof body.message === 'string' ? body.message : null
}

export function useKomgaSettings() {
  const komgaEnabled = ref(false)
  const accounts = ref<KomgaUser[]>([])
  const loading = ref(true)
  const loadError = ref<string | null>(null)
  const komgaUrl = computed(() => `${window.location.origin}/komga`)

  async function load(): Promise<void> {
    loading.value = true
    loadError.value = null
    try {
      const [statusRes, accountsRes] = await Promise.all([api('/api/v1/komga-api/status'), api('/api/v1/komga-users')])
      if (!statusRes.ok || !accountsRes.ok) {
        loadError.value = `status ${statusRes.ok ? accountsRes.status : statusRes.status}`
        return
      }
      const status = (await statusRes.json()) as KomgaApiStatus
      komgaEnabled.value = status.enabled
      accounts.value = (await accountsRes.json()) as KomgaUser[]
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'load_failed'
    } finally {
      loading.value = false
    }
  }

  async function setEnabled(enabled: boolean): Promise<boolean> {
    try {
      const res = await api('/api/v1/app-settings/komga_api_enabled', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(enabled) }),
      })
      if (!res.ok) return false
      komgaEnabled.value = enabled
      return true
    } catch {
      return false
    }
  }

  async function createAccount(input: CreateKomgaUserRequest): Promise<{ account: KomgaUser } | { error: string | null }> {
    try {
      const res = await api('/api/v1/komga-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) return { error: await readMessage(res) }
      const account = (await res.json()) as KomgaUser
      accounts.value = [...accounts.value, account].sort((a, b) => a.username.localeCompare(b.username))
      return { account }
    } catch {
      return { error: null }
    }
  }

  async function updateAccount(account: KomgaUser, patch: UpdateKomgaUserRequest): Promise<boolean> {
    try {
      const res = await api(`/api/v1/komga-users/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return false
      const updated = (await res.json()) as KomgaUser
      accounts.value = accounts.value.map((entry) => (entry.id === updated.id ? updated : entry))
      return true
    } catch {
      return false
    }
  }

  async function deleteAccount(account: KomgaUser): Promise<boolean> {
    try {
      const res = await api(`/api/v1/komga-users/${account.id}`, { method: 'DELETE' })
      if (!res.ok) return false
      accounts.value = accounts.value.filter((entry) => entry.id !== account.id)
      return true
    } catch {
      return false
    }
  }

  return { komgaEnabled, accounts, loading, loadError, komgaUrl, load, setEnabled, createAccount, updateAccount, deleteAccount }
}
