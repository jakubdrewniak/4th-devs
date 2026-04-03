<script>
  import { renderInline } from "../lib/markdown.js";

  let {
    block,
    hasHighlights = false,
    segments = [],
    selectedCommentId = null,
    onSelect = () => {},
  } = $props();

  const activateHighlight = (event, commentId) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(commentId);
  };

  const handleHighlightKeydown = (event, commentId) => {
    if (!["Enter", " ", "Spacebar"].includes(event.key)) return;
    activateHighlight(event, commentId);
  };
</script>

{#if hasHighlights}
  {#each segments as seg}
    {#if seg.type === "hl"}
      <span
        class="hl hl-{seg.comment.kind} hl-{seg.comment.severity}"
        class:is-selected={seg.comment.id === selectedCommentId}
        role="button"
        tabindex="0"
        aria-pressed={seg.comment.id === selectedCommentId}
        onclick={(e) => activateHighlight(e, seg.comment.id)}
        onkeydown={(e) => handleHighlightKeydown(e, seg.comment.id)}
        data-comment-id={seg.comment.id}
      >{@html renderInline(seg.text)}</span>
    {:else}
      <span>{@html renderInline(seg.text)}</span>
    {/if}
  {/each}
{:else if block.html}
  {@html block.html}
{:else}
  {@html renderInline(block.text)}
{/if}
