<script lang="ts">
import { onMount, onDestroy, tick } from 'svelte'
import type {
  AgentId,
  AgentKind,
  AgentSubagentConfigInput,
  AgentVisibility,
  BackendAgentDetail,
  BackendAgentSummary,
  BackendModelAlias,
  BackendModelsCatalog,
  BackendToolProfile,
  CreateAgentApiInput,
  ReasoningEffort,
  UpdateAgentApiInput,
} from '../../../../shared/chat'
import TiptapPromptEditor from '../../prompt-editor/TiptapPromptEditor.svelte'
  import {
    createAgent,
    deleteAgent,
    getAgent,
    getMcpServerTools,
    getSupportedModels,
    listAgents,
    listMcpServers,
    listToolProfiles,
    updateAccountPreferences,
    updateAgent,
  } from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext } from '../../stores/view-store.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'

import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import CheckableChip from '../../ui/CheckableChip.svelte'
import FieldInput from '../../ui/FieldInput.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import SegmentControl from '../../ui/SegmentControl.svelte'

interface Props {
  agentId?: string
  currentAccountId?: string | null
  onClose: () => void
}

interface AgentFormSubagent {
  agentId: AgentId
  alias: string
  description: string | null
  name: string
  slug: string
}

type AgentReasoningSelection = 'default' | ReasoningEffort

interface AgentFormState {
  description: string
  instructionsMd: string
  kind: AgentKind
  modelAlias: string
  modelProvider: 'google' | 'openai'
  name: string
  nativeTools: string[]
  reasoningEffort: AgentReasoningSelection
  revisionId: string | null
  slug: string
  subagents: AgentFormSubagent[]
  toolProfileId: string
  visibility: Exclude<AgentVisibility, 'system'>
}

const TOOL_OPTIONS: ReadonlyArray<{ id: string; label: string; description: string }> = [
  { id: 'delegate_to_agent', label: 'Delegate', description: 'Hand off tasks and resume suspended delegated runs' },
  { id: 'suspend_run', label: 'Suspend', description: 'Pause and wait for missing input' },
  { id: 'web_search', label: 'Web Search', description: 'Search the web for information' },
] as const
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

let { agentId, currentAccountId = null, onClose }: Props = $props()

const viewStore = getViewStoreContext()

let agents = $state<BackendAgentSummary[]>([])
let modelsCatalog = $state<BackendModelsCatalog | null>(null)
let editingAgentId = $state<AgentId | null>(null)
let form = $state<AgentFormState>(createEmptyForm())
let fieldErrors = $state<Record<string, string>>({})
let errorMessage = $state('')
let successMessage = $state('')
let instructionsEditor: TiptapPromptEditor | null = $state(null)
let isLoadingDetail = $state(false)
let isLoadingModels = $state(false)
let isSaving = $state(false)
let isSettingDefault = $state(false)
let isDefaultForAccount = $state(false)
let isConfirmingLeave = $state(false)
let leaveConfirmTimer: ReturnType<typeof setTimeout> | null = null
let deletingAgentId = $state<string | null>(null)
let availableToolProfiles = $state<BackendToolProfile[]>([])
let isLoadingToolProfiles = $state(false)
let formRoot: HTMLElement | undefined = $state()
let loadedFormSnapshot = $state<string>('')
const selectedToolProfile = $derived.by(
  () => availableToolProfiles.find((profile) => profile.id === form.toolProfileId) ?? null,
)
const formFingerprint = $derived(JSON.stringify([form.name, form.description, form.kind, form.modelAlias, form.modelProvider, form.nativeTools, form.reasoningEffort, form.slug, form.subagents, form.toolProfileId, form.visibility, form.instructionsMd]))
const formIsDirty = $derived(loadedFormSnapshot !== '' && formFingerprint !== loadedFormSnapshot)

interface ToolPreviewGroup { serverLabel: string; tools: { title: string }[] }
let toolPreviewGroups = $state<ToolPreviewGroup[]>([])
let isLoadingToolPreview = $state(false)
const toolPreviewSummary = $derived.by(() => {
  const totalTools = toolPreviewGroups.reduce((sum, g) => sum + g.tools.length, 0)
  if (totalTools === 0) return 'No tools assigned'
  return `${totalTools} tool${totalTools === 1 ? '' : 's'} from ${toolPreviewGroups.length} server${toolPreviewGroups.length === 1 ? '' : 's'}`
})

const loadToolPreview = async (profileId: string) => {
  isLoadingToolPreview = true
  try {
    const servers = await listMcpServers()
    const groups: ToolPreviewGroup[] = []
    for (const server of servers) {
      try {
        const result = await getMcpServerTools(server.id, { toolProfileId: profileId })
        const assigned = result.tools.filter(t => t.modelVisible && t.assignment)
        if (assigned.length > 0) {
          groups.push({ serverLabel: result.server.label, tools: assigned.map(t => ({ title: t.title?.trim() || t.remoteName })) })
        }
      } catch { /* skip */ }
    }
    toolPreviewGroups = groups
  } catch {
    toolPreviewGroups = []
  } finally {
    isLoadingToolPreview = false
  }
}

function createEmptyForm(): AgentFormState {
  return {
    description: '',
    instructionsMd: '',
    kind: 'specialist',
    modelAlias: modelsCatalog?.defaultAlias ?? 'default',
    modelProvider: modelsCatalog?.defaultProvider ?? 'openai',
    name: '',
    nativeTools: ['delegate_to_agent'],
    reasoningEffort: 'medium',
    revisionId: null,
    slug: '',
    subagents: [],
    toolProfileId: '',
    visibility: 'account_private',
  }
}

const slugify = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/g, '').replace(/-+$/g, '')

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const getString = (value: unknown): string => (typeof value === 'string' ? value : '')
const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : []
const normalizeNativeTools = (value: string[]): string[] => {
  const normalized: string[] = []

  for (const tool of value) {
    const nextTool =
      tool === 'block_run' || tool === 'complete_run' ? 'suspend_run' : tool

    if (!normalized.includes(nextTool)) {
      normalized.push(nextTool)
    }
  }

  return normalized
}

const availableSubagents = $derived.by(() => agents.filter((a) => a.id !== editingAgentId))

const providerAliases = $derived.by((): BackendModelAlias[] =>
  modelsCatalog ? modelsCatalog.aliases.filter((a) => a.provider === form.modelProvider) : [],
)

const selectedAliasEntry = $derived.by((): BackendModelAlias | null =>
  providerAliases.find((a) => a.alias === form.modelAlias) ?? null,
)

const getReasoningOptionsForAlias = (
  alias: BackendModelAlias | null,
  provider: 'google' | 'openai',
): AgentReasoningSelection[] => {
  if (!alias?.supportsReasoning) {
    return []
  }

  if (provider === 'google') {
    return ['default', ...new Set(alias.reasoningModes)]
  }

  return alias.reasoningModes
}

const pickReasoningSelection = (
  alias: BackendModelAlias | null,
  provider: 'google' | 'openai',
  current?: AgentReasoningSelection,
): AgentReasoningSelection => {
  const options = getReasoningOptionsForAlias(alias, provider)

  if (current && options.includes(current)) {
    return current
  }

  if (provider === 'google') {
    return 'default'
  }

  if (options.includes('medium')) {
    return 'medium'
  }

  return options[0] ?? 'none'
}

const availableReasoningModes = $derived.by((): AgentReasoningSelection[] =>
  getReasoningOptionsForAlias(selectedAliasEntry, form.modelProvider),
)

const reasoningLabel = 'Reasoning Level'

const openaiDescriptions: Record<AgentReasoningSelection, string> = {
  default: 'Use the provider default reasoning behavior',
  none: 'No reasoning. Fastest, cheapest. Only gpt-5.1+',
  minimal: 'Very light reasoning for most queries',
  low: 'Quick reasoning, lower latency',
  medium: 'Balanced reasoning (default for most models)',
  high: 'Deep reasoning, slower first token',
  xhigh: 'Maximum depth. Only codex-max models',
}

const googleDescriptions: Record<AgentReasoningSelection, string> = {
  default: "Use Gemini's default thinking behavior",
  none: 'Disable thinking for the lowest latency and cost',
  minimal: 'Use the provider default thinking behavior',
  low: 'Use the provider default thinking behavior',
  medium: 'Use the provider default thinking behavior',
  high: 'Use the provider default thinking behavior',
  xhigh: 'Use the provider default thinking behavior',
}

const getModeLabel = (mode: AgentReasoningSelection): string => {
  if (mode === 'default') return 'Provider default'
  if (mode === 'none') return 'No reasoning'
  return mode
}

const getModeDescription = (mode: AgentReasoningSelection): string => {
  if (form.modelProvider === 'google') return googleDescriptions[mode] ?? mode
  return openaiDescriptions[mode] ?? mode
}

const populateForm = (detail: BackendAgentDetail) => {
  const modelConfig = toRecord(detail.activeRevision?.modelConfigJson)
  const reasoningConfig = toRecord(modelConfig.reasoning)
  const toolPolicy = toRecord(detail.activeRevision?.toolPolicyJson)
  const modelProvider = getString(modelConfig.provider) === 'google' ? 'google' : 'openai'
  const modelAlias = getString(modelConfig.modelAlias) || modelsCatalog?.defaultAlias || 'default'
  const resolvedAlias =
    modelsCatalog?.aliases.find((alias) => alias.provider === modelProvider && alias.alias === modelAlias) ??
    null
  const persistedReasoning = getString(reasoningConfig.effort) as ReasoningEffort | undefined
  const initialReasoning =
    modelProvider === 'google'
      ? persistedReasoning === 'none'
        ? ('none' as const)
        : ('default' as const)
      : ((persistedReasoning as ReasoningEffort | undefined) ?? 'medium')
  const persistedToolProfileId =
    detail.activeRevision?.toolProfileId?.trim() || ''

  form = {
    description: detail.description ?? '',
    instructionsMd: detail.activeRevision?.instructionsMd ?? '',
    kind: detail.kind,
    modelAlias,
    modelProvider,
    name: detail.name,
    nativeTools: normalizeNativeTools(getStringArray(toolPolicy.native)),
    reasoningEffort: pickReasoningSelection(resolvedAlias, modelProvider, initialReasoning),
    revisionId: detail.activeRevision?.id ?? null,
    slug: detail.slug,
    subagents: detail.subagents.map((s) => ({
      agentId: s.childAgentId,
      alias: s.alias,
      description: s.childDescription,
      name: s.childName,
      slug: s.childSlug,
    })),
    toolProfileId: persistedToolProfileId,
    visibility: detail.visibility === 'tenant_shared' ? 'tenant_shared' : 'account_private',
  }
  isDefaultForAccount = detail.isDefaultForAccount
  if (form.toolProfileId) {
    void loadToolPreview(form.toolProfileId)
  }
}

const selectAlias = (alias: BackendModelAlias) => {
  form.modelAlias = alias.alias
  delete fieldErrors.modelAlias
  form.reasoningEffort = pickReasoningSelection(alias, form.modelProvider, form.reasoningEffort)
}

const buildPayload = (): CreateAgentApiInput | UpdateAgentApiInput | null => {
  const nextErrors: Record<string, string> = {}
  const trimmedDescription = form.description.trim()
  const trimmedName = form.name.trim()
  const trimmedInstructions = instructionsEditor?.getMarkdown()?.trim() ?? form.instructionsMd.trim()
  const trimmedAlias = form.modelAlias.trim()
  const trimmedToolProfileId = form.toolProfileId.trim() || null
  const sanitizedSubagents: AgentSubagentConfigInput[] = []
  const seenAliases = new Set<string>()
  const generatedSlug = slugify(trimmedName)

  if (!trimmedName) nextErrors.name = 'Name is required.'
  if (!generatedSlug || !SLUG_PATTERN.test(generatedSlug)) nextErrors.name = 'Name must start with a letter or number.'
  if (!trimmedInstructions) nextErrors.instructionsMd = 'Instructions are required.'
  if (!trimmedAlias) nextErrors.modelAlias = 'Model alias is required.'
  if (editingAgentId && !form.revisionId) nextErrors.revisionId = 'Revision could not be resolved.'

  for (const subagent of form.subagents) {
    const alias = subagent.alias.trim()
    if (!alias) { nextErrors.subagents = `Alias required for ${subagent.name}.`; break }
    if (alias.length > 120) { nextErrors.subagents = `Alias for ${subagent.name} is too long.`; break }
    const norm = alias.toLowerCase()
    if (seenAliases.has(norm)) { nextErrors.subagents = 'Aliases must be unique.'; break }
    seenAliases.add(norm)
    sanitizedSubagents.push({ alias, mode: 'async_join', slug: subagent.slug })
  }

  fieldErrors = nextErrors
  if (Object.keys(nextErrors).length > 0) return null

  const base: CreateAgentApiInput = {
    description: trimmedDescription,
    instructionsMd: trimmedInstructions,
    kind: form.kind,
    model: {
      modelAlias: trimmedAlias,
      provider: form.modelProvider,
      ...(form.reasoningEffort === 'default'
        ? {}
        : {
            reasoning: {
              effort: form.reasoningEffort,
            },
          }),
    },
    name: trimmedName,
    slug: editingAgentId ? form.slug : generatedSlug,
    subagents: sanitizedSubagents,
    tools: { native: normalizeNativeTools(form.nativeTools), toolProfileId: trimmedToolProfileId },
    visibility: form.visibility,
  }

  if (!editingAgentId) return base
  return { ...base, revisionId: form.revisionId! }
}

const saveAgent = async () => {
  if (isSaving) return
  errorMessage = ''; successMessage = ''
  const payload = buildPayload()
  if (!payload) return

  isSaving = true
  try {
    if (editingAgentId) {
      await updateAgent(editingAgentId, payload as UpdateAgentApiInput)
    } else {
      await createAgent(payload)
    }

    successMessage = `${editingAgentId ? 'Updated' : 'Created'} "${form.name.trim()}".`
    onClose()
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not save this agent.')
  } finally { isSaving = false }
}

let isConfirmingDelete = $state(false)
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null

const removeAgent = async () => {
  if (!editingAgentId || deletingAgentId) return

  if (!isConfirmingDelete) {
    isConfirmingDelete = true
    deleteConfirmTimer = setTimeout(() => { isConfirmingDelete = false }, 3000)
    return
  }

  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
  isConfirmingDelete = false
  deletingAgentId = editingAgentId
  try {
    await deleteAgent(editingAgentId)
    successMessage = `Deleted "${form.name}".`
    onClose()
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not delete.')
  } finally { deletingAgentId = null }
}

const makeDefaultTarget = async () => {
  if (!editingAgentId || isSettingDefault || isDefaultForAccount) {
    return
  }

  isSettingDefault = true
  errorMessage = ''
  successMessage = ''

  try {
    await updateAccountPreferences({
      defaultTarget: {
        agentId: editingAgentId,
        kind: 'agent',
      },
    })
    isDefaultForAccount = true
    successMessage = `"${form.name.trim()}" is now the default chat target.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not update the default chat target.',
    )
  } finally {
    isSettingDefault = false
  }
}

const applyModelDefaults = () => {
  if (!modelsCatalog) return

  const defaultProvider = modelsCatalog.defaultProvider ?? 'openai'
  const defaultAlias = modelsCatalog.defaultAlias ?? 'default'
  const firstProviderAlias = modelsCatalog.aliases.find((a) => a.provider === defaultProvider)

  if (!form.modelAlias || form.modelAlias === 'default') {
    form.modelProvider = defaultProvider
    form.modelAlias = firstProviderAlias?.alias ?? defaultAlias
    form.reasoningEffort = pickReasoningSelection(firstProviderAlias ?? null, defaultProvider)
  }
}

const loadToolProfiles = async () => {
  isLoadingToolProfiles = true

  try {
    availableToolProfiles = await listToolProfiles()
  } catch {
    availableToolProfiles = []
  } finally {
    isLoadingToolProfiles = false
  }
}

const selectToolProfile = (toolProfileId: string) => {
  form.toolProfileId = toolProfileId
  if (toolProfileId) {
    void loadToolPreview(toolProfileId)
  } else {
    toolPreviewGroups = []
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void saveAgent()
  }
}

const duplicateAgent = () => {
  if (!editingAgentId) return
  editingAgentId = null
  form.revisionId = null
  form.name = `${form.name} (copy)`
  form.slug = slugify(form.name)
  isDefaultForAccount = false
  loadedFormSnapshot = ''
  void tick().then(() => { scrollFormViewToTop(formRoot) })
}

onMount(() => {
  window.addEventListener('keydown', handleKeydown)
  void tick().then(() => { scrollFormViewToTop(formRoot) })

  isLoadingDetail = true

  void Promise.all([
    listAgents({ limit: 200 }).then((a) => { agents = a }),
    getSupportedModels().then((c) => { modelsCatalog = c }).catch(() => { modelsCatalog = null }),
    loadToolProfiles(),
  ]).then(async () => {
    if (agentId) {
      try {
        const detail = await getAgent(agentId as AgentId)
        editingAgentId = agentId as AgentId
        populateForm(detail)
      } catch (error) {
        errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not load agent.')
      }
    } else {
      form = createEmptyForm()
      applyModelDefaults()
      isDefaultForAccount = false
    }
  }).finally(() => {
    isLoadingDetail = false
    void tick().then(() => {
      scrollFormViewToTop(formRoot)
      loadedFormSnapshot = formFingerprint
    })
  })

  viewStore.registerDirtyGuard(() => formIsDirty)
})

onDestroy(() => {
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard()
})
</script>

<div class="mx-auto w-full max-w-2xl px-6 py-8" bind:this={formRoot}>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="text-[16px] font-semibold text-text-primary">
          {editingAgentId ? 'Edit Agent' : 'New Agent'}
        </h2>
        {#if editingAgentId && isDefaultForAccount}
          <span class="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">default</span>
        {/if}
      </div>
      <p class="mt-1 text-[13px] text-text-secondary">
        An agent defines how the AI responds — its instructions, model, and tool access.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ActionButton onclick={() => {
        if (formIsDirty && !isConfirmingLeave) {
          isConfirmingLeave = true
          leaveConfirmTimer = setTimeout(() => { isConfirmingLeave = false }, 3000)
          return
        }
        if (leaveConfirmTimer) clearTimeout(leaveConfirmTimer)
        isConfirmingLeave = false
        onClose()
      }}>
        {isConfirmingLeave ? 'Discard changes?' : 'Back to Chat'}
      </ActionButton>
    </div>
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}

  {#if isLoadingDetail}
    <div class="rounded-lg border border-border bg-surface-1/60 px-4 py-5 text-[13px] text-text-secondary">Loading agent…</div>
  {:else}
    <form class="space-y-6" onsubmit={(e) => { e.preventDefault(); void saveAgent() }}>
      <!-- Name -->
      <FieldInput label="Name" value={form.name} placeholder="My Agent" maxlength={200} error={fieldErrors.name}
        oninput={(v) => { form.name = v; form.slug = slugify(v); delete fieldErrors.name }} />

      <label class="block">
        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Description
        </span>
        <textarea
          class="min-h-[84px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
          placeholder="Short summary shown to other agents when they decide whether to delegate work here."
          maxlength={500}
          value={form.description}
          oninput={(e) => {
            form.description = e.currentTarget.value
          }}
        ></textarea>
        <span class="mt-2 block text-[11px] text-text-tertiary">
          Keep this short and concrete. It is used as delegation metadata, not as the main instruction prompt.
        </span>
      </label>

      <!-- Instructions (moved up — most frequently edited) -->
      <div>
        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Instructions</span>
        <div class="sd-agent-instructions">
          {#key editingAgentId ?? '__new__'}
            <TiptapPromptEditor
              bind:this={instructionsEditor}
              value={form.instructionsMd}
              placeholder="Enter instructions for this agent…"
              ariaLabel="Agent instructions"
              onMarkdownChange={(markdown) => { form.instructionsMd = markdown; delete fieldErrors.instructionsMd }}
            />
          {/key}
        </div>
        {#if fieldErrors.instructionsMd}
          <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors.instructionsMd}</span>
        {/if}
      </div>

      <!-- Model Configuration -->
      <SectionCard title="Model Configuration" collapsible defaultOpen>
        <div class="space-y-5">
          <div class="max-w-xs">
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">Provider</span>
            <SegmentControl
              options={[{ value: 'openai', label: 'OpenAI' }, { value: 'google', label: 'Google' }]}
              value={form.modelProvider}
              onchange={(v) => {
                form.modelProvider = v
                const firstAlias = modelsCatalog?.aliases.find((a) => a.provider === v)
                if (firstAlias) selectAlias(firstAlias)
              }}
            />
          </div>
          <div>
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">Model</span>
            {#if !modelsCatalog}
              <p class="text-[12px] text-text-tertiary">Loading models…</p>
            {:else if providerAliases.length === 0}
              <p class="text-[12px] text-text-tertiary">No models available for this provider.</p>
            {:else}
              <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));">
                {#each providerAliases as alias}
                  {@const isActive = form.modelAlias === alias.alias}
                  <button
                    type="button"
                    class="rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors {isActive ? 'border-accent/40 bg-accent/10 text-text-primary' : 'border-border bg-surface-0 text-text-secondary hover:border-border-strong hover:text-text-primary'}"
                    onclick={() => selectAlias(alias)}
                  >
                    <span class="block truncate font-medium">{alias.alias}</span>
                    <span class="mt-0.5 block truncate text-[11px] {isActive ? 'text-accent-text' : 'text-text-tertiary'}">{alias.model}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if fieldErrors.modelAlias}
              <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors.modelAlias}</span>
            {/if}
          </div>
          <div>
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">{reasoningLabel}</span>
            {#if !selectedAliasEntry}
              <p class="text-[12px] text-text-tertiary">Select a model first.</p>
            {:else if !selectedAliasEntry.supportsReasoning}
              <p class="text-[12px] text-text-tertiary">
                {selectedAliasEntry.model} does not support reasoning.
              </p>
            {:else if availableReasoningModes.length === 0}
              <p class="text-[12px] text-text-tertiary">
                No reasoning modes reported for {selectedAliasEntry.model}.
              </p>
            {:else}
              <div class="space-y-1">
                {#each availableReasoningModes as mode}
                  {@const isActive = form.reasoningEffort === mode}
                  {@const desc = getModeDescription(mode)}
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isActive ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                    onclick={() => { form.reasoningEffort = mode }}
                  >
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {isActive ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                      {#if isActive}
                        <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                      {/if}
                    </span>
                    <span class="min-w-18 shrink-0 font-medium {isActive ? 'text-text-primary' : 'text-text-secondary'}">{getModeLabel(mode)}</span>
                    <span class="flex-1 truncate text-[12px] {isActive ? 'text-accent-text' : 'text-text-tertiary'}">{desc}</span>
                  </button>
                {/each}
              </div>
              <p class="mt-2 text-[11px] text-text-tertiary">
                {form.modelProvider === 'google'
                  ? 'Current Gemini models expose provider default thinking or disabled thinking only'
                  : 'OpenAI reasoning effort'} · {selectedAliasEntry?.model ?? ''}
              </p>
            {/if}
          </div>
        </div>
      </SectionCard>

      <!-- Capabilities + Tool Access -->
      <SectionCard title="Capabilities & Tool Access" collapsible defaultOpen>
        <p class="mb-5 text-[12px] text-text-tertiary">
          Built-in capabilities the agent can use without an MCP server. MCP tool access comes from a shared or dedicated tool profile.
        </p>
        <div class="mb-5">
          <span class="mb-2 block text-[12px] font-medium text-text-secondary">Native Capabilities</span>
          <div class="space-y-1">
            {#each TOOL_OPTIONS as tool}
              {@const enabled = form.nativeTools.includes(tool.id)}
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {enabled ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0'}"
                onclick={() => {
                  form.nativeTools = enabled
                    ? form.nativeTools.filter((t) => t !== tool.id)
                    : [...form.nativeTools, tool.id]
                }}
              >
                <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {enabled ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent'}">
                  <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[12px] font-medium {enabled ? 'text-text-primary' : 'text-text-tertiary'}">{tool.label}</span>
                  <span class="block text-[11px] {enabled ? 'text-text-secondary' : 'text-text-tertiary'}">{tool.description}</span>
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-text-secondary">Tool Access Profile</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
                onclick={() => {
                  void loadToolProfiles()
                }}
              >
                Refresh
              </button>
              <button
                type="button"
                class="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
                onclick={() => {
                  const agentOrigin = { kind: 'agent-form' as const, agentId: editingAgentId ?? undefined }
                  if (form.toolProfileId) {
                    viewStore.openToolProfileForm(form.toolProfileId, agentOrigin)
                    return
                  }

                  viewStore.openToolProfileForm(undefined, agentOrigin)
                }}
              >
                {form.toolProfileId ? 'Edit profile' : 'Create Tool Profile'}
              </button>
            </div>
          </div>

          <div class="mb-3 rounded-md border border-border bg-surface-0 px-3 py-2">
            <p class="text-[11px] text-text-tertiary">
              {#if selectedToolProfile}
                This agent will use the MCP tools granted to
                <span class="font-mono text-text-secondary">{selectedToolProfile.name}</span>
                ({selectedToolProfile.scope === 'tenant_shared' ? 'shared' : 'private'} profile).
              {:else}
                No tool profile selected. This agent will only use native capabilities.
              {/if}
            </p>
          </div>

          {#if isLoadingToolProfiles}
            <p class="py-3 text-center text-[12px] text-text-tertiary">Loading tool profiles…</p>
          {:else if availableToolProfiles.length === 0}
            <p class="rounded-md border border-dashed border-border py-3 text-center text-[12px] text-text-tertiary">
              No tool profiles available yet. Create one to grant MCP tool access.
            </p>
          {:else}
            <div class="space-y-2">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {!form.toolProfileId ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                onclick={() => {
                  selectToolProfile('')
                }}
              >
                <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {!form.toolProfileId ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                  {#if !form.toolProfileId}
                    <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium text-text-primary">No MCP tools</span>
                  <span class="block text-[11px] text-text-tertiary">
                    Use only this agent’s native capabilities.
                  </span>
                </span>
              </button>

              {#each availableToolProfiles as profile}
                {@const isSelected = form.toolProfileId === profile.id}
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isSelected ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                  onclick={() => {
                    selectToolProfile(profile.id)
                  }}
                >
                  <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {isSelected ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                    {#if isSelected}
                      <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium text-text-primary">{profile.name}</span>
                    <span class="block text-[11px] text-text-tertiary">
                      {profile.scope === 'tenant_shared' ? 'Shared' : 'Private'}
                      {profile.status === 'archived' ? ' · archived' : ''}
                      {#if isSelected && !isLoadingToolPreview && toolPreviewGroups.length > 0}
                        · {toolPreviewSummary}
                      {/if}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </SectionCard>

      <!-- Category + Visibility -->
      <SectionCard title="Category & Visibility" collapsible defaultOpen={false} description="Organizational metadata. Does not affect runtime behavior.">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <SegmentControl
              options={[{ value: 'primary', label: 'Primary' }, { value: 'specialist', label: 'Specialist' }, { value: 'derived', label: 'Derived' }]}
              value={form.kind}
              onchange={(v) => { form.kind = v }}
            />
          </div>
          <div>
            <SegmentControl
              options={[{ value: 'account_private', label: 'Private' }, { value: 'tenant_shared', label: 'Shared' }]}
              value={form.visibility}
              onchange={(v) => { form.visibility = v }}
            />
          </div>
        </div>
      </SectionCard>

      <!-- Subagents -->
      <SectionCard title="Allowed Subagents" description="Other agents this one can hand off work to during a run." collapsible defaultOpen={form.subagents.length > 0}>
        {#if availableSubagents.length === 0}
          <p class="text-[12px] text-text-tertiary">No other agents exist yet. Create one to enable delegation.</p>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each availableSubagents as agent}
              {@const active = form.subagents.some((e) => e.agentId === agent.id)}
              <CheckableChip
                checked={active}
                label={agent.name}
                hint={agent.slug}
                onchange={() => {
                  if (active) {
                    form.subagents = form.subagents.filter((e) => e.agentId !== agent.id)
                  } else {
                    form.subagents = [...form.subagents, {
                      agentId: agent.id,
                      alias: agent.slug,
                      description: agent.description,
                      name: agent.name,
                      slug: agent.slug,
                    }]
                  }
                }}
              />
            {/each}
          </div>
        {/if}

        {#if form.subagents.length > 0}
          <div class="mt-3 space-y-2">
            {#each form.subagents as subagent}
              <div class="rounded-md border border-border bg-surface-0 px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="shrink-0 text-[12px] text-text-tertiary">{subagent.name} as</span>
                  <input
                    type="text"
                    class="min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 font-mono text-[12px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                    placeholder={subagent.slug}
                    value={subagent.alias}
                    maxlength={120}
                    oninput={(e) => { form.subagents = form.subagents.map((s) => s.agentId === subagent.agentId ? { ...s, alias: e.currentTarget.value } : s) }}
                  />
                  <button
                    type="button"
                    class="shrink-0 text-[11px] text-text-tertiary transition-colors hover:text-danger-text"
                    onclick={() => { form.subagents = form.subagents.filter((s) => s.agentId !== subagent.agentId) }}
                  >✕</button>
                </div>
                {#if subagent.description}
                  <p class="mt-2 text-[11px] text-text-tertiary">{subagent.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if fieldErrors.subagents}
          <span class="mt-3 block text-[11px] text-danger-text">{fieldErrors.subagents}</span>
        {/if}
      </SectionCard>

      <!-- Actions -->
      <div class="flex items-center justify-between border-t border-border pt-4">
        <div class="flex items-center gap-2">
          {#if editingAgentId}
            {#if !isDefaultForAccount}
              <ActionButton
                disabled={isSettingDefault}
                onclick={() => { void makeDefaultTarget() }}
              >
                {isSettingDefault ? 'Setting…' : 'Set as Default'}
              </ActionButton>
            {/if}
            <ActionButton onclick={duplicateAgent}>Duplicate</ActionButton>
            <ActionButton
              variant="danger"
              disabled={deletingAgentId === editingAgentId}
              onclick={() => { void removeAgent() }}
            >
              {#if deletingAgentId === editingAgentId}
                Deleting…
              {:else if isConfirmingDelete}
                Confirm delete?
              {:else}
                Delete
              {/if}
            </ActionButton>
          {/if}
        </div>
        <ActionButton variant="primary" type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : editingAgentId ? 'Save Changes' : 'Create Agent'}
        </ActionButton>
      </div>
    </form>
  {/if}
</div>

<style>
  .sd-agent-instructions :global(.sd-prompt-shell) { min-height: 180px; }
  .sd-agent-instructions :global(.sd-prompt-editor .ProseMirror) { min-height: 160px; max-height: 50vh; font-family: var(--font-mono); }
</style>
