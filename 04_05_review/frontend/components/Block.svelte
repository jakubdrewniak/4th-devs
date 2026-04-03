<script>
  import { app } from "../lib/state.svelte.js";
  import { rerunBlockReview, saveBlock } from "../lib/api.js";
  import { buildSegments } from "../lib/markdown.js";
  import InlineContent from "./InlineContent.svelte";

  let { block } = $props();

  let editText = $state("");
  let editEl = $state(null);
  let rerunOpen = $state(false);
  let rerunMessage = $state("");
  let rerunEl = $state(null);
  let wasEditing = $state(false);

  const highlights = $derived(app.highlights(block.id));
  const isProcessing = $derived(app.processingBlockIds.has(block.id));
  const isEditing = $derived(app.editingBlockId === block.id);
  const isSelected = $derived(app.selectedBlockId === block.id);
  const canRerun = $derived(Boolean(app.review) && block.reviewable);
  const segments = $derived(buildSegments(block.text, highlights));
  const hasHighlights = $derived(highlights.length > 0);
  const isDirty = $derived(editText !== block.text);

  const startEdit = () => {
    if (!block.reviewable) return;
    cancelRerun();
    app.beginBlockEdit(block.id);
  };

  const cancelEdit = () => { app.editingBlockId = null; };

  const openRerun = () => {
    if (!canRerun || app.busy) return;
    app.selectBlock(block.id, { openFirstComment: true, scroll: false });
    rerunOpen = true;
    requestAnimationFrame(() => rerunEl?.focus());
  };

  const cancelRerun = () => {
    rerunOpen = false;
    rerunMessage = "";
  };

  const save = async () => {
    if (!isDirty) { cancelEdit(); return; }
    await saveBlock(app.selectedDocPath, block.id, editText);
  };

  const submitRerun = async () => {
    await rerunBlockReview(block.id, rerunMessage.trim());
    cancelRerun();
  };

  const editKey = (e) => {
    if (e.key === "Escape") cancelEdit();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  };

  const rerunKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelRerun();
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      submitRerun();
    }
  };

  const isBlockClickDebugEnabled = () => {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search);

    return (
      params.has("debugBlocks")
      || params.get("debug") === "blocks"
      || window.localStorage.getItem("review.debug.blocks") === "1"
    );
  };

  const summarizeNode = (node) => {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      return {
        type: "#text",
        text: node.textContent?.trim().slice(0, 80) ?? "",
      };
    }

    if (!(node instanceof Element)) {
      return { type: String(node.nodeName ?? "unknown").toLowerCase() };
    }

    return {
      type: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: [...node.classList],
      commentId: node.getAttribute("data-comment-id"),
      text: node.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
    };
  };

  const debugBlockClick = (phase, event, extra = {}) => {
    if (!isBlockClickDebugEnabled()) return;

    const path = typeof event.composedPath === "function"
      ? event.composedPath().slice(0, 6).map(summarizeNode)
      : [];

    console.debug(`[block-click:${phase}]`, {
      blockId: block.id,
      blockType: block.type,
      selectedBlockId: app.selectedBlockId,
      selectedCommentId: app.selectedCommentId,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      detail: event.detail,
      target: summarizeNode(event.target),
      currentTarget: summarizeNode(event.currentTarget),
      path,
      ...extra,
    });
  };

  const select = (id) => {
    if (isBlockClickDebugEnabled()) {
      console.debug("[block-click:highlight-select]", {
        blockId: block.id,
        commentId: id,
        selectedBlockId: app.selectedBlockId,
        selectedCommentId: app.selectedCommentId,
      });
    }

    app.selectComment(id, { scroll: false });
  };

  const selectBlockCapture = (event) => {
    debugBlockClick("capture", event, {
      firstCommentId: app.firstCommentForBlock(block.id)?.id ?? null,
    });
  };

  const selectBlock = (event) => {
    const firstCommentId = app.firstCommentForBlock(block.id)?.id ?? null;

    debugBlockClick("bubble-before-select", event, {
      firstCommentId,
      openFirstComment: true,
    });

    app.selectBlock(block.id, { openFirstComment: true, scroll: false });

    debugBlockClick("bubble-after-select", event, {
      firstCommentId,
      selectedBlockIdAfter: app.selectedBlockId,
      selectedCommentIdAfter: app.selectedCommentId,
    });
  };

  const typeClass = () => {
    if (block.type === "heading") return `blk-h${block.meta.level ?? 1}`;
    return "";
  };

  $effect(() => {
    if (isEditing && !wasEditing) {
      editText = block.text;
      requestAnimationFrame(() => editEl?.focus());
    }

    if (!isSelected && rerunOpen) {
      cancelRerun();
    }

    wasEditing = isEditing;
  });
</script>

<div
  id="blk-{block.id}"
  class="blk {typeClass()}"
  class:is-processing={isProcessing}
  class:is-selected={isSelected}
  class:has-rerun-open={rerunOpen}
  onclickcapture={selectBlockCapture}
  onclick={selectBlock}
  ondblclick={block.reviewable ? startEdit : undefined}
>
  {#if canRerun && !isEditing}
    <div class="blk-actions">
      <button class="blk-action" onclick={(e) => { e.stopPropagation(); startEdit(); }} disabled={app.busy} title="Edit block (E)">
        Edit
      </button>
      <button class="blk-action" onclick={(e) => { e.stopPropagation(); rerunOpen ? cancelRerun() : openRerun(); }} disabled={app.busy} title="Re-run block (Shift+R)">
        {rerunOpen ? "Close" : "Re-run"}
      </button>
    </div>
  {/if}

  {#if isEditing}
    <div class="blk-panel blk-panel-inline">
      <textarea
        bind:this={editEl}
        bind:value={editText}
        class="blk-panel-input edit-area"
        rows={Math.max(2, editText.split("\n").length + 1)}
        onkeydown={editKey}
      ></textarea>

      <div class="blk-panel-foot">
        <div class="blk-panel-note">
          {#if isDirty}
            Unsaved changes
          {:else}
            No changes yet
          {/if}
          <span class="blk-panel-note-sep">·</span>
          <span><kbd>Esc</kbd> cancel</span>
          <span class="blk-panel-note-sep">·</span>
          <span><kbd>⌘</kbd><kbd>↵</kbd> save</span>
        </div>

        <div class="blk-panel-actions">
          <button class="btn btn-accept" onclick={save} disabled={!isDirty || app.busy}>Save</button>
          <button class="btn" onclick={cancelEdit}>Cancel</button>
        </div>
      </div>
    </div>
  {:else}
    {#if rerunOpen}
      <div class="blk-panel blk-panel-float">
        <div class="blk-panel-head">
          <div>
            <div class="blk-panel-title">Re-run this block</div>
            <div class="blk-panel-meta">Optional note for the next pass.</div>
          </div>
          <div class="blk-panel-shortcut"><kbd>⌘</kbd><kbd>↵</kbd> Run</div>
        </div>

        <textarea
          bind:this={rerunEl}
          bind:value={rerunMessage}
          class="blk-panel-input blk-rerun-input"
          rows="2"
          placeholder="Optional note for this block review"
          onkeydown={rerunKey}
        ></textarea>

        <div class="blk-panel-actions">
          <button class="btn btn-primary" onclick={submitRerun} disabled={app.busy}>Run again</button>
          <button class="btn" onclick={cancelRerun}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if block.type === "heading" && block.meta.level === 1}
      <h1><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></h1>
    {:else if block.type === "heading" && block.meta.level === 2}
      <h2><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></h2>
    {:else if block.type === "heading"}
      <h3><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></h3>
    {:else if block.type === "list_item"}
      <div class="blk-list">
        <span class="blk-marker">{block.meta.checked === true ? "☑" : block.meta.checked === false ? "☐" : (block.meta.marker ?? "·")}</span>
        <p><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></p>
      </div>
    {:else if block.type === "blockquote"}
      <blockquote class="blk-quote"><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></blockquote>
    {:else if block.type === "code"}
      <pre class="blk-code">{block.text}</pre>
    {:else if block.type === "thematic_break"}
      <hr style="border:none; border-top: 1px solid var(--border); margin: 8px 0;" />
    {:else}
      <p><InlineContent {block} {hasHighlights} {segments} selectedCommentId={app.selectedCommentId} onSelect={select} /></p>
    {/if}
  {/if}
</div>
