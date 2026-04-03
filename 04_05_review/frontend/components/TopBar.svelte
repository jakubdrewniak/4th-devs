<script>
  import { app } from "../lib/state.svelte.js";
  import { fetchDoc, runReview, download } from "../lib/api.js";
  import RichSelect from "./RichSelect.svelte";

  const modes = { paragraph: "Block by block", at_once: "Whole document" };

  const modeDefinitions = {
    paragraph: {
      title: "Block by block",
      subtitle: "Review one markdown block at a time and stream progress as the pass moves through the document.",
      meta: "Sequential",
    },
    at_once: {
      title: "Whole document",
      subtitle: "Review the document in one pass and return a single overall summary with anchored comments.",
      meta: "Single pass",
    },
  };

  const toList = (value) => Array.isArray(value)
    ? value.map((entry) => String(entry))
    : value
      ? [String(value)]
      : [];

  const buildDocumentItems = (documents) => documents.map((doc) => {
    const tags = toList(doc.frontmatter?.tags).slice(0, 4);
    const tagLine = tags.slice(0, 2).join(" · ");

    return {
      value: doc.path,
      title: doc.title,
      triggerMeta: tagLine || "Document",
      subtitle: doc.summary || "Markdown document",
      meta: tagLine || "Document",
    };
  });

  const buildPromptItems = (prompts) => prompts.map((prompt) => {
    const supportedModes = Array.isArray(prompt.modes) && prompt.modes.length > 0
      ? prompt.modes
      : ["paragraph", "at_once"];

    return {
      value: prompt.path,
      title: prompt.title,
      triggerMeta: supportedModes.map((mode) => modes[mode] ?? mode).join(" · "),
      subtitle: prompt.description || "Review prompt",
      meta: supportedModes.map((mode) => modes[mode] ?? mode).join(" · "),
    };
  });

  const buildModeItems = (prompt) => {
    const supportedModes = new Set(
      Array.isArray(prompt?.modes) && prompt.modes.length > 0
        ? prompt.modes
        : ["paragraph", "at_once"],
    );

    return Object.entries(modeDefinitions).map(([value, definition]) => {
      const supported = supportedModes.has(value);

      return {
        value,
        title: definition.title,
        triggerMeta: supported ? definition.meta : "Unavailable",
        subtitle: definition.subtitle,
        meta: supported ? definition.meta : "Unavailable for this prompt",
        disabled: !supported,
      };
    });
  };

  const documentItems = $derived(buildDocumentItems(app.documents));
  const promptItems = $derived(buildPromptItems(app.prompts));
  const modeItems = $derived(buildModeItems(app.selectedPrompt));

  const selectDoc = async (path) => {
    app.selectedDocPath = path;
    app.selectComment(null, { scroll: false });
    app.editingBlockId = null;
    await fetchDoc(app.selectedDocPath);
  };

  const selectPrompt = async (path) => {
    app.selectedPromptPath = path;
    app.ensureValidMode();
  };

  const selectMode = async (mode) => {
    app.selectedMode = mode;
  };
</script>

<header class="topbar">

  <div class="topbar-right">
    <RichSelect
      label="Document"
      items={documentItems}
      value={app.selectedDocPath}
      onChange={selectDoc}
      width="260px"
      placeholder="Select a document"
    />

    <RichSelect
      label="Review prompt"
      items={promptItems}
      value={app.selectedPromptPath}
      onChange={selectPrompt}
      width="240px"
      placeholder="Select a review prompt"
    />

    <RichSelect
      label="Review mode"
      items={modeItems}
      value={app.selectedMode}
      onChange={selectMode}
      width="220px"
      placeholder="Select a review mode"
    />

    <div class="topbar-actions">
      <button
        class="btn btn-primary"
        onclick={runReview}
        disabled={app.busy || !app.selectedDocPath || !app.selectedPromptPath}
        title="Run review (Cmd/Ctrl+Enter)"
      >
        <span>{app.busy ? "Running..." : "Run review"}</span>
        <kbd>⌘</kbd><kbd>↵</kbd>
      </button>

      <button
        class="btn btn-secondary"
        onclick={download}
        disabled={!app.selectedDocPath}
        title="Export markdown"
      >
        <span>Export .md</span>
        <kbd>⌘</kbd><kbd>⇧</kbd><kbd>E</kbd>
      </button>
    </div>
  </div>

  {#if app.progress.visible}
    <div class="progress-strip">
      <div class="progress-fill" style="width: {app.progress.pct}%"></div>
    </div>
  {/if}
</header>
