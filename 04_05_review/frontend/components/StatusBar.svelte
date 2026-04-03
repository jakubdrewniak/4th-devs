<script>
  import { app } from "../lib/state.svelte.js";
  import { acceptAll, rejectAll } from "../lib/api.js";

  const stats = $derived(app.stats);
  const hasOpen = $derived(app.openComments.length > 0);
  const hasSuggestions = $derived(app.openSuggestions.length > 0);
  const actionsDisabled = $derived(app.busy || !app.reviewIsComplete);
</script>

<footer class="statusbar">
  <div class="statusbar-left">
    <div class="shortcut-hint">
      <kbd>↑</kbd><kbd>↓</kbd> <span>blocks</span>
      <kbd>e</kbd> <span>edit block</span>
      <kbd>⇧</kbd><kbd>r</kbd> <span>re-run block</span>
      <kbd>j</kbd><kbd>k</kbd> <span>navigate</span>
      <kbd>a</kbd> <span>accept</span>
      <kbd>d</kbd> <span>resolve</span>
      <kbd>r</kbd> <span>reject</span>
      <kbd>u</kbd> <span>revert</span>
      <kbd>⌘</kbd><kbd>↵</kbd> <span>run</span>
    </div>
  </div>

  <div class="statusbar-right">
    {#if app.progress.visible}
      <span>{app.progress.label}</span>
    {:else if app.review}
      <div class="statusbar-stats">
        {#each Object.entries(stats) as [key, count]}
          {#if count > 0}
            <span class="stat stat-{key}">{count} {key}</span>
          {/if}
        {/each}
      </div>

      {#if hasOpen}
        <div class="footer-actions">
          <button class="btn btn-sm btn-accept" onclick={acceptAll} disabled={actionsDisabled || !hasSuggestions}>Accept all</button>
          <button class="btn btn-sm btn-reject" onclick={rejectAll} disabled={actionsDisabled}>Reject all</button>
        </div>
      {/if}
    {:else}
      <span>Ready</span>
    {/if}
  </div>
</footer>
