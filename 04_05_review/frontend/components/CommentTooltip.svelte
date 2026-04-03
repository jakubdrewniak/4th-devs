<script>
  import { app } from "../lib/state.svelte.js";
  import { acceptComment, rejectComment, resolveComment, convertComment, revertComment } from "../lib/api.js";
  import { fly } from "svelte/transition";

  const KIND_BADGES = {
    comment: { label: "Comment", className: "badge-kind-comment" },
    suggestion: { label: "Suggestion", className: "badge-kind-suggestion" },
  };

  const SEVERITY_BADGES = {
    low: { label: "Low severity", className: "badge-severity-low" },
    medium: { label: "Medium severity", className: "badge-severity-medium" },
    high: { label: "High severity", className: "badge-severity-high" },
  };

  const STATUS_BADGES = {
    open: { label: "Open", className: "badge-status-open" },
    accepted: { label: "Accepted", className: "badge-status-accepted" },
    rejected: { label: "Rejected", className: "badge-status-rejected" },
    stale: { label: "Stale", className: "badge-status-stale" },
    resolved: { label: "Resolved", className: "badge-status-resolved" },
  };

  let pos = $state({ top: 0, left: 0, below: true });
  let visible = $state(false);
  let convertMode = $state(false);
  let convertText = $state("");

  const c = $derived(app.currentComment);
  const badges = $derived(c
    ? [KIND_BADGES[c.kind], SEVERITY_BADGES[c.severity], STATUS_BADGES[c.status]].filter(Boolean)
    : []);
  const isOpenComment = $derived(c?.status === "open" && c?.kind === "comment");
  const isOpenSuggestion = $derived(c?.status === "open" && c?.kind === "suggestion" && c?.suggestion);
  const actionsDisabled = $derived(app.busy || !app.reviewIsComplete);

  const reposition = () => {
    if (app.editingBlockId || app.selectionScrolling || !app.selectedCommentId || !c) { visible = false; return; }

    const mark = document.querySelector(`[data-comment-id="${CSS.escape(app.selectedCommentId)}"]`);
    if (!mark) { visible = false; return; }

    const rect = mark.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom > 300;

    pos = {
      top: below ? rect.bottom + 6 : rect.top - 6,
      left: Math.max(12, Math.min(rect.left + rect.width / 2 - 190, window.innerWidth - 400)),
      below,
    };
    visible = true;
  };

  $effect(() => {
    app.selectedCommentId;
    app.selectionScrolling;
    convertMode = false;
    convertText = "";
    reposition();
  });

  $effect(() => {
    const main = document.querySelector(".main");
    if (!main) return;
    const handler = () => reposition();
    main.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler, { passive: true });
    return () => {
      main.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  });

  const close = () => { app.selectComment(null, { scroll: false }); };

  const startConvert = () => {
    convertText = c?.quote ?? "";
    convertMode = true;
  };

  const submitConvert = () => {
    if (!c || !convertText.trim()) return;
    convertComment(c.id, convertText.trim());
    convertMode = false;
  };

  const cancelConvert = () => { convertMode = false; };
</script>

{#if visible && c}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tooltip"
    style="top: {pos.below ? pos.top : 'auto'}px; bottom: {pos.below ? 'auto' : (window.innerHeight - pos.top)}px; left: {pos.left}px;"
    transition:fly={{ y: pos.below ? -4 : 4, duration: 120 }}
    onclick={(e) => e.stopPropagation()}
  >
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <span class="tooltip-title">{c.title}</span>
      <button class="btn-icon" onclick={close} style="width:20px;height:20px;font-size:11px;">✕</button>
    </div>

    <div class="tooltip-badges">
      {#each badges as badge}
        <span class={`badge ${badge.className}`}>{badge.label}</span>
      {/each}
    </div>

    <p class="tooltip-body">{c.body}</p>

    {#if isOpenSuggestion}
      <div class="tooltip-diff">
        <div class="tooltip-diff-old">− {c.quote}</div>
        <div class="tooltip-diff-new">+ {c.suggestion}</div>
      </div>
      <div class="tooltip-actions">
        <button class="btn btn-accept" onclick={() => acceptComment(c.id)} disabled={actionsDisabled}>Accept <kbd>a</kbd></button>
        <button class="btn btn-reject" onclick={() => rejectComment(c.id)} disabled={actionsDisabled}>Reject <kbd>r</kbd></button>
        <button class="btn" onclick={() => resolveComment(c.id)} disabled={actionsDisabled}>Resolve <kbd>d</kbd></button>
      </div>
    {:else if isOpenComment && !convertMode}
      <pre class="tooltip-quote">{c.quote}</pre>
      <div class="tooltip-actions">
        <button class="btn" onclick={() => resolveComment(c.id)} disabled={actionsDisabled}>Resolve <kbd>d</kbd></button>
        <button class="btn" onclick={startConvert} disabled={actionsDisabled}>Write fix...</button>
        <button class="btn btn-reject" onclick={() => rejectComment(c.id)} disabled={actionsDisabled}>Reject <kbd>r</kbd></button>
      </div>
    {:else if isOpenComment && convertMode}
      <div class="convert-form">
        <label class="convert-label" for="convert-suggestion-input">
          Replace "{c.quote.length > 40 ? c.quote.slice(0, 40) + "…" : c.quote}" with:
        </label>
        <textarea
          id="convert-suggestion-input"
          class="convert-input"
          bind:value={convertText}
          rows={Math.max(2, convertText.split("\n").length)}
          onkeydown={(e) => {
            if (e.key === "Escape") cancelConvert();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              submitConvert();
            }
          }}
        ></textarea>
        <div class="tooltip-actions">
          <button class="btn btn-accept" onclick={submitConvert} disabled={actionsDisabled || !convertText.trim()}>Convert & accept later</button>
          <button class="btn" onclick={cancelConvert}>Cancel</button>
        </div>
      </div>
    {:else if c.status === "accepted" && c.originalBlockText}
      <div class="tooltip-actions">
        <button class="btn btn-reject" onclick={() => revertComment(c.id)} disabled={actionsDisabled}>Revert <kbd>u</kbd></button>
      </div>
    {:else if c.status === "resolved"}
      <pre class="tooltip-quote">{c.quote}</pre>
    {/if}
  </div>
{/if}
