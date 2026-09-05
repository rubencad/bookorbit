import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { KomgaUser } from '@bookorbit/types'

const { apiMock, permState } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  permState: { permissions: [] as string[] },
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => permState.permissions.includes(name) }),
}))

import { toast } from 'vue-sonner'
import KomgaSettings from '../KomgaSettings.vue'

function response(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response
}

function account(overrides: Partial<KomgaUser> = {}): KomgaUser {
  return {
    id: 1,
    userId: 7,
    username: 'mihon-phone',
    groupUnknownSeries: true,
    includeNonComicBooks: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function requestsTo(path: string) {
  return apiMock.mock.calls.filter(([input]) => String(input) === path)
}

async function mountPage(options: { enabled?: boolean; accounts?: KomgaUser[]; permissions?: string[] } = {}) {
  permState.permissions = options.permissions ?? ['komga_access']
  apiMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/v1/app-settings') return response(true, [{ key: 'komga_api_enabled', value: String(options.enabled ?? true) }])
    if (path === '/api/v1/komga-users' && !init?.method) return response(true, options.accounts ?? [account()])
    return response(false, { message: 'unexpected request' })
  })
  const wrapper = mount(KomgaSettings)
  await flushPromises()
  return wrapper
}

describe('KomgaSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the server address and the accounts of the current user', async () => {
    const wrapper = await mountPage({
      accounts: [account({ username: 'tablet' }), account({ id: 2, username: 'phone', includeNonComicBooks: true })],
    })

    expect(wrapper.get('input[readonly]').element.getAttribute('value')).toBe(`${window.location.origin}/komga`)
    const rows = wrapper.findAll('[data-testid="komga-account"]')
    expect(rows.map((row) => row.text())).toEqual([expect.stringContaining('tablet'), expect.stringContaining('phone')])
    expect(rows[1].get('[data-testid="komga-non-comic-toggle"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[data-testid="komga-enabled-toggle"]').exists()).toBe(false)
  })

  it('offers the server toggle only to users who manage app settings and patches the setting', async () => {
    const wrapper = await mountPage({ permissions: ['komga_access', 'manage_app_settings'], enabled: false })
    apiMock.mockResolvedValue(response(true, { key: 'komga_api_enabled', value: 'true' }))

    expect(wrapper.text()).not.toContain('Server address')
    await wrapper.get('[data-testid="komga-enabled-toggle"]').trigger('click')
    await flushPromises()

    const [, init] = requestsTo('/api/v1/app-settings/komga_api_enabled')[0]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ value: 'true' })
    expect(wrapper.text()).toContain('Server address')
    expect(toast.success).toHaveBeenCalledWith('Komga API enabled')
  })

  it('creates an account with the chosen options and lists it', async () => {
    const wrapper = await mountPage({ accounts: [] })
    expect(wrapper.text()).toContain('No Komga accounts yet')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add'))!
      .trigger('click')
    await wrapper.get('#komga-create-username').setValue('mihon-phone')
    await wrapper.get('#komga-create-password').setValue('MihonPassword123')
    const optionToggles = wrapper.findAll('form [role="switch"]')
    await optionToggles[1].trigger('click')

    apiMock.mockResolvedValueOnce(response(true, account({ includeNonComicBooks: true }), 201))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const [, init] = requestsTo('/api/v1/komga-users').find(([, request]) => request?.method === 'POST')!
    expect(JSON.parse(String(init?.body))).toEqual({
      username: 'mihon-phone',
      password: 'MihonPassword123',
      groupUnknownSeries: true,
      includeNonComicBooks: true,
    })
    expect(wrapper.findAll('[data-testid="komga-account"]')).toHaveLength(1)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Komga account "mihon-phone" created')
  })

  it('surfaces the server message when creation is refused', async () => {
    const wrapper = await mountPage({ accounts: [] })
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add'))!
      .trigger('click')
    await wrapper.get('#komga-create-username').setValue('mihon-phone')
    await wrapper.get('#komga-create-password').setValue('MihonPassword123')

    apiMock.mockResolvedValueOnce(response(false, { message: 'A Komga account with this username already exists' }, 409))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe('A Komga account with this username already exists')
    expect(toast.error).toHaveBeenCalledWith('A Komga account with this username already exists')
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('flips one account option at a time through PATCH', async () => {
    const wrapper = await mountPage()
    apiMock.mockResolvedValueOnce(response(true, account({ groupUnknownSeries: false })))

    await wrapper.get('[data-testid="komga-group-toggle"]').trigger('click')
    await flushPromises()

    const [, init] = requestsTo('/api/v1/komga-users/1')[0]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ groupUnknownSeries: false })
    expect(wrapper.get('[data-testid="komga-group-toggle"]').attributes('aria-checked')).toBe('false')
  })

  it('deletes an account only after confirmation', async () => {
    const wrapper = await mountPage()
    await wrapper.get('button[aria-label="Delete account mihon-phone"]').trigger('click')
    expect(wrapper.text()).toContain('Delete Komga account?')
    expect(requestsTo('/api/v1/komga-users/1')).toHaveLength(0)

    apiMock.mockResolvedValueOnce(response(true, null, 204))
    await wrapper
      .findAll('[role="dialog"] button')
      .find((button) => button.text() === 'Delete')!
      .trigger('click')
    await flushPromises()

    expect(requestsTo('/api/v1/komga-users/1')[0][1]?.method).toBe('DELETE')
    expect(wrapper.findAll('[data-testid="komga-account"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No Komga accounts yet')
  })
})
