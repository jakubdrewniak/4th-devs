# 03_03_calendar — Summary

## What it does

An AI agent acting as a calendar assistant. It runs in two phases:
1. **Add Events** — parses natural language requests and creates calendar events using tools
2. **Notifications** — receives webhooks for upcoming events and sends smart "leave now" notifications

## Architecture

```
index.ts
  └── runAgent()
        ├── Phase 1: Add Events      (5 hardcoded scenarios)
        └── Phase 2: Notifications   (5 hardcoded webhooks)
```

## Key concepts

### Tool Loop (agent.ts — runToolLoop)
Core mechanism: sends a message to the AI, executes any tool calls it requests, feeds results back, repeats — until the model returns plain text or max turns (12) is reached.

```
send message → AI responds with tool_call → execute handler → feed result → repeat
                         └── or responds with text → done
```

### Metadata / Context (data/environment.ts)
Before each AI call, a `<metadata>` block is injected with:
- Current simulated time
- User's current location (place ID + address)
- Current weather

### Prompts (prompt.ts)
Two system prompts — one per phase:
- **Add phase**: instructs AI to resolve contacts → find venue → create event
- **Notification phase**: instructs AI to find event → get route → send one notification

### Tools

| Phase | Tools available |
|-------|----------------|
| Add | `search_contacts`, `get_contact`, `search_places`, `get_place`, `web_search`, `create_event`, `list_events` |
| Notification | `find_event`, `list_events`, `get_event`, `get_route`, `send_notification` |

Each tool is defined as `{ name, description, parameters (JSON Schema), handler }`.
The AI reads `description` to decide when to use a tool; `parameters` enforces validation.

### AI layer (core/completion.ts)
Uses OpenAI Responses API (`openai.responses.create`). Returns either a `message` (text) or `function_call` items — the tool loop handles both cases.

## Data flow example

**Add phase — "Book a review with Marta at cafe on Planty":**
1. `search_contacts("Marta")` → email
2. `search_places("cafe Planty")` → `location_id`
3. `create_event({ title, start, end, guests, location_id })`

**Notification phase — "Creative review starts in 45 min":**
1. `find_event("Creative review...", "10:00")` → event details
2. `get_route("p-home", "p-planty-cafe")` → 8 min driving
3. Weather check (rainy? cold?) from metadata
4. `send_notification({ title: "Leave now!", message: "8 min drive, bring umbrella" })`

## Design decisions

- **Separate tool sets per phase** — least privilege; notification agent cannot accidentally create events, add phase agent cannot send notifications
- **Simulated time/location** — `setTime()` / `setUserLocation()` allow deterministic testing without real clock
- **Fuzzy event search** (`find_event`) — scores by title match + time proximity to handle slight title variations
- **In-memory data** — contacts, places, routes, weather are all static mocks in `src/data/`
