const messagesEl = document.getElementById("messages");
const composerEl = document.getElementById("composer");
const inputEl = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const suggestionsEl = document.getElementById("suggestions");
const modeBadgeEl = document.getElementById("mode-badge");

let sending = false;
let hostModulePromise = null;
const appContextStore = new Map();

const loadHostModule = async () => {
  hostModulePromise ??= import("./host.js");
  return hostModulePromise;
};

const setSending = (value) => {
  sending = value;
  sendBtn.disabled = value;
  inputEl.disabled = value;
};

const storeAppContext = (update) => {
  const key = typeof update?.resourceUri === "string" && update.resourceUri.trim()
    ? update.resourceUri.trim()
    : typeof update?.source === "string" && update.source.trim()
      ? update.source.trim()
      : null;

  if (!key) {
    return;
  }

  const hasContent = Array.isArray(update?.content) && update.content.length > 0;
  const hasStructuredContent = update?.structuredContent && typeof update.structuredContent === "object";

  if (!hasContent && !hasStructuredContent) {
    appContextStore.delete(key);
    return;
  }

  appContextStore.set(key, {
    source: update.source ?? key,
    content: hasContent ? update.content : [],
    structuredContent: hasStructuredContent ? update.structuredContent : undefined,
  });
};

const serializeAppContexts = () => [...appContextStore.values()];

const appendMessage = async ({ role, text, toolExecutions = [] }) => {
  const article = document.createElement("article");
  article.className = "flex flex-col gap-3 py-2 max-w-4xl w-full mx-auto";
  article.dataset.role = role;

  const header = document.createElement("div");
  header.className = "flex items-center gap-3";

  const roleEl = document.createElement("div");
  roleEl.className = "text-xs font-medium uppercase tracking-wider " + (role === "user" ? "text-blue-400" : "text-emerald-400");
  roleEl.dataset.role = role;
  roleEl.textContent = role;

  header.append(roleEl);
  article.append(header);

  const body = document.createElement("div");
  body.className = "text-[15px] text-zinc-300 whitespace-pre-wrap leading-relaxed";
  body.textContent = text;
  article.append(body);

  messagesEl.append(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (toolExecutions.length > 0) {
    const appsEl = document.createElement("div");
    appsEl.className = "mt-2 flex flex-col gap-4";
    article.append(appsEl);

    void (async () => {
      try {
        const { mountAppExecution } = await loadHostModule();

        for (const execution of toolExecutions) {
          if (!execution.resourceUri) continue;
          await mountAppExecution(appsEl, execution, {
            onAppMessage: async (payload) => {
              if (sending) {
                return { isError: true };
              }

              const text = String(payload?.text ?? "").trim();
              if (!text) {
                return { isError: true };
              }

              await sendMessage(text);
              return { isError: false };
            },
            onModelContextUpdate: (payload) => {
              storeAppContext(payload);
            },
          });
        }
      } catch (error) {
        const pre = document.createElement("pre");
        pre.className = "text-sm text-red-400 whitespace-pre-wrap bg-red-950/20 border border-red-900/30 p-3 rounded-xl mt-2";
        pre.textContent = error instanceof Error ? error.message : String(error);
        appsEl.append(pre);
      }
    })();
  }
};

const appendSystemNote = (text) => {
  const article = document.createElement("article");
  article.className = "flex flex-col gap-3 py-2 max-w-4xl w-full mx-auto";
  article.dataset.role = "assistant";

  const body = document.createElement("div");
  body.className = "text-[15px] text-zinc-500 whitespace-pre-wrap leading-relaxed";
  body.textContent = text;
  article.append(body);

  messagesEl.append(article);
};

const renderSuggestions = (suggestions) => {
  suggestionsEl.innerHTML = "";

  const categoryColors = {
    "Review": "text-amber-400",
    "Cross-domain": "text-emerald-400",
    "Analytics": "text-blue-400",
    "Actions": "text-violet-400",
  };

  const items = Array.isArray(suggestions) ? suggestions : [];

  const isGrouped = items.length > 0 && typeof items[0] === "object" && items[0].category;

  if (isGrouped) {
    items.forEach((group) => {
      const label = document.createElement("div");
      label.className = "text-[10px] uppercase tracking-wider font-medium mt-2 first:mt-0 " + (categoryColors[group.category] || "text-zinc-500");
      label.textContent = group.category;
      suggestionsEl.append(label);

      (group.items || []).forEach((text) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "w-full text-left bg-[#111] hover:bg-zinc-800/80 border border-zinc-800 text-zinc-300 text-[13px] py-2 px-3 rounded-xl transition-colors leading-snug";
        button.textContent = text;
        button.addEventListener("click", () => {
          inputEl.value = text;
          inputEl.focus();
        });
        suggestionsEl.append(button);
      });
    });
  } else {
    items.forEach((text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "w-full text-left bg-[#111] hover:bg-zinc-800/80 border border-zinc-800 text-zinc-300 text-sm py-2.5 px-3.5 rounded-xl transition-colors";
      button.textContent = typeof text === "string" ? text : "";
      button.addEventListener("click", () => {
        inputEl.value = button.textContent;
        inputEl.focus();
      });
      suggestionsEl.append(button);
    });
  }
};

const bootstrap = async () => {
  const response = await fetch("/api/bootstrap");
  const data = await response.json();

  modeBadgeEl.textContent = data.mode === "local-fallback"
    ? "Local fallback mode"
    : `AI mode: ${data.mode}`;

  renderSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
  appendSystemNote(
    data.mode === "local-fallback"
      ? "No API key detected, so the chat is running in local fallback mode. Todo tools and the MCP App still work."
      : `Connected in AI mode (${data.mode}). The current todo workspace has ${data.todosSummary}.`,
  );
};

const sendMessage = async (message) => {
  const trimmed = message.trim();
  if (!trimmed || sending) return;

  setSending(true);
  await appendMessage({ role: "user", text: trimmed });
  inputEl.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: trimmed,
        appContexts: serializeAppContexts(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? `Chat request failed (${response.status}).`);
    }

    await appendMessage({
      role: "assistant",
      text: data.text ?? "Done.",
      toolExecutions: Array.isArray(data.toolExecutions) ? data.toolExecutions : [],
    });
  } catch (error) {
    await appendMessage({
      role: "assistant",
      text: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setSending(false);
    inputEl.focus();
  }
};

composerEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(inputEl.value);
});

inputEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendMessage(inputEl.value);
  }
});

void bootstrap().catch((error) => {
  appendSystemNote(error instanceof Error ? error.message : String(error));
});
