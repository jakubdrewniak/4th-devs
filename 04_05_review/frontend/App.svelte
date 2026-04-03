<script>
  import { app } from "./lib/state.svelte.js";
  import { bootstrap, fetchDoc } from "./lib/api.js";
  import { setupKeys } from "./lib/keys.js";
  import TopBar from "./components/TopBar.svelte";
  import DocView from "./components/DocView.svelte";
  import CommentTooltip from "./components/CommentTooltip.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import Toasts from "./components/Toasts.svelte";

  setupKeys();

  $effect(() => {
    bootstrap().then(() => {
      if (app.selectedDocPath) fetchDoc(app.selectedDocPath);
    });
  });
</script>

<div class="app">
  <TopBar />
  <main class="main">
    <DocView />
  </main>
  <CommentTooltip />
  <StatusBar />
  <Toasts />
</div>
