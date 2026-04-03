<script>
  import { app } from "../lib/state.svelte.js";
  import { fly } from "svelte/transition";
</script>

<div class="toast-layer">
  {#each app.toasts as t (t.id)}
    <div class="toast" class:toast-err={t.error} transition:fly={{ y: 8, duration: 150 }}>
      {t.msg}
    </div>
  {/each}
</div>
