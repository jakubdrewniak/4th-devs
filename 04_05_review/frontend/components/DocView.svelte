<script>
  import { app } from "../lib/state.svelte.js";
  import Block from "./Block.svelte";

  const MODE_LABELS = { paragraph: "Block by block", at_once: "Whole document" };

  const formatMetaLabel = (key) => key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const getFrontmatter = (frontmatter = {}) => {
    const rawTags = frontmatter?.tags;

    return {
      summary: typeof frontmatter?.summary === "string" ? frontmatter.summary.trim() : "",
      tags: Array.isArray(rawTags)
        ? rawTags.map((value) => String(value))
        : rawTags
          ? [String(rawTags)]
          : [],
      fields: Object.entries(frontmatter ?? {})
        .filter(([key, value]) => (
          !["title", "summary", "tags"].includes(key)
          && value != null
          && !(typeof value === "string" && value.trim() === "")
        ))
        .map(([key, value]) => ({
          key,
          label: formatMetaLabel(key),
          values: Array.isArray(value) ? value.map((entry) => String(entry)) : null,
          value: Array.isArray(value)
            ? ""
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value),
        })),
    };
  };

  const getReviewHeading = (review) => (
    review?.mode === "at_once" ? "Overall review" : "Review summary"
  );

  const getReviewContext = (review) => (
    [review?.promptTitle, MODE_LABELS[review?.mode] ?? review?.mode]
      .filter(Boolean)
      .join(" · ")
  );

  const getReviewBody = (review) => {
    if (review?.summary?.trim()) return review.summary.trim();
    if (review?.status === "running") return "Review in progress. Suggestions appear as blocks finish.";
    if (review?.status === "failed") return "Review stopped before completion. Partial suggestions remain visible.";
    return "Review completed.";
  };

  const frontmatter = $derived(getFrontmatter(app.doc?.frontmatter));
</script>

<div class="doc-wrap">
  {#if !app.doc}
    <p class="empty">Select a document to begin.</p>
  {:else}
    {#if frontmatter.summary || frontmatter.tags.length > 0 || frontmatter.fields.length > 0}
      <section class="doc-meta-panel">
        {#if frontmatter.summary}
          <p class="doc-lead">{frontmatter.summary}</p>
        {/if}

        {#if frontmatter.tags.length > 0}
          <div class="meta-tags" aria-label="Document tags">
            {#each frontmatter.tags as tag}
              <span class="meta-tag">{tag}</span>
            {/each}
          </div>
        {/if}

        {#if frontmatter.fields.length > 0}
          <dl class="doc-facts">
            {#each frontmatter.fields as field}
              <div class="doc-fact">
                <dt>{field.label}</dt>
                <dd>
                  {#if field.values}
                    <div class="meta-tags">
                      {#each field.values as value}
                        <span class="meta-tag meta-tag-muted">{value}</span>
                      {/each}
                    </div>
                  {:else}
                    {field.value}
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        {/if}
      </section>
    {/if}

    {#if app.review}
      <div class="summary">
        <div class="summary-head">
          <strong>{getReviewHeading(app.review)}</strong>
          <span class="summary-meta">{getReviewContext(app.review)}</span>
        </div>
        <p>{getReviewBody(app.review)}</p>
      </div>
    {/if}

    <div class="doc-blocks">
      {#each app.doc.blocks as block (block.id)}
        <Block {block} />
      {/each}
    </div>
  {/if}
</div>
