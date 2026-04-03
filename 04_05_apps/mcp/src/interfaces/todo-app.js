import { MCP_APPS_APP_MODULE_URL, TAILWIND_BROWSER_URL } from "./shared.js";

export const TODO_RESOURCE_URI = "ui://todos/board.html";

export const renderTodoAppHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo Board</title>
    <script src="${TAILWIND_BROWSER_URL}"></script>
    <style type="text/tailwindcss">
      @theme {
        --font-sans: "Inter", system-ui, -apple-system, sans-serif;
      }
      body {
        background-color: transparent;
        color: #e4e4e4;
      }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 999px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
    </style>
  </head>
  <body class="p-5 font-sans antialiased">
    <main class="flex flex-col gap-4 min-w-[320px] max-w-4xl mx-auto">
      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-base font-semibold tracking-tight text-zinc-100">Todo Board</h1>
            <div class="text-xs text-zinc-400 mt-1" id="summary">Loading...</div>
          </div>
          <div class="flex items-center gap-2">
            <a href="https://linear.app/team/marketing/issues" data-external-service="linear" data-external-url="https://linear.app/team/marketing/issues" class="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-400 hover:underline">Open Linear<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
            <button id="reload-btn" type="button" class="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Reload</button>
            <button id="save-btn" type="button" class="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
          </div>
        </div>
      </section>

      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm flex flex-col gap-5">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-zinc-500 font-medium" id="status">Connecting to host...</div>
          <button id="add-btn" type="button" class="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Add todo</button>
        </div>
        <div class="flex flex-col gap-2.5" id="list"></div>
      </section>
    </main>

    <script type="module">
      import { App } from "${MCP_APPS_APP_MODULE_URL}";

      const app = new App({ name: "Todo Board", version: "0.1.0" });

      const summaryEl = document.getElementById("summary");
      const statusEl = document.getElementById("status");
      const listEl = document.getElementById("list");
      const saveBtn = document.getElementById("save-btn");
      const reloadBtn = document.getElementById("reload-btn");
      const addBtn = document.getElementById("add-btn");

      const state = {
        items: [],
        updatedAt: null,
      };

      let dirty = false;
      let saving = false;
      let contextSyncTimer = null;

      const normalizeText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();

      const toLocalTime = (iso) => {
        if (!iso) return "-";
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString();
      };

      const setStatus = (value) => {
        statusEl.textContent = value;
      };

      const openExternalLink = async (link) => {
        const url = link?.dataset?.externalUrl;
        if (!url) {
          return;
        }

        const service = link.dataset.externalService || "external link";

        try {
          const result = await app.openLink({ url });
          if (result?.isError) {
            setStatus("The host blocked opening " + service + ".");
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Couldn't open " + service + ".");
        }
      };

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const link = target.closest("a[data-external-url]");
        if (!link) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void openExternalLink(link);
      });

      const syncModelContext = async () => {
        const open = state.items.filter((item) => !item.done).length;
        const done = state.items.length - open;

        try {
          await app.updateModelContext({
            content: [
              {
                type: "text",
                text: "Todo board snapshot: " + state.items.length + " total, " + open + " open, " + done + " done.",
              },
            ],
            structuredContent: {
              kind: "todos",
              summary: {
                total: state.items.length,
                open,
                done,
              },
              items: state.items,
              updatedAt: state.updatedAt,
            },
          });
        } catch {
          // Ignore model-context sync failures inside the embedded app.
        }
      };

      const scheduleModelContextSync = () => {
        if (contextSyncTimer) {
          clearTimeout(contextSyncTimer);
        }

        contextSyncTimer = setTimeout(() => {
          void syncModelContext();
        }, 120);
      };

      const resultToState = (result) => result?.structuredContent ?? {};

      const applyState = (value) => {
        const items = Array.isArray(value?.items) ? value.items : [];
        state.items = items
          .map((item, index) => ({
            id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "draft-" + index,
            text: normalizeText(item?.text),
            done: item?.done === true,
          }))
          .filter((item) => item.text);
        state.updatedAt = typeof value?.updatedAt === "string" ? value.updatedAt : null;
        dirty = false;
        render();
        scheduleModelContextSync();
      };

      const renderSummary = () => {
        const open = state.items.filter((item) => !item.done).length;
        const done = state.items.length - open;
        const dirtyLabel = dirty ? " • unsaved" : "";
        summaryEl.textContent =
          state.items.length + " total, " + open + " open, " + done + " done • updated " + toLocalTime(state.updatedAt) + dirtyLabel;
      };

      const renderRows = () => {
        listEl.innerHTML = "";

        if (!state.items.length) {
          const empty = document.createElement("div");
          empty.className = "text-sm text-zinc-500 py-4 text-center";
          empty.textContent = "No todos yet.";
          listEl.appendChild(empty);
          return;
        }

        state.items.forEach((item, index) => {
          const row = document.createElement("div");
          row.className = "group flex items-center gap-3";
          row.dataset.done = String(item.done);

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "w-5 h-5 rounded border-zinc-700 bg-zinc-900/50 checked:bg-blue-500 checked:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-zinc-900 cursor-pointer accent-blue-500";
          checkbox.checked = item.done;
          checkbox.addEventListener("change", () => {
            state.items[index] = { ...state.items[index], done: checkbox.checked };
            dirty = true;
            render();
            scheduleModelContextSync();
          });

          const input = document.createElement("input");
          input.type = "text";
          input.className = "flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-200 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors placeholder:text-zinc-600 " + (item.done ? "line-through opacity-50" : "");
          input.value = item.text;
          input.addEventListener("input", () => {
            state.items[index] = { ...state.items[index], text: normalizeText(input.value) };
            dirty = true;
            renderSummary();
            scheduleModelContextSync();
          });

          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "text-xs font-medium px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-red-400 hover:bg-red-950/30 hover:border-red-900/50 hover:text-red-300 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100";
          removeBtn.textContent = "Delete";
          removeBtn.addEventListener("click", () => {
            state.items = state.items.filter((_, itemIndex) => itemIndex !== index);
            dirty = true;
            render();
            scheduleModelContextSync();
          });

          row.append(checkbox, input, removeBtn);
          listEl.appendChild(row);
        });
      };

      const render = () => {
        renderSummary();
        renderRows();
        saveBtn.disabled = saving;
      };

      const save = async () => {
        if (saving) return;
        saving = true;
        setStatus("Saving...");
        render();

        try {
          const result = await app.callServerTool({
            name: "save_todos_state",
            arguments: {
              items: state.items.map((item) => ({
                id: item.id,
                text: normalizeText(item.text),
                done: item.done,
              })),
            },
          });

          if (result.isError) {
            throw new Error("Host tool save_todos_state failed.");
          }

          applyState(resultToState(result));
          setStatus("Saved.");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        } finally {
          saving = false;
          render();
        }
      };

      const load = async () => {
        setStatus("Loading...");

        const result = await app.callServerTool({
          name: "get_todos_state",
          arguments: {},
        });

        if (result.isError) {
          throw new Error("Host tool get_todos_state failed.");
        }

        applyState(resultToState(result));
        setStatus("Ready.");
      };

      app.ontoolresult = (result) => {
        applyState(resultToState(result));
        setStatus("Synced from latest tool result.");
      };

      app.ontoolinput = (params) => {
        const toolArgs = params?.arguments ?? {};
        const keys = Object.keys(toolArgs);
        setStatus(keys.length > 0 ? "Received tool input." : "Waiting for latest state...");
      };

      app.ontoolcancelled = () => {
        setStatus("The host cancelled the current tool run.");
      };

      app.onteardown = async () => {
        if (contextSyncTimer) {
          clearTimeout(contextSyncTimer);
        }

        if (dirty && !saving) {
          await save();
        }

        return {};
      };

      addBtn.addEventListener("click", () => {
        state.items.push({
          id: crypto.randomUUID(),
          text: "New todo item",
          done: false,
        });
        dirty = true;
        render();
        scheduleModelContextSync();
      });

      saveBtn.addEventListener("click", () => {
        void save();
      });

      reloadBtn.addEventListener("click", () => {
        void load().catch((error) => {
          setStatus(error instanceof Error ? error.message : String(error));
        });
      });

      const boot = async () => {
        try {
          await app.connect();
          setStatus("Connected — waiting for initial tool result.");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      };

      render();
      void boot();
    </script>
  </body>
</html>`;
