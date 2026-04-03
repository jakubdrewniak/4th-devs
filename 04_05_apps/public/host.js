import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  ListToolsRequestSchema,
} from "/vendor/ext-apps-bridge.bundle.js";

const HOST_INFO = { name: "04_05_apps_host", version: "0.1.0" };
const HOST_CAPABILITIES = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  sandbox: {
    csp: {
      resourceDomains: ["https://unpkg.com"],
    },
  },
  message: {
    text: {},
    resource: {},
    structuredContent: {},
  },
  updateModelContext: {
    text: {},
    resource: {},
    structuredContent: {},
  },
};

const MIN_IFRAME_HEIGHT = 220;
const APP_IFRAME_SANDBOX = "allow-scripts";
const activeViews = new Set();

const postJson = async (url, payload = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed (${response.status}).`);
  }

  return data;
};

const waitForLoad = (iframe) => new Promise((resolve, reject) => {
  iframe.addEventListener("load", () => resolve(), { once: true });
  iframe.addEventListener("error", () => reject(new Error("Failed to load MCP App iframe.")), { once: true });
});

const buildToolInfo = (execution) => ({
  tool: {
    name: execution.toolName,
    title: execution.toolTitle,
    description: execution.toolDescription,
    inputSchema: execution.inputSchema ?? {
      type: "object",
      properties: {},
    },
  },
});

const dedupe = (values) => [...new Set((values ?? []).filter(Boolean))];

const buildDirective = (values, fallback) => {
  const normalized = dedupe(values);
  return normalized.length > 0 ? normalized.join(" ") : fallback;
};

const escapeHtmlAttr = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("\"", "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const buildCspString = (csp = {}) => {
  const resourceDomains = dedupe(csp.resourceDomains);
  const connectDomains = dedupe(csp.connectDomains);
  const frameDomains = dedupe(csp.frameDomains);
  const baseUriDomains = dedupe(csp.baseUriDomains);
  const staticSources = ["'self'", "'unsafe-inline'", ...resourceDomains];

  return [
    "default-src 'none'",
    `script-src ${buildDirective(staticSources, "'self' 'unsafe-inline'")}`,
    `style-src ${buildDirective(staticSources, "'self' 'unsafe-inline'")}`,
    `img-src ${buildDirective(["'self'", "data:", "blob:", ...resourceDomains], "'self' data: blob:")}`,
    `font-src ${buildDirective(["'self'", "data:", ...resourceDomains], "'self' data:")}`,
    `media-src ${buildDirective(["'self'", ...resourceDomains], "'none'")}`,
    `connect-src ${buildDirective(connectDomains, "'none'")}`,
    `frame-src ${buildDirective(frameDomains, "'none'")}`,
    `base-uri ${buildDirective(baseUriDomains, "'self'")}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
};

const injectCspMeta = (html, csp) => {
  if (!csp) {
    return html;
  }

  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(buildCspString(csp))}" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${metaTag}`);
  }

  return `${metaTag}\n${html}`;
};

const extractResourceContent = (readResult, resourceUri) => {
  const content = (readResult?.contents ?? []).find((entry) => (
    entry?.uri === resourceUri && typeof entry?.text === "string"
  )) ?? (readResult?.contents ?? []).find((entry) => typeof entry?.text === "string");

  if (!content?.text) {
    throw new Error("Resource did not contain inline HTML.");
  }

  return {
    html: content.text,
    uiMeta: content?._meta?.ui ?? {},
  };
};

const createCardShell = (parent, execution) => {
  const card = document.createElement("section");
  card.className = "flex flex-col gap-3 bg-[#111]/80 border border-zinc-800 rounded-2xl p-4 shadow-sm";

  const header = document.createElement("div");
  header.className = "flex items-center justify-between gap-3 px-1";

  const textWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "text-sm font-semibold text-zinc-100 tracking-tight";
  title.textContent = execution.toolTitle || execution.toolName;

  const subtitle = document.createElement("div");
  subtitle.className = "text-xs text-zinc-500 mt-0.5";
  subtitle.textContent = execution.resourceUri;

  textWrap.append(title, subtitle);
  header.append(textWrap);
  card.append(header);
  parent.append(card);

  return { card };
};

const appendError = (card, error) => {
  const pre = document.createElement("pre");
  pre.className = "text-sm text-red-400 whitespace-pre-wrap bg-red-950/20 border border-red-900/30 p-3 rounded-xl mt-2";
  pre.textContent = error instanceof Error ? error.message : String(error);
  card.append(pre);
};

const getTheme = () => (
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
);

const getContainerDimensions = (element) => ({
  maxWidth: Math.max(0, Math.ceil(element.getBoundingClientRect().width)),
  maxHeight: Math.max(MIN_IFRAME_HEIGHT, window.innerHeight - 160),
});

const applyIframeSize = (iframe, params = {}) => {
  if (typeof params.height === "number" && Number.isFinite(params.height)) {
    iframe.style.height = `${Math.max(MIN_IFRAME_HEIGHT, Math.ceil(params.height))}px`;
  }
};

const buildHostContext = (execution, container) => ({
  theme: getTheme(),
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  toolInfo: buildToolInfo(execution),
  containerDimensions: getContainerDimensions(container),
  locale: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: navigator.userAgent,
  platform: "web",
  deviceCapabilities: {
    touch: navigator.maxTouchPoints > 0,
    hover: window.matchMedia("(hover: hover)").matches,
  },
});

const contentBlocksToText = (content = []) => content
  .map((block) => {
    if (block?.type === "text" && typeof block?.text === "string") {
      return block.text.trim();
    }

    if (block?.type === "resource_link" && block.resource_link?.uri) {
      return block.resource_link.uri;
    }

    if (block?.type === "resource" && block.resource?.text) {
      return block.resource.text.trim();
    }

    return "";
  })
  .filter(Boolean)
  .join("\n\n")
  .trim();

const resolveExternalUrl = (value) => {
  const url = new URL(String(value), window.location.origin);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Blocked external URL protocol: ${url.protocol}`);
  }

  return url.toString();
};

const addMediaQueryListener = (mediaQueryList, listener) => {
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", listener);
    return () => mediaQueryList.removeEventListener("change", listener);
  }

  mediaQueryList.addListener(listener);
  return () => mediaQueryList.removeListener(listener);
};

const createHostBridge = async ({
  card,
  iframe,
  execution,
  onAppMessage,
  onModelContextUpdate,
}) => {
  const sourceWindow = iframe.contentWindow;

  if (!sourceWindow) {
    throw new Error("Iframe content window is not available.");
  }

  const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES, {
    hostContext: buildHostContext(execution, card),
  });
  const transport = new PostMessageTransport(sourceWindow, sourceWindow);

  let initialized = false;
  let destroyed = false;

  const syncHostContext = () => {
    if (destroyed || !initialized) {
      return;
    }

    bridge.setHostContext(buildHostContext(execution, card));
  };

  bridge.oninitialized = async () => {
    initialized = true;
    await bridge.sendToolInput({
      arguments: execution.toolArgs ?? {},
    });
    await bridge.sendToolResult(execution.toolResult);
    syncHostContext();
  };

  bridge.onsizechange = (params) => {
    applyIframeSize(iframe, params);
    syncHostContext();
  };

  bridge.oncalltool = async (params) => postJson("/api/mcp/tools/call", {
    name: params.name,
    arguments: params.arguments ?? {},
  });

  bridge.setRequestHandler(ListToolsRequestSchema, async () => postJson("/api/mcp/tools/list"));

  bridge.onlistresources = async (params) => postJson("/api/mcp/resources/list", params ?? {});
  bridge.onlistresourcetemplates = async (params) => postJson("/api/mcp/resources/templates/list", params ?? {});
  bridge.onreadresource = async (params) => postJson("/api/mcp/resources/read", { uri: params.uri });
  bridge.onlistprompts = async (params) => postJson("/api/mcp/prompts/list", params ?? {});

  bridge.onopenlink = async ({ url }) => {
    try {
      window.open(resolveExternalUrl(url), "_blank", "noopener,noreferrer");
      return {};
    } catch {
      return { isError: true };
    }
  };

  bridge.onmessage = async (params) => {
    if (!onAppMessage) {
      return {};
    }

    return onAppMessage({
      source: execution.toolTitle || execution.toolName,
      resourceUri: execution.resourceUri,
      role: params.role,
      content: params.content ?? [],
      text: contentBlocksToText(params.content ?? []),
    });
  };

  bridge.onupdatemodelcontext = async (params) => {
    onModelContextUpdate?.({
      source: execution.toolTitle || execution.toolName,
      resourceUri: execution.resourceUri,
      content: params.content ?? [],
      structuredContent: params.structuredContent ?? null,
    });

    return {};
  };

  bridge.onloggingmessage = (params) => {
    const method = params.level === "error"
      ? "error"
      : params.level === "warning"
        ? "warn"
        : "log";
    console[method](`[${params.logger ?? execution.toolName}]`, params.data);
  };

  bridge.onrequestdisplaymode = async () => ({ mode: "inline" });

  await bridge.connect(transport);

  const resizeObserver = new ResizeObserver(() => {
    syncHostContext();
  });
  resizeObserver.observe(card);

  const onWindowResize = () => {
    syncHostContext();
  };
  window.addEventListener("resize", onWindowResize);

  const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const removeThemeListener = addMediaQueryListener(themeMediaQuery, () => {
    syncHostContext();
  });

  return {
    async destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      removeThemeListener();

      try {
        if (initialized) {
          await bridge.teardownResource({});
        }
      } catch {
        // Ignore teardown failures during cleanup.
      }

      try {
        await bridge.close?.();
      } catch {
        // Ignore close failures during cleanup.
      }

      try {
        await transport.close();
      } catch {
        // Ignore transport close failures during cleanup.
      }
    },
  };
};

window.addEventListener("beforeunload", () => {
  for (const view of [...activeViews]) {
    void view.destroy();
  }
});

export const mountAppExecution = async (parent, execution, options = {}) => {
  const { card } = createCardShell(parent, execution);

  try {
    const resource = await postJson("/api/mcp/resources/read", { uri: execution.resourceUri });
    const { html, uiMeta } = extractResourceContent(resource, execution.resourceUri);

    const iframe = document.createElement("iframe");
    iframe.className = "w-full min-h-[220px] bg-[#0a0a0a] rounded-xl border border-zinc-800/80 shadow-inner";
    // Keep the embedded app isolated from the host document.
    iframe.setAttribute("sandbox", APP_IFRAME_SANDBOX);
    iframe.style.height = `${MIN_IFRAME_HEIGHT}px`;

    const allowAttribute = buildAllowAttribute(uiMeta.permissions);
    if (allowAttribute) {
      iframe.setAttribute("allow", allowAttribute);
    }

    card.append(iframe);

    const view = await createHostBridge({
      card,
      iframe,
      execution,
      onAppMessage: options.onAppMessage,
      onModelContextUpdate: options.onModelContextUpdate,
    });
    const managedView = {
      async destroy() {
        activeViews.delete(managedView);
        await view.destroy();
      },
    };
    activeViews.add(managedView);

    iframe.srcdoc = injectCspMeta(html, uiMeta.csp);
    await waitForLoad(iframe);

    return managedView;
  } catch (error) {
    appendError(card, error);
    return null;
  }
};
