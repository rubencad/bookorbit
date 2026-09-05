<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
import type { KomgaUser } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useKomgaSettings } from './composables/useKomgaSettings'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canManageSettings = computed(() => hasPermission('manage_app_settings'))
const { komgaEnabled, accounts, loading, loadError, komgaUrl, load, setEnabled, createAccount, updateAccount, deleteAccount } = useKomgaSettings()

const showCreateForm = ref(false)
const createUsername = ref('')
const createPassword = ref('')
const createGroupUnknownSeries = ref(true)
const createIncludeNonComicBooks = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const deleteConfirmAccount = ref<KomgaUser | null>(null)
const helpOpen = ref(true)
const isMobile = useMediaQuery('(max-width: 767px)')

const error = computed(() => (loadError.value ? t('settings.reader.komga.loadFailed') : null))
const canSubmitCreate = computed(() => !creating.value && createUsername.value.trim().length >= 3 && createPassword.value.length >= 8)

onMounted(load)

watch(
  isMobile,
  (mobile) => {
    helpOpen.value = !mobile
  },
  { immediate: true },
)

async function handleToggleEnabled() {
  const next = !komgaEnabled.value
  const ok = await setEnabled(next)
  if (ok) {
    toast.success(next ? t('settings.reader.komga.serverEnabled') : t('settings.reader.komga.serverDisabled'))
  } else {
    toast.error(t('settings.reader.komga.updateSettingsFailed'))
  }
}

async function handleCopyUrl() {
  const copied = await copyToClipboard(komgaUrl.value)
  if (copied) {
    toast.success(t('settings.reader.komga.urlCopied'))
  } else {
    toast.error(t('settings.reader.komga.urlCopyFailed'))
  }
}

function handleBeginCreate() {
  showCreateForm.value = true
}

function handleCancelCreate() {
  showCreateForm.value = false
  createError.value = null
}

function handleToggleCreateGroupUnknownSeries() {
  createGroupUnknownSeries.value = !createGroupUnknownSeries.value
}

function handleToggleCreateIncludeNonComicBooks() {
  createIncludeNonComicBooks.value = !createIncludeNonComicBooks.value
}

async function handleCreate() {
  createError.value = null
  creating.value = true
  try {
    const result = await createAccount({
      username: createUsername.value.trim(),
      password: createPassword.value,
      groupUnknownSeries: createGroupUnknownSeries.value,
      includeNonComicBooks: createIncludeNonComicBooks.value,
    })
    if ('error' in result) {
      createError.value = result.error ?? t('settings.reader.komga.createAccountFailed')
      toast.error(createError.value)
      return
    }
    showCreateForm.value = false
    createUsername.value = ''
    createPassword.value = ''
    createGroupUnknownSeries.value = true
    createIncludeNonComicBooks.value = false
    toast.success(t('settings.reader.komga.accountCreated', { username: result.account.username }))
  } finally {
    creating.value = false
  }
}

async function toggleGroupUnknownSeries(account: KomgaUser) {
  await applyOption(account, { groupUnknownSeries: !account.groupUnknownSeries })
}

async function toggleIncludeNonComicBooks(account: KomgaUser) {
  await applyOption(account, { includeNonComicBooks: !account.includeNonComicBooks })
}

async function applyOption(account: KomgaUser, patch: Partial<Pick<KomgaUser, 'groupUnknownSeries' | 'includeNonComicBooks'>>) {
  const ok = await updateAccount(account, patch)
  if (ok) {
    toast.success(t('settings.reader.komga.optionsUpdated', { username: account.username }))
  } else {
    toast.error(t('settings.reader.komga.updateOptionsFailed'))
  }
}

function requestDelete(account: KomgaUser) {
  deleteConfirmAccount.value = account
}

function handleCancelDelete() {
  deleteConfirmAccount.value = null
}

async function handleConfirmDelete() {
  const target = deleteConfirmAccount.value
  if (!target) return
  deleteConfirmAccount.value = null
  const ok = await deleteAccount(target)
  if (ok) {
    toast.success(t('settings.reader.komga.accountDeleted', { username: target.username }))
  } else {
    toast.error(t('settings.reader.komga.deleteAccountFailed'))
  }
}

function handleToggleHelp() {
  helpOpen.value = !helpOpen.value
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    {{ t('common.loading') }}
  </div>
  <div v-else-if="error" class="settings-error-state">{{ error }}</div>
  <template v-else>
    <div v-if="canManageSettings" class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.komga.server') }}</p>
      <div class="settings-card">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.reader.komga.apiServer') }}</p>
            <p class="settings-hint">{{ t('settings.reader.komga.apiServerHint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="komgaEnabled"
            :aria-label="t('settings.reader.komga.apiServer')"
            class="self-start md:self-auto"
            data-testid="komga-enabled-toggle"
            @update:model-value="handleToggleEnabled"
          />
        </div>
      </div>
    </div>

    <div v-if="!komgaEnabled && !canManageSettings" class="settings-card mb-6">
      <p class="px-4 py-3.5 text-sm text-muted-foreground md:px-5">{{ t('settings.reader.komga.disabledByAdmin') }}</p>
    </div>

    <div v-if="komgaEnabled" class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.komga.endpoint') }}</p>
      <div class="settings-card">
        <div class="flex flex-col md:flex-row md:items-center gap-2 px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <input
            :value="komgaUrl"
            readonly
            :aria-label="t('settings.reader.komga.endpoint')"
            class="flex-1 text-sm bg-transparent text-foreground outline-none select-all min-w-0 truncate"
          />
          <Button variant="outline" size="sm" class="w-full md:w-auto shrink-0" @click="handleCopyUrl">
            <Copy :size="12" />
            {{ t('settings.reader.komga.copy') }}
          </Button>
        </div>
        <p class="px-4 pb-3.5 text-xs text-muted-foreground md:px-5">{{ t('settings.reader.komga.endpointHint') }}</p>
      </div>
    </div>

    <div v-if="komgaEnabled" class="mb-6">
      <div class="hidden items-center justify-between mb-2 md:flex">
        <p class="settings-group-label mb-0">{{ t('settings.reader.komga.accounts') }}</p>
        <Button v-if="!showCreateForm" size="sm" @click="handleBeginCreate">
          <Plus :size="12" />
          {{ t('settings.reader.komga.add') }}
        </Button>
      </div>
      <div class="md:hidden flex items-center justify-between mb-2">
        <p class="settings-group-label mb-0">{{ t('settings.reader.komga.accounts') }}</p>
      </div>
      <div v-if="!showCreateForm" class="md:hidden sticky top-0 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2 mb-3">
        <Button size="sm" class="w-full min-h-10" @click="handleBeginCreate">
          <Plus :size="13" />
          {{ t('settings.reader.komga.addAccount') }}
        </Button>
      </div>

      <form v-if="showCreateForm" class="border border-border rounded-lg p-4 md:p-5 bg-card mb-4 space-y-4 shadow-xs" @submit.prevent="handleCreate">
        <div>
          <label for="komga-create-username" class="block text-xs font-medium text-muted-foreground mb-1.5">{{
            t('settings.reader.komga.username')
          }}</label>
          <input
            id="komga-create-username"
            v-model="createUsername"
            type="text"
            autocomplete="off"
            :placeholder="t('settings.reader.komga.usernamePlaceholder')"
            class="input-field w-full"
          />
        </div>
        <div>
          <label for="komga-create-password" class="block text-xs font-medium text-muted-foreground mb-1.5">{{
            t('settings.reader.komga.password')
          }}</label>
          <input
            id="komga-create-password"
            v-model="createPassword"
            v-bind="SECRET_INPUT_ATTRS"
            type="text"
            :placeholder="t('settings.reader.komga.passwordPlaceholder')"
            class="input-field input-secret w-full"
          />
        </div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.reader.komga.groupUnknownSeries') }}</p>
            <p class="settings-hint">{{ t('settings.reader.komga.groupUnknownSeriesHint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="createGroupUnknownSeries"
            :aria-label="t('settings.reader.komga.groupUnknownSeries')"
            @update:model-value="handleToggleCreateGroupUnknownSeries"
          />
        </div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.reader.komga.includeNonComicBooks') }}</p>
            <p class="settings-hint">{{ t('settings.reader.komga.includeNonComicBooksHint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="createIncludeNonComicBooks"
            :aria-label="t('settings.reader.komga.includeNonComicBooks')"
            @update:model-value="handleToggleCreateIncludeNonComicBooks"
          />
        </div>
        <div v-if="createError" class="text-xs text-destructive" role="alert">{{ createError }}</div>
        <div class="flex items-center gap-2 pt-1">
          <Button size="sm" type="submit" class="flex-1 min-h-10 md:flex-none md:min-h-0" :disabled="!canSubmitCreate">
            {{ creating ? t('settings.reader.komga.creating') : t('settings.reader.komga.create') }}
          </Button>
          <Button variant="outline" size="sm" type="button" class="min-h-10 md:min-h-0" @click="handleCancelCreate">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </form>

      <div v-if="accounts.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
        <p class="text-sm text-muted-foreground">{{ t('settings.reader.komga.noAccounts') }}</p>
      </div>
      <div v-else-if="accounts.length > 0" class="settings-card">
        <div v-for="account in accounts" :key="account.id" class="px-4 py-3.5 bg-card space-y-3 md:px-5" data-testid="komga-account">
          <div class="flex items-center justify-between gap-3">
            <p class="settings-label truncate">{{ account.username }}</p>
            <Button
              variant="destructive-ghost"
              size="sm"
              :aria-label="t('settings.reader.komga.deleteAccount', { username: account.username })"
              @click="requestDelete(account)"
            >
              <Trash2 :size="14" />
              <span class="md:hidden">{{ t('common.delete') }}</span>
            </Button>
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm text-foreground">{{ t('settings.reader.komga.groupUnknownSeries') }}</p>
              <p class="settings-hint">{{ t('settings.reader.komga.groupUnknownSeriesHint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="account.groupUnknownSeries"
              :aria-label="t('settings.reader.komga.groupUnknownSeries')"
              data-testid="komga-group-toggle"
              @update:model-value="toggleGroupUnknownSeries(account)"
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm text-foreground">{{ t('settings.reader.komga.includeNonComicBooks') }}</p>
              <p class="settings-hint">{{ t('settings.reader.komga.includeNonComicBooksHint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="account.includeNonComicBooks"
              :aria-label="t('settings.reader.komga.includeNonComicBooks')"
              data-testid="komga-non-comic-toggle"
              @update:model-value="toggleIncludeNonComicBooks(account)"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-if="komgaEnabled" class="border border-border rounded-lg bg-card/50 shadow-xs">
      <button type="button" class="w-full flex items-center justify-between gap-2 p-4 text-left" :aria-expanded="helpOpen" @click="handleToggleHelp">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('settings.reader.komga.notes') }}</p>
        <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground" />
        <ChevronDown v-else :size="14" class="text-muted-foreground" />
      </button>
      <div v-if="helpOpen" class="px-4 pb-4 text-xs text-muted-foreground space-y-2">
        <p>{{ t('settings.reader.komga.notesClients') }}</p>
        <p>{{ t('settings.reader.komga.notesPasswords') }}</p>
        <p>{{ t('settings.reader.komga.notesProgress') }}</p>
      </div>
    </div>

    <div
      v-if="deleteConfirmAccount"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      role="dialog"
      aria-modal="true"
    >
      <button type="button" class="absolute inset-0 bg-black/45" :aria-label="t('common.cancel')" @click="handleCancelDelete" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('settings.reader.komga.deleteConfirmTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.komga.deleteConfirmBody', { username: deleteConfirmAccount.username }) }}
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" @click="handleCancelDelete">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" size="sm" @click="handleConfirmDelete">{{ t('common.delete') }}</Button>
        </div>
      </div>
    </div>
  </template>
</template>
