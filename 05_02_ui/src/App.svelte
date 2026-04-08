<script lang="ts">
  import { onMount, tick } from 'svelte'
  import VirtualMessageList from './lib/components/VirtualMessageList.svelte'
  import { chatStore } from './lib/stores/chat-store.svelte'
  import { typewriter, type TypewriterSpeed } from './lib/stores/typewriter.svelte'
  import type { StreamMode } from '../shared/chat'

  const typewriterSpeeds: TypewriterSpeed[] = ['off', 'fast', 'normal', 'slow']

  const historyOptions = [120, 480, 1500]
  const starterPrompts = [
    'Show me the top 3 performing products from last month, generate a chart, and explain what might be driving the trend.',
    'Draft a concise follow-up email for the enterprise lead and save it as an artifact.',
    'Create a short launch brief for the analytics workspace and attach a reusable markdown artifact.',
    'Summarize the latest support notes, then propose the next action as a tool-assisted plan.',
  ]

  let prompt = $state(starterPrompts[0])
  let historyCount = $state(480)
  let sidebarOpen = $state(false)
  let isSafari = $state(false)
  /** Explicit pin-to-bottom + scroll-to-end requests for VirtualMessageList */
  let pinToBottomRequest = $state(0)
  let composerEl: HTMLTextAreaElement | null = $state(null)

  onMount(() => {
    isSafari =
      /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(
        navigator.userAgent,
      )

    document.documentElement.dataset.browser = isSafari ? 'safari' : 'other'
    void chatStore.hydrate(historyCount, chatStore.mode)

    return () => {
      delete document.documentElement.dataset.browser
    }
  })

  const handleHistoryChange = (event: Event) => {
    historyCount = Number((event.currentTarget as HTMLSelectElement).value)
  }

  /** Same post-reset UX as Restart: reload thread, pin list to bottom, focus composer. */
  const resetConversationAndPinComposer = async (mode: StreamMode) => {
    await chatStore.reset(historyCount, mode)
    pinToBottomRequest += 1
    await tick()
    composerEl?.focus()
  }

  const handleModeChange = async (event: Event) => {
    const nextMode = (event.currentTarget as HTMLSelectElement).value as StreamMode
    await resetConversationAndPinComposer(nextMode)
  }

  const submitPrompt = async () => {
    const nextPrompt = prompt
    prompt = ''
    pinToBottomRequest += 1
    const submitPromise = chatStore.submit(nextPrompt, chatStore.mode)
    await tick()
    composerEl?.focus()
    await submitPromise
  }

  const restartConversation = async () => {
    await resetConversationAndPinComposer(chatStore.mode)
  }

  const assistantMessages = $derived(
    chatStore.messages.filter(message => message.role === 'assistant'),
  )
  const totalBlocks = $derived(
    assistantMessages.reduce((sum, message) => sum + message.blocks.length, 0),
  )
</script>

<svelte:head>
  <title>Streaming Agent Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="min-h-dvh flex flex-col bg-bg" data-safari={isSafari || undefined}>
  <!-- Header -->
  <header class="app-frosted shrink-0 h-12 flex items-center justify-between px-4 border-b border-border bg-surface-0/70">
    <div class="flex items-center gap-2.5">
      <span class="text-[11px] font-medium text-accent-text bg-accent-soft px-2 py-0.5 rounded">05_02</span>
      <span class="text-[13px] font-medium text-text-primary hidden sm:inline">Agent Chat</span>
    </div>

    <div class="flex items-center gap-3">
      <div class="hidden sm:flex items-center gap-3 text-[11px] text-text-tertiary tabular-nums">
        <span>{chatStore.messages.length} msgs</span>
        <span>{totalBlocks} blocks</span>
        {#if chatStore.isStreaming}
          <span class="flex items-center gap-1.5 text-accent-text">
            <span class="w-1 h-1 rounded-full bg-accent animate-pulse"></span>
            streaming
          </span>
        {/if}
      </div>

      <button
        type="button"
        class="sm:hidden w-7 h-7 rounded-md bg-surface-2 flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors"
        onclick={() => { sidebarOpen = !sidebarOpen }}
        aria-label="Toggle sidebar"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- Main -->
  <div class="flex-1 flex min-h-0">
    <!-- Chat column -->
    <div class="flex-1 flex flex-col min-h-0 min-w-0">
      <!-- Controls -->
      <div class="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-surface-0/30">
        <div class="flex items-center gap-2">
          <select
            value={historyCount}
            onchange={handleHistoryChange}
            disabled={chatStore.isLoading || chatStore.isStreaming || chatStore.mode === 'live'}
            class="h-7 px-2 pr-6 text-[11px] rounded-md bg-surface-2 border border-border text-text-secondary cursor-pointer appearance-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:border-border-strong"
          >
            {#each historyOptions as option (option)}
              <option value={option}>{option} messages</option>
            {/each}
          </select>

          <button
            type="button"
            class="h-7 px-2.5 text-[11px] font-medium rounded-md bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onclick={() => { void restartConversation() }}
            disabled={chatStore.isLoading || chatStore.isStreaming}
          >
            Restart conversation
          </button>

          <div class="w-px h-4 bg-border"></div>

          <select
            value={chatStore.mode}
            onchange={handleModeChange}
            disabled={chatStore.isLoading || chatStore.isStreaming}
            class="h-7 px-2 pr-6 text-[11px] rounded-md bg-surface-2 border border-border text-text-secondary cursor-pointer appearance-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:border-border-strong"
            aria-label="Stream mode"
          >
            <option value="live">Live</option>
            <option value="mock">Mock</option>
          </select>

          <div class="w-px h-4 bg-border"></div>

          <select
            value={typewriter.speed}
            onchange={(e) => { typewriter.speed = (e.currentTarget as HTMLSelectElement).value as TypewriterSpeed }}
            class="h-7 px-2 pr-6 text-[11px] rounded-md bg-surface-2 border border-border text-text-secondary cursor-pointer appearance-none focus:outline-none focus:border-border-strong"
          >
            {#each typewriterSpeeds as speed (speed)}
              <option value={speed}>Typewriter: {speed}</option>
            {/each}
          </select>
        </div>

        {#if chatStore.error}
          <p class="text-[11px] text-danger-text truncate m-0">{chatStore.error}</p>
        {/if}
      </div>

      <!-- Thread -->
      <VirtualMessageList
        messages={chatStore.messages}
        streamPulse={chatStore.streamPulse}
        isLoading={chatStore.isLoading}
        pinToBottomToken={pinToBottomRequest}
      />

      <!-- Composer -->
      <div class="app-frosted shrink-0 border-t border-border bg-surface-0/60">
        <form
          class="max-w-3xl mx-auto px-5 py-4"
          onsubmit={(e: SubmitEvent) => { e.preventDefault(); void submitPrompt() }}
        >
          <div class="flex items-end gap-2">
            <textarea
              bind:this={composerEl}
              bind:value={prompt}
              rows="1"
              placeholder="Describe the next turn…"
              readonly={chatStore.isLoading}
              onkeydown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (prompt.trim() && !chatStore.isLoading && !chatStore.isStreaming) {
                    void submitPrompt();
                  }
                }
              }}
              class="flex-1 min-h-[42px] max-h-48 resize-none px-3 py-2.5 text-[13px] leading-relaxed rounded-lg bg-surface-1 border border-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong transition-colors read-only:opacity-60 read-only:cursor-wait"
              style="field-sizing: content;"
            ></textarea>
            <button
              type="submit"
              disabled={chatStore.isLoading || chatStore.isStreaming || !prompt.trim()}
              class="h-[42px] w-[88px] shrink-0 text-[13px] font-medium rounded-lg bg-accent text-white hover:bg-accent/90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {chatStore.isStreaming ? 'Streaming…' : 'Send'}
            </button>
          </div>
          <div class="flex items-center justify-between mt-1.5">
            <span class="text-[11px] text-text-tertiary">
              {#if chatStore.mode === 'live'}
                Live — clean thread; history cap is fixed server-side.
              {:else}
                Mock — pick a history window and reload to replay locally.
              {/if}
            </span>
            <span class="text-[11px] text-text-tertiary hidden sm:inline">⌘↵ to send</span>
          </div>
        </form>
      </div>
    </div>

    <!-- Sidebar -->
    <aside class="
      {sidebarOpen ? 'flex' : 'hidden'} sm:flex
      flex-col w-64 shrink-0 border-l border-border bg-surface-0/40 overflow-y-auto
    ">
      <div class="p-4 space-y-6">
        <section>
          <h3 class="label mb-2.5">Quick prompts</h3>
          <div class="space-y-1.5">
            {#each starterPrompts as suggestion (suggestion)}
              <button
                type="button"
                class="w-full text-left text-[12px] leading-relaxed text-text-tertiary rounded-md px-2.5 py-2 hover:bg-surface-1 hover:text-text-secondary transition-colors disabled:opacity-40"
                onclick={() => { prompt = suggestion }}
                disabled={chatStore.isStreaming}
              >
                {suggestion}
              </button>
            {/each}
          </div>
        </section>

        <section>
          <h3 class="label mb-2.5">Architecture</h3>
          <div class="space-y-1.5">
            {#each [
              { title: 'Event sourcing', desc: 'Raw SSE events materialize into typed blocks per message.' },
              { title: 'Block rendering', desc: 'Each block type has its own component, icon, and color identity.' },
              { title: 'Long threads', desc: 'content-visibility:auto keeps 1500 messages scrollable.' },
            ] as card (card.title)}
              <div class="rounded-md px-2.5 py-2">
                <p class="text-[12px] font-medium text-text-secondary m-0">{card.title}</p>
                <p class="text-[11px] text-text-tertiary mt-0.5 m-0 leading-relaxed">{card.desc}</p>
              </div>
            {/each}
          </div>
        </section>
      </div>
    </aside>
  </div>
</div>
