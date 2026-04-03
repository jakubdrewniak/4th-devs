<script>
  let {
    label = "Select",
    items = [],
    value = null,
    onChange = () => {},
    width = "240px",
    placeholder = "Select an option",
    disabled = false,
    emptyMessage = "No options",
  } = $props();

  let root = $state(null);
  let open = $state(false);

  const selected = $derived(
    items.find((item) => item.value === value)
      ?? items.find((item) => !item.disabled)
      ?? null,
  );

  const close = () => {
    open = false;
  };

  const toggle = () => {
    if (disabled || items.length === 0) return;
    open = !open;
  };

  const selectItem = async (item) => {
    if (!item || item.disabled) return;
    open = false;
    if (item.value === value) return;
    await onChange(item.value);
  };

  $effect(() => {
    if (!open) return;

    const handlePointerDown = (event) => {
      if (root?.contains(event.target)) return;
      close();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  });
</script>

<div class="toolbar-field rich-select" bind:this={root} style={`--picker-width: ${width};`}>
  <span class="toolbar-label">{label}</span>

  <button
    type="button"
    class="picker-trigger"
    aria-expanded={open}
    aria-haspopup="listbox"
    onclick={toggle}
    disabled={disabled || items.length === 0}
  >
    <span class="picker-trigger-title">{selected?.title ?? placeholder}</span>

    <span class="picker-trigger-copy">
      <span class="picker-trigger-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
    </span>
  </button>

  {#if open}
    <div class="picker-menu" role="listbox" aria-label={label}>
      {#if items.length === 0}
        <div class="picker-empty">{emptyMessage}</div>
      {:else}
        {#each items as item (item.value)}
          <button
            type="button"
            class="picker-option"
            class:is-selected={item.value === value}
            disabled={item.disabled}
            role="option"
            aria-selected={item.value === value}
            onclick={() => selectItem(item)}
          >
            <div class="picker-option-head">
              <span class="picker-option-title">{item.title}</span>
              {#if item.meta}
                <span class="picker-option-meta">{item.meta}</span>
              {/if}
            </div>

            {#if item.subtitle}
              <p class="picker-option-subtitle">{item.subtitle}</p>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
