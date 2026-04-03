Keywords: `browser host`, `MCP Apps`, `AppBridge`, `tool loop`, `file-backed simulators`, `resource views`.

1. `04_05_apps` should become two surfaces, not one: a browser chat host and an MCP App server. I want to follow the split already used in `03_05_apps/src/index.ts`, which starts both `startUiServer` and `startMcpAppServer`.

2. The browser page itself will be the host. The embedded views will be MCP Apps. That matches the SDK direction in `03_05_apps/node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.d.ts`, where `AppBridge` "acts as a proxy between the host application and a view running in an iframe."

3. I’d keep v1 simple: Bun, ES modules, plain browser JS, plain CSS. No Svelte for the first pass unless the host UI gets too stateful.

4. Backend shape:
   `app.js` as entry,
   `src/server.js` for HTTP + static serving + `/api/chat`,
   `src/agent.js` for the model/tool loop,
   `src/api.js` for the Responses wrapper,
   `src/mcp/server.js` for `registerAppTool` and `registerAppResource`,
   `src/store/*` for file-backed reads/writes,
   `src/tools/*` for tool definitions and handlers,
   `src/resources/*` for HTML resource rendering.

5. Frontend shape:
   `public/index.html`,
   `public/chat.js`,
   `public/styles.css`,
   `public/host.js` for mounting resource cards/iframes and tracking which app view belongs to which tool result.

6. Workspace data:
   `workspace/todos.md`,
   `workspace/emails/inbox/*.md`,
   `workspace/emails/sent/*.md`,
   `workspace/newsletters/drafts/*.md`,
   `workspace/newsletters/sent/*.md`,
   `workspace/stripe/products.json`,
   `workspace/stripe/checkouts.json`.

7. Simulated tools:
   todos with list/add/complete/reopen/remove,
   email with list/read/archive/draft-reply/send-reply,
   newsletter with list/create/edit/preview/send-or-schedule,
   stripe with list/create/update-product/create-checkout/mark-paid/cancel.

8. MCP App resources:
   one todo board,
   one inbox/thread view,
   one newsletter preview/editor view,
   one products + checkout summary view.
   Tools that should open UI will return normal text plus structured data and `_meta.ui.resourceUri`.

9. Chat flow:
   user types in browser,
   `/api/chat` runs the agent,
   the agent calls tools,
   the backend returns assistant text plus UI-open metadata,
   the host renders the matching resource below the assistant turn,
   the resource shows the latest file-backed state.

10. Delivery order:
   first get one end-to-end path working with chat + todos + one MCP App view,
   then add email,
   then newsletter,
   then stripe,
   then tighten the host with richer `AppBridge` interactivity if we want the iframe views to call tools directly instead of being display-first.

11. v1 constraint:
   everything stays fake and local. No real email, no real Stripe, no auth, no background jobs beyond simple file persistence.

I’d implement phase 1 first: browser chat shell, seeded workspace, todo tools, and one todo MCP App view.