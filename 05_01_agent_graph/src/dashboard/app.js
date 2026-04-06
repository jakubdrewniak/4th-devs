const $ = (id) => document.getElementById(id);
const feed = $("feed");
const trunc = (s, n = 100) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const time = (t) => new Date(t).toLocaleTimeString("en-US", { hour12: false });

const ACTOR_COLORS = { orchestrator: "var(--cyan)", researcher: "var(--mag)", writer: "var(--green)", reviewer: "var(--yellow)" };
const actorTag = (name) => name ? '<span class="actor-tag" style="color:' + (ACTOR_COLORS[name] || "var(--dim)") + '">[' + esc(name) + "]</span> " : "";

// ── State ───────────────────────────────────────────────────────────────────

const agentState = {};
let currentGroup = null;
let lastState = null;

function ensureAgent(name) {
  if (!agentState[name]) {
    agentState[name] = { status: "idle", step: 0, task: "", lastTool: "" };
  }
}

// ── Pipeline ────────────────────────────────────────────────────────────────

function renderPipeline() {
  const names = Object.keys(agentState).filter((n) => n !== "alice");
  if (!names.length) {
    $("pipeline").innerHTML = '<span class="empty">Waiting for agents…</span>';
    return;
  }

  $("pipeline").innerHTML = names
    .map((name, i) => {
      const a = agentState[name];
      const cls = a.status === "active" ? "active" : a.status === "done" ? "done" : a.status === "waiting" ? "waiting" : "";
      const stepTxt =
        a.status === "active"
          ? "Step " + a.step + (a.lastTool ? " → " + a.lastTool : "") + "…"
          : a.status === "done"
            ? "Done"
            : a.status === "waiting"
              ? "⏸ Waiting for children…"
              : a.status === "error"
                ? "Error"
                : "Idle";
      const arrow =
        i < names.length - 1
          ? '<div class="pipeline-arrow' + (a.status === "done" ? " lit" : "") + '">→</div>'
          : "";

      return (
        '<div class="agent-card ' + cls + '">' +
        '<div class="agent-name">' +
        '<span class="status-dot ' + a.status + '"></span>' +
        '<div class="spinner"></div>' +
        esc(name) +
        "</div>" +
        '<div class="agent-task">' + esc(trunc(a.task, 32)) + "</div>" +
        '<div class="agent-step">' + esc(stepTxt) + "</div>" +
        "</div>" +
        arrow
      );
    })
    .join("");
}

// ── Feed ────────────────────────────────────────────────────────────────────

function startGroup(type, label, color) {
  const g = document.createElement("div");
  g.className = "feed-group" + (type === "round" ? " round-group" : "");
  const h = document.createElement("div");
  h.className = "group-header";
  if (color) h.style.color = color;
  h.textContent = label;
  g.appendChild(h);
  feed.appendChild(g);
  currentGroup = g;
  feed.scrollTop = feed.scrollHeight;
}

function addFI(cls, icon, body, t, fullBody) {
  const el = document.createElement("div");
  const hasMore = fullBody && fullBody !== body;
  el.className = "feed-item " + cls + (hasMore ? " expandable" : "");
  el.innerHTML =
    '<span class="fi-icon">' + icon + "</span>" +
    '<span class="fi-body">' + body + "</span>" +
    '<span class="fi-time">' + time(t) + "</span>";
  if (hasMore) {
    el.dataset.short = body;
    el.dataset.full = fullBody;
    el.addEventListener("click", () => {
      const bodyEl = el.querySelector(".fi-body");
      const expanded = el.classList.toggle("expanded");
      bodyEl.innerHTML = expanded ? el.dataset.full : el.dataset.short;
    });
  }
  (currentGroup || feed).appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function handleEvent(ev) {
  const t = ev.type;
  const d = ev.data;

  if (t === "header") {
    if (d.text?.includes("—")) $("model").textContent = d.text.split("—").pop()?.trim() || "—";
    if (d.text === "Processing") startGroup("round", "Processing", "var(--accent)");
    else if (d.text === "User Input") startGroup("section", d.text, "var(--accent)");
    else addFI("info-item", "", "<b>" + esc(d.text) + "</b>", ev.time);
    return;
  }
  if (t === "round") { startGroup("round", "Round " + d.round + " — " + d.taskCount + " task(s)", "var(--accent)"); return; }
  if (t === "actor") {
    ensureAgent(d.name);
    Object.assign(agentState[d.name], { status: "active", step: 0, task: d.taskTitle, lastTool: "" });
    renderPipeline();
    addFI("", "→", "<b>" + esc(d.name) + "</b> <em>" + esc(trunc(d.taskTitle, 48)) + "</em>", ev.time);
    return;
  }
  if (t === "llm") {
    const a = d.actorName || Object.keys(agentState).find((k) => agentState[k].status === "active");
    if (a && agentState[a]) { agentState[a].step = d.step; agentState[a].lastTool = ""; }
    renderPipeline();
    addFI("llm-step", "◆", actorTag(a) + "LLM step " + d.step, ev.time);
    return;
  }
  if (t === "tool") {
    const a = d.actorName || Object.keys(agentState).find((k) => agentState[k].status === "active");
    if (a && agentState[a]) agentState[a].lastTool = d.name;
    renderPipeline();
    const argsFull = JSON.stringify(d.args, null, 2);
    const argsShort = JSON.stringify(d.args);
    addFI("tool-call", "⚡",
      actorTag(a) + '<span class="tool-name">' + esc(d.name) + '</span> <span class="tool-args">' + esc(trunc(argsShort, 50)) + "</span>",
      ev.time,
      actorTag(a) + '<span class="tool-name">' + esc(d.name) + '</span><pre class="fi-pre">' + esc(argsFull) + "</pre>"
    );
    return;
  }
  if (t === "toolResult") {
    addFI("tool-result" + (d.ok ? "" : " fail"), d.ok ? "✓" : "✗",
      actorTag(d.actorName) + esc(trunc(d.output, 70)),
      ev.time,
      actorTag(d.actorName) + '<pre class="fi-pre">' + esc(d.output) + "</pre>"
    );
    return;
  }
  if (t === "decision") {
    addFI("decision-item", "",
      actorTag(d.actorName) + esc(trunc(d.text, 70)),
      ev.time,
      actorTag(d.actorName) + esc(d.text)
    );
    return;
  }
  if (t === "delegate") { addFI("delegate-item", "→", "<b>" + esc(d.from) + "</b> → <b>" + esc(d.to) + "</b> " + esc(trunc(d.title, 40)), ev.time); return; }
  if (t === "artifact") { addFI("artifact-item", "", actorTag(d.actorName) + esc(d.action) + " <b>" + esc(d.path) + "</b>" + (d.chars ? " (" + d.chars.toLocaleString() + ")" : ""), ev.time); return; }
  if (t === "taskDone") {
    if (d.actorName && agentState[d.actorName]) agentState[d.actorName].status = "done";
    renderPipeline();
    addFI("task-done-item", "✓",
      "<b>" + esc(d.actorName) + "</b> " + esc(trunc(d.summary, 55)),
      ev.time,
      "<b>" + esc(d.actorName) + "</b> " + esc(d.summary)
    );
    return;
  }
  if (t === "taskWaiting") {
    if (d.actorName && agentState[d.actorName]) agentState[d.actorName].status = "waiting";
    renderPipeline();
    addFI("task-waiting-item", "⏸",
      "<b>" + esc(d.actorName) + "</b> " + esc(trunc(d.reason || "", 55)),
      ev.time,
      "<b>" + esc(d.actorName) + "</b> " + esc(d.reason || "")
    );
    return;
  }
  if (t === "taskError" || t === "taskBlocked") {
    if (d.actorName && agentState[d.actorName]) agentState[d.actorName].status = "error";
    renderPipeline();
    addFI("task-error-item", "✗", "<b>" + esc(d.actorName || "?") + "</b> " + esc(d.error || d.reason || ""), ev.time);
    return;
  }
  if (t === "info") { addFI("info-item", "", esc(d.message), ev.time); return; }
  if (t === "success") { addFI("task-done-item", "✓", esc(d.message), ev.time); return; }
  if (t === "summary") { addFI("info-item", "", esc(d.label) + ": <b>" + esc(String(d.value)) + "</b>", ev.time); return; }
  if (t === "done") { addFI("done-item", "✓", "All tasks completed", ev.time); return; }
}

// ── Drawer ──────────────────────────────────────────────────────────────────

function openDrawer(kind, id) {
  if (!lastState) return;
  const drawer = $("drawer");
  const backdrop = $("backdrop");
  const kindEl = $("drawerKind");
  const titleEl = $("drawerTitle");
  const bodyEl = $("drawerBody");

  if (kind === "artifact") {
    const a = (lastState.artifacts || []).find((x) => x.id === id);
    if (!a) return;
    kindEl.textContent = a.kind;
    kindEl.style.background = a.kind === "plan" ? "var(--mag)" : "var(--cyan)";
    titleEl.textContent = a.path;
    bodyEl.innerHTML =
      '<table class="meta-table">' +
      "<tr><td>Kind</td><td>" + esc(a.kind) + "</td></tr>" +
      "<tr><td>Version</td><td>" + a.version + "</td></tr>" +
      "<tr><td>Chars</td><td>" + (a.metadata?.chars || "?") + "</td></tr>" +
      "<tr><td>Path</td><td>" + esc(a.path) + "</td></tr>" +
      '</table><pre id="artContent">Loading…</pre>';
    drawer.classList.add("open");
    backdrop.classList.add("open");
    fetch("/api/artifact/" + encodeURIComponent(a.path))
      .then((r) => r.json())
      .then((j) => { const el = $("artContent"); if (el) el.textContent = j.content || "(empty)"; })
      .catch(() => {});
    return;
  }

  if (kind === "task") {
    const t = (lastState.tasks || []).find((x) => x.id === id);
    if (!t) return;
    const owner = (lastState.actors || []).find((a) => a.id === t.owner_actor_id)?.name || "?";
    const items = (lastState.items || []).filter((i) => i.task_id === id).sort((a, b) => a.sequence - b.sequence);
    kindEl.textContent = "task";
    kindEl.style.background = "var(--accent)";
    titleEl.textContent = t.title;
    let body =
      '<table class="meta-table">' +
      "<tr><td>Status</td><td>" + esc(t.status) + "</td></tr>" +
      "<tr><td>Owner</td><td>" + esc(owner) + "</td></tr>" +
      "<tr><td>Priority</td><td>" + t.priority + "</td></tr>" +
      "</table>";
    body += '<h3 class="section-title" style="margin-top:8px">Items (' + items.length + ")</h3>";
    for (const i of items) {
      const what = typeof i.content?.text === "string" ? i.content.text : typeof i.content?.tool === "string" ? i.content.tool + "()" : JSON.stringify(i.content);
      body += '<div style="padding:3px 0;font-size:11px;border-bottom:1px solid var(--border)"><span style="color:var(--dim)">#' + i.sequence + " [" + i.type + "]</span> " + esc(trunc(what, 80)) + "</div>";
    }
    bodyEl.innerHTML = body;
    drawer.classList.add("open");
    backdrop.classList.add("open");
    return;
  }

  if (kind === "actor") {
    const a = (lastState.actors || []).find((x) => x.id === id);
    if (!a) return;
    const tasks = (lastState.tasks || []).filter((t) => t.owner_actor_id === id);
    const tools = a.capabilities?.tools || [];
    kindEl.textContent = "actor";
    kindEl.style.background = "var(--cyan)";
    titleEl.textContent = a.name;
    let body =
      '<table class="meta-table">' +
      "<tr><td>Type</td><td>" + esc(a.type) + "</td></tr>" +
      "<tr><td>Tools</td><td>" + esc(tools.join(", ") || "none") + "</td></tr>" +
      "</table>";
    body += '<h3 class="section-title" style="margin-top:8px">Owned tasks (' + tasks.length + ")</h3>";
    for (const t of tasks) {
      body +=
        '<div class="task-row" onclick="openDrawer(\'task\',\'' + t.id + "')\">" +
        '<span class="task-dot ' + t.status + '"></span>' +
        '<span class="task-title">' + esc(trunc(t.title, 50)) + "</span></div>";
    }
    if (a.capabilities?.instructions) {
      body += '<h3 class="section-title" style="margin-top:10px">Instructions</h3><pre style="font-size:11px;color:var(--dim)">' + esc(a.capabilities.instructions) + "</pre>";
    }
    bodyEl.innerHTML = body;
    drawer.classList.add("open");
    backdrop.classList.add("open");
    return;
  }
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("backdrop").classList.remove("open");
}

$("backdrop").addEventListener("click", closeDrawer);
$("drawerClose").addEventListener("click", closeDrawer);

// ── Sidebar data ────────────────────────────────────────────────────────────

async function refreshSidebar() {
  try {
    const s = await (await fetch("/api/state")).json();
    lastState = s;
    renderStats(s);
    renderTasks(s.tasks, s.actors);
    renderArtifacts(s.artifacts);
    renderRelations(s.relations, s);
    renderGraph(s);
    for (const a of s.actors || []) if (a.type === "agent") ensureAgent(a.name);
    renderPipeline();
  } catch { /* server may not be ready */ }
}

function renderStats(s) {
  const entries = [["tasks", s.tasks], ["items", s.items], ["artifacts", s.artifacts], ["relations", s.relations], ["actors", s.actors], ["sessions", s.sessions]];
  $("stats").innerHTML = entries
    .map(([l, v]) => '<div class="stat-card"><div class="stat-value">' + (v?.length ?? 0) + '</div><div class="stat-label">' + l + "</div></div>")
    .join("");
}

function renderTasks(tasks, actors) {
  if (!tasks?.length) { $("tasks").innerHTML = '<div class="empty">No tasks yet</div>'; return; }
  const am = Object.fromEntries((actors || []).map((a) => [a.id, a.name]));
  const childrenByParent = new Map();
  for (const task of tasks) {
    const parentId = task.parent_task_id || "__root__";
    const bucket = childrenByParent.get(parentId) || [];
    bucket.push(task);
    childrenByParent.set(parentId, bucket);
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  }

  const renderBranch = (parentId, depth = 0) => {
    const branch = childrenByParent.get(parentId) || [];
    let html = "";
    for (const task of branch) {
      html += taskRow(task, am, depth);
      html += renderBranch(task.id, depth + 1);
    }
    return html;
  };

  let html = "";
  html += renderBranch("__root__", 0);
  $("tasks").innerHTML = html;
}

function taskRow(t, am, depth) {
  const o = t.owner_actor_id ? am[t.owner_actor_id] || "?" : "?";
  return (
    '<div class="task-row" style="padding-left:' + (depth * 16) + 'px" onclick="openDrawer(\'task\',\'' + t.id + "')\">" +
    '<span class="task-dot ' + t.status + '"></span>' +
    '<span class="task-title">' + esc(trunc(t.title, 28)) + "</span>" +
    '<span class="task-owner">' + esc(o) + "</span></div>"
  );
}

function renderArtifacts(arts) {
  if (!arts?.length) { $("artifacts").innerHTML = '<div class="empty">No artifacts yet</div>'; return; }
  $("artifacts").innerHTML = arts
    .map((a) =>
      '<div class="artifact-row" onclick="openDrawer(\'artifact\',\'' + a.id + "')\">" +
      '<span class="artifact-kind ' + a.kind + '">' + a.kind + "</span>" +
      '<span class="artifact-path">' + esc(a.path) + "</span>" +
      '<span class="artifact-meta">v' + a.version + "</span></div>")
    .join("");
}

function renderRelations(rels, s) {
  const derivedTaskHierarchy = (s.tasks || [])
    .filter((t) => t.parent_task_id)
    .map((t) => ({
      from_kind: "task",
      from_id: t.id,
      relation_type: "subtask_of",
      to_kind: "task",
      to_id: t.parent_task_id,
    }));
  const allRelations = [...derivedTaskHierarchy, ...(rels || [])];

  if (!allRelations.length) { $("relations").innerHTML = '<div class="empty">No relations yet</div>'; return; }
  const rv = (kind, id) => {
    if (kind === "actor") return (s.actors || []).find((a) => a.id === id)?.name || id.slice(0, 6);
    if (kind === "task") { const t = (s.tasks || []).find((t) => t.id === id); return t ? trunc(t.title, 18) : id.slice(0, 6); }
    if (kind === "artifact") { const a = (s.artifacts || []).find((a) => a.id === id); return a?.path || id.slice(0, 6); }
    return id.slice(0, 6);
  };
  $("relations").innerHTML = allRelations
    .map((r) => '<div class="relation-row">' + esc(rv(r.from_kind, r.from_id)) + ' <span class="relation-type">' + r.relation_type.replace(/_/g, " ") + "</span> " + esc(rv(r.to_kind, r.to_id)) + "</div>")
    .join("");
}

// ── Graph (projection-based Cytoscape views) ────────────────────────────────

const GRAPH_COLORS = {
  actor: "#2dd4bf",
  task: "#a1a1aa",
  artifact: "#c084fc",
  assigned_to: "#52525b",
  subtask: "#52525b",
  depends_on: "#f59e0b",
  produces: "#52525b",
  input: "#52525b",
};

const GRAPH_VIEW_CONFIG = {
  execution: {
    empty: "Waiting for actors and tasks…",
    legend: [
      { type: "node", color: GRAPH_COLORS.actor, label: "actor" },
      { type: "node", color: GRAPH_COLORS.task, label: "task" },
      { type: "edge", color: GRAPH_COLORS.assigned_to, label: "assigned to", dotted: true },
      { type: "edge", color: GRAPH_COLORS.subtask, label: "subtask" },
      { type: "edge", color: GRAPH_COLORS.depends_on, label: "depends on", dashed: true },
    ],
  },
  artifacts: {
    empty: "Waiting for task-artifact flow…",
    legend: [
      { type: "node", color: GRAPH_COLORS.task, label: "task" },
      { type: "node", color: GRAPH_COLORS.artifact, label: "artifact" },
      { type: "edge", color: GRAPH_COLORS.produces, label: "produces" },
      { type: "edge", color: GRAPH_COLORS.input, label: "read by", dashed: true },
    ],
  },
};

const graphUi = {
  ready: false,
  elkRegistered: false,
  activeView: "execution",
  renderedView: null,
  cy: null,
  viewportByView: {
    execution: null,
    artifacts: null,
  },
  signatureByView: {
    execution: "",
    artifacts: "",
  },
  pendingState: null,
  renderPromise: null,
};

const GRAPH_FIT_PADDING = 72;
const GRAPH_ZOOM_STEP = 1.18;

function actorNodeId(id) {
  return "actor:" + id;
}

function taskNodeId(id) {
  return "task:" + id;
}

function artifactNodeId(id) {
  return "artifact:" + id;
}

function renderLegendItem(item) {
  if (item.type === "node") {
    return '<span><i class="gl-dot" style="background:' + item.color + '"></i>' + esc(item.label) + "</span>";
  }

  const style = item.dashed
    ? "background:transparent;border-top:2px dashed " + item.color + ";height:0"
    : item.dotted
      ? "background:transparent;border-top:2px dotted " + item.color + ";height:0"
      : "background:" + item.color;

  return '<span><i class="gl-line" style="' + style + '"></i>' + esc(item.label) + "</span>";
}

function updateGraphChrome() {
  const config = GRAPH_VIEW_CONFIG[graphUi.activeView];
  document.querySelectorAll("[data-graph-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.graphView === graphUi.activeView);
  });
  $("graphLegend").innerHTML = config.legend.map(renderLegendItem).join("");
  $("graphEmpty").textContent = config.empty;
}

function saveCurrentViewport() {
  if (!graphUi.cy || !graphUi.renderedView) return;
  graphUi.viewportByView[graphUi.renderedView] = {
    zoom: graphUi.cy.zoom(),
    pan: { ...graphUi.cy.pan() },
  };
}

function zoomGraph(multiplier) {
  if (!graphUi.cy) return;
  const minZoom = graphUi.cy.minZoom();
  const maxZoom = graphUi.cy.maxZoom();
  const nextZoom = Math.min(maxZoom, Math.max(minZoom, graphUi.cy.zoom() * multiplier));
  graphUi.cy.zoom({
    level: nextZoom,
    renderedPosition: {
      x: graphUi.cy.width() / 2,
      y: graphUi.cy.height() / 2,
    },
  });
  saveCurrentViewport();
}

function fitGraph() {
  if (!graphUi.cy) return;
  graphUi.cy.fit(graphUi.cy.elements(), GRAPH_FIT_PADDING);
  saveCurrentViewport();
}

function toggleFullscreen() {
  const section = $("graphSection");
  const btn = $("fullscreenBtn");
  const isFullscreen = section.classList.toggle("fullscreen");
  btn.textContent = isFullscreen ? "Collapse" : "Expand";
  
  if (graphUi.cy) {
    // Need a small timeout to let CSS transition finish before resizing canvas
    setTimeout(() => {
      graphUi.cy.resize();
      fitGraph();
    }, 350);
  }
}

function ensureGraphUi() {
  if (graphUi.ready) return;

  if (typeof cytoscape === "function" && typeof cytoscapeElk === "function" && !graphUi.elkRegistered) {
    cytoscape.use(cytoscapeElk);
    graphUi.elkRegistered = true;
  }

  document.querySelectorAll("[data-graph-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextView = button.dataset.graphView;
      if (!nextView || nextView === graphUi.activeView) return;
      saveCurrentViewport();
      graphUi.activeView = nextView;
      updateGraphChrome();
      if (lastState) void renderGraph(lastState);
    });
  });

  document.querySelectorAll("[data-graph-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.graphAction;
      if (action === "zoom-in") zoomGraph(GRAPH_ZOOM_STEP);
      if (action === "zoom-out") zoomGraph(1 / GRAPH_ZOOM_STEP);
      if (action === "fit") fitGraph();
      if (action === "fullscreen") toggleFullscreen();
    });
  });

  updateGraphChrome();
  graphUi.ready = true;
}

function buildGraphSignature(elements) {
  return elements
    .map((element) => {
      const data = element.data || {};
      return [
        data.id || "",
        data.parent || "",
        data.source || "",
        data.target || "",
        data.label || "",
        data.nodeKind || "",
        data.edgeKind || "",
        data.status || "",
      ].join("|");
    })
    .sort()
    .join("\n");
}

function buildExecutionProjection(state) {
  const elements = [];
  const actorIds = new Set();
  const taskIds = new Set();
  const actorNames = new Map();
  const actors = [...(state.actors || [])]
    .filter((a) => a.type !== "user")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const actor of actors) actorNames.set(actor.id, actor.name);
  const tasks = [...(state.tasks || [])]
    .sort((a, b) =>
      (actorNames.get(a.owner_actor_id) || "").localeCompare(actorNames.get(b.owner_actor_id) || "")
      || a.priority - b.priority
      || a.created_at.localeCompare(b.created_at)
      || a.title.localeCompare(b.title),
    );
  const relations = [...(state.relations || [])]
    .sort((a, b) => a.relation_type.localeCompare(b.relation_type) || a.id.localeCompare(b.id));

  for (const actor of actors) {
    actorIds.add(actor.id);
    elements.push({
      data: {
        id: actorNodeId(actor.id),
        entityKind: "actor",
        entityId: actor.id,
        nodeKind: "actor",
        label: actor.name,
      },
    });
  }

  for (const task of tasks) {
    taskIds.add(task.id);

    elements.push({
      data: {
        id: taskNodeId(task.id),
        entityKind: "task",
        entityId: task.id,
        nodeKind: "task",
        label: task.title,
        status: task.status,
      },
    });
  }

  for (const task of tasks) {
    if (!task.owner_actor_id || !actorIds.has(task.owner_actor_id)) continue;
    elements.push({
      data: {
        id: "assigned:" + task.id,
        source: actorNodeId(task.owner_actor_id),
        target: taskNodeId(task.id),
        edgeKind: "assigned_to",
      },
    });
  }

  for (const task of tasks) {
    if (!task.parent_task_id || !taskIds.has(task.parent_task_id)) continue;
    elements.push({
      data: {
        id: "subtask:" + task.id,
        source: taskNodeId(task.parent_task_id),
        target: taskNodeId(task.id),
        edgeKind: "subtask",
      },
    });
  }

  for (const relation of relations) {
    if (relation.relation_type === "depends_on" && relation.from_kind === "task" && relation.to_kind === "task") {
      if (!taskIds.has(relation.from_id) || !taskIds.has(relation.to_id)) continue;
      elements.push({
        data: {
          id: relation.id,
          source: taskNodeId(relation.to_id),
          target: taskNodeId(relation.from_id),
          edgeKind: "depends_on",
        },
      });
    }
  }

  return {
    elements,
    signature: buildGraphSignature(elements),
    layout: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.nodeNode": "60",
      "elk.spacing.edgeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "30",
      "elk.padding": "[top=96,left=56,bottom=56,right=56]",
    },
  };
}

function buildArtifactProjection(state) {
  const elements = [];
  const taskIndex = new Map((state.tasks || []).map((task) => [task.id, task]));
  const artifactIndex = new Map((state.artifacts || []).map((artifact) => [artifact.id, artifact]));
  const seenTaskIds = new Set();
  const seenArtifactIds = new Set();
  const relations = [...(state.relations || [])]
    .sort((a, b) => a.relation_type.localeCompare(b.relation_type) || a.id.localeCompare(b.id));

  const ensureTaskNode = (taskId) => {
    if (seenTaskIds.has(taskId)) return;
    const task = taskIndex.get(taskId);
    if (!task) return;
    seenTaskIds.add(taskId);
    elements.push({
      data: {
        id: taskNodeId(task.id),
        entityKind: "task",
        entityId: task.id,
        nodeKind: "task",
        label: task.title,
        status: task.status,
      },
    });
  };

  const ensureArtifactNode = (artifactId) => {
    if (seenArtifactIds.has(artifactId)) return;
    const artifact = artifactIndex.get(artifactId);
    if (!artifact) return;
    seenArtifactIds.add(artifactId);
    elements.push({
      data: {
        id: artifactNodeId(artifact.id),
        entityKind: "artifact",
        entityId: artifact.id,
        nodeKind: "artifact",
        label: artifact.path,
        artifactKind: artifact.kind,
      },
    });
  };

  for (const relation of relations) {
    if (relation.relation_type === "produces" && relation.from_kind === "task" && relation.to_kind === "artifact") {
      ensureTaskNode(relation.from_id);
      ensureArtifactNode(relation.to_id);
      if (!seenTaskIds.has(relation.from_id) || !seenArtifactIds.has(relation.to_id)) continue;
      elements.push({
        data: {
          id: relation.id,
          source: taskNodeId(relation.from_id),
          target: artifactNodeId(relation.to_id),
          edgeKind: "produces",
        },
      });
    }

    if (relation.relation_type === "uses" && relation.from_kind === "task" && relation.to_kind === "artifact") {
      ensureTaskNode(relation.from_id);
      ensureArtifactNode(relation.to_id);
      if (!seenTaskIds.has(relation.from_id) || !seenArtifactIds.has(relation.to_id)) continue;
      elements.push({
        data: {
          id: relation.id,
          source: artifactNodeId(relation.to_id),
          target: taskNodeId(relation.from_id),
          edgeKind: "input",
        },
      });
    }
  }

  return {
    elements,
    signature: buildGraphSignature(elements),
    layout: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.nodeNode": "60",
      "elk.spacing.edgeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "30",
      "elk.padding": "[top=56,left=56,bottom=48,right=56]",
    },
  };
}

function getGraphStyles() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "overlay-opacity": 0,
        "font-family": "Inter, sans-serif",
        "font-size": 11,
        "font-weight": 500,
        "text-wrap": "wrap",
        "text-max-width": "160px",
        "text-valign": "center",
        "text-halign": "center",
        "min-zoomed-font-size": 8,
        color: "#e4e4e7",
      },
    },
    {
      selector: 'node[nodeKind = "actor"]',
      style: {
        shape: "round-rectangle",
        width: 120,
        height: 36,
        "background-color": "#18181b",
        "border-color": GRAPH_COLORS.actor,
        "border-width": 1,
        "border-opacity": 0.8,
        color: GRAPH_COLORS.actor,
        "font-size": 11,
        "font-weight": 600,
        "text-valign": "center",
        "text-halign": "center",
      },
    },
    {
      selector: 'node[nodeKind = "task"]',
      style: {
        shape: "round-rectangle",
        width: 200,
        height: 64,
        "background-color": "#18181b",
        "border-color": "#3f3f46",
        "border-width": 1,
        "text-max-width": "180px",
        padding: 10,
      },
    },
    {
      selector: 'node[nodeKind = "task"][status = "done"]',
      style: {
        "background-color": "#052e16",
        "border-color": "#059669",
        color: "#34d399",
      },
    },
    {
      selector: 'node[nodeKind = "task"][status = "in_progress"]',
      style: {
        "background-color": "#172554",
        "border-color": "#2563eb",
        color: "#60a5fa",
      },
    },
    {
      selector: 'node[nodeKind = "task"][status = "waiting"]',
      style: {
        "background-color": "#451a03",
        "border-color": "#b45309",
        color: "#fbbf24",
      },
    },
    {
      selector: 'node[nodeKind = "task"][status = "blocked"]',
      style: {
        "background-color": "#450a0a",
        "border-color": "#dc2626",
        color: "#fca5a5",
      },
    },
    {
      selector: 'node[nodeKind = "artifact"]',
      style: {
        shape: "round-rectangle",
        width: 220,
        height: 56,
        "background-color": "#2e1065",
        "border-color": "#7c3aed",
        "border-width": 1,
        color: "#a78bfa",
        "font-family": "SF Mono, Fira Code, monospace",
        "font-size": 10,
        "text-max-width": "190px",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "curve-style": "taxi",
        "taxi-direction": "rightward",
        "taxi-turn": 16,
        "taxi-turn-min-distance": 8,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "line-color": "#52525b",
        "target-arrow-color": "#52525b",
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'edge[edgeKind = "assigned_to"]',
      style: {
        "line-color": GRAPH_COLORS.assigned_to,
        "target-arrow-color": GRAPH_COLORS.assigned_to,
        "line-style": "dotted",
        "taxi-direction": "downward",
      },
    },
    {
      selector: 'edge[edgeKind = "subtask"]',
      style: {
        "line-color": GRAPH_COLORS.subtask,
        "target-arrow-color": GRAPH_COLORS.subtask,
        "taxi-direction": "downward",
      },
    },
    {
      selector: 'edge[edgeKind = "depends_on"]',
      style: {
        "line-color": GRAPH_COLORS.depends_on,
        "target-arrow-color": GRAPH_COLORS.depends_on,
        "line-style": "dashed",
        "taxi-direction": "downward",
      },
    },
    {
      selector: 'edge[edgeKind = "produces"]',
      style: {
        "line-color": GRAPH_COLORS.produces,
        "target-arrow-color": GRAPH_COLORS.produces,
        "taxi-direction": "rightward",
      },
    },
    {
      selector: 'edge[edgeKind = "input"]',
      style: {
        "line-color": GRAPH_COLORS.input,
        "target-arrow-color": GRAPH_COLORS.input,
        "line-style": "dashed",
        "taxi-direction": "rightward",
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 2,
        "border-color": "#fafafa",
        "border-opacity": 1,
      },
    },
  ];
}

async function renderGraphNow(state) {
  ensureGraphUi();

  if (typeof cytoscape !== "function") {
    $("graphEmpty").textContent = "Graph library failed to load";
    $("graphEmpty").style.display = "flex";
    return;
  }

  const view = graphUi.activeView;
  const projection = view === "execution"
    ? buildExecutionProjection(state)
    : buildArtifactProjection(state);

  updateGraphChrome();

  const canvas = $("graphCanvas");
  const empty = $("graphEmpty");
  const sameView = graphUi.renderedView === view;
  const sameSignature = sameView && graphUi.signatureByView[view] === projection.signature;

  if (sameSignature && graphUi.cy) {
    empty.style.display = projection.elements.length ? "none" : "flex";
    graphUi.cy.resize();
    return;
  }

  saveCurrentViewport();

  if (graphUi.cy) {
    graphUi.cy.destroy();
    graphUi.cy = null;
    graphUi.renderedView = null;
  }

  canvas.innerHTML = "";
  graphUi.signatureByView[view] = projection.signature;

  if (!projection.elements.length) {
    empty.style.display = "flex";
    return;
  }

  empty.style.display = "none";

  const cy = cytoscape({
    container: canvas,
    elements: projection.elements,
    style: getGraphStyles(),
    minZoom: 0.2,
    maxZoom: 2.5,
    wheelSensitivity: 0.18,
    panningEnabled: true,
    userPanningEnabled: true,
    zoomingEnabled: true,
    userZoomingEnabled: true,
    boxSelectionEnabled: false,
    autounselectify: true,
  });

  cy.on("tap", "node", (event) => {
    const data = event.target.data();
    if (data.entityKind && data.entityId) openDrawer(data.entityKind, data.entityId);
  });

  cy.on("pan zoom", () => {
    saveCurrentViewport();
  });

  cy.on("mousedown", (event) => {
    if (event.target === cy) canvas.classList.add("is-panning");
  });

  const stopPanning = () => {
    canvas.classList.remove("is-panning");
  };

  cy.on("mouseup tapend mouseout", stopPanning);

  graphUi.cy = cy;
  graphUi.renderedView = view;

  const layout = cy.layout({
    name: "elk",
    fit: false,
    animate: false,
    padding: GRAPH_FIT_PADDING,
    nodeDimensionsIncludeLabels: true,
    elk: projection.layout,
  });

  await new Promise((resolve) => {
    layout.one("layoutstop", resolve);
    layout.run();
  });

  const viewport = graphUi.viewportByView[view];
  if (viewport) {
    cy.zoom(viewport.zoom);
    cy.pan(viewport.pan);
  } else {
    cy.fit(cy.elements(), GRAPH_FIT_PADDING);
  }
}

async function renderGraph(state) {
  graphUi.pendingState = state;

  if (graphUi.renderPromise) return graphUi.renderPromise;

  graphUi.renderPromise = (async () => {
    try {
      while (graphUi.pendingState) {
        const nextState = graphUi.pendingState;
        graphUi.pendingState = null;
        await renderGraphNow(nextState);
      }
    } catch (error) {
      console.error("[graph] render failed", error);
      $("graphEmpty").textContent = "Failed to render graph";
      $("graphEmpty").style.display = "flex";
    } finally {
      graphUi.renderPromise = null;
    }
  })();

  return graphUi.renderPromise;
}

// ── SSE ─────────────────────────────────────────────────────────────────────

const es = new EventSource("/events");
es.onopen = () => { $("connDot").classList.add("on"); $("connLabel").textContent = "connected"; };
es.onerror = () => { $("connDot").classList.remove("on"); $("connLabel").textContent = "disconnected"; };
es.onmessage = (e) => { const ev = JSON.parse(e.data); handleEvent(ev); refreshSidebar(); };

refreshSidebar();
