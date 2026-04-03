# 04_05 Apps MCP

Standalone HTTP MCP server for the `04_05_apps` marketing workspace.

It exposes the same todos, Stripe, and newsletter tools/resources used by the browser demo, but as a separate MCP server under `/mcp` so you can connect any MCP-capable UI/client to it.

## Start

```bash
cd 04_05_apps/mcp
bun install
bun start
```

Default endpoint:

```text
http://127.0.0.1:4410/mcp
```

## Environment

This package reads `.env` in this order:

1. repo root
2. `04_05_apps/.env`
3. `04_05_apps/mcp/.env`

Supported vars:

```env
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=4410
MCP_SERVER_NAME=04_05_apps_mcp
MCP_SERVER_VERSION=0.1.0
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | `POST`, `GET`, `DELETE` | MCP Streamable HTTP |
| `/health` | `GET` | Health check |

## Notes

- The MCP definitions live in `src/core/marketing-server.js`.
- The MCP-backed interfaces live in `src/interfaces/` and are portable: they import the MCP Apps browser runtime from `unpkg`, not from the example host app.
- The MCP data layer lives in `src/store/`.
- The parent browser app now connects to this server over HTTP by default instead of using an embedded in-memory MCP runtime.
- Resources use MCP Apps metadata and `ui://` URIs, so clients with MCP Apps support can render the embedded dashboards directly.
