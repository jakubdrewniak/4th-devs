<img src="assets/logo.svg" alt="AI_devs 4: Builders" width="200">

## Requirements

This project runs on [Node.js](https://nodejs.org/) (version 24 or later), a JavaScript runtime. Node.js ships with **npm**, a package manager used to install dependencies and run the examples.

### Installing Node.js

```bash
# macOS (Homebrew — https://brew.sh)
brew install node

# Windows (winget — https://learn.microsoft.com/en-us/windows/package-manager/winget)
winget install OpenJS.NodeJS

# Linux / Ubuntu / Debian (https://deb.nodesource.com)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node -v
npm -v
```

Alternatively, download the installer directly from [nodejs.org/en/download](https://nodejs.org/en/download).

## Setup

Copy the root `env.example` to `.env` for shared repo-level examples.

Set one Responses API key. You can choose between **OpenAI** and **OpenRouter**:

**[OpenRouter](https://openrouter.ai/settings/keys)** (recommended) — create an account and generate an API key. No additional verification required.

```bash
OPENROUTER_API_KEY=your_api_key_here
```

**[OpenAI](https://platform.openai.com/api-keys)** — create an account and generate an API key. Note that OpenAI requires [organization verification](https://help.openai.com/en/articles/10910291-api-organization-verification) before API access is granted, which may take additional time.

```bash
OPENAI_API_KEY=your_api_key_here
```

If both keys are present, provider defaults to OpenAI. Override with `AI_PROVIDER=openrouter`.

Lesson 15 (`03_05_*`) examples use per-project `.env` files. Each `03_05_*` directory has its own `.env.example` — copy it to `.env` and fill in any needed values.

Some Lesson 04 examples also require:

```bash
GEMINI_API_KEY=your_gemini_key_here
REPLICATE_API_TOKEN=your_replicate_token_here
```

For image-generation examples, `OPENROUTER_API_KEY` can be used as the image backend with `google/gemini-3.1-flash-image-preview`. `GEMINI_API_KEY` remains the native fallback, and some media examples still need it for native Gemini-only features.

Lesson 08 (graph agents) requires a running Neo4j 5.11+ instance:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

Some Lesson 05 examples also require:

```bash
RESEND_API_KEY=re_...
RESEND_FROM=noreply@yourdomain.com
SEED_API_KEY=your_optional_seed_token
```

## Lesson 01

| Example | Run | Description |
|---------|-----|-------------|
| `01_01_interaction` | `npm run lesson1:interaction` | Multi-turn conversation via input history |
| `01_01_structured` | `npm run lesson1:structured` | Structured JSON output with schema validation |
| `01_01_grounding` | `npm run lesson1:grounding` | Fact-checked HTML from markdown notes |

Install dependencies:

```bash
npm run lesson1:install
```

## Lesson 02

| Example | Run | Description |
|---------|-----|-------------|
| `01_02_tool_use` | `npm run lesson2:tool_use` | Function calling with sandboxed filesystem tools |
| `01_02_tools` | `bun run lesson2:minimal` | Minimal Responses API function-calling demo with a single `get_weather` tool |

Install dependencies:

```bash
npm run lesson2:install
```

## Lesson 03

| Example | Run | Description |
|---------|-----|-------------|
| `01_03_mcp_core` | `npm run lesson3:mcp_core` | Core MCP capabilities via stdio transport |
| `01_03_mcp_native` | `npm run lesson3:mcp_native` | One agent using MCP and native tools together |
| `01_03_mcp_translator` | `npm run lesson3:mcp_translator` | File translation agent over `files-mcp` |
| `01_03_upload_mcp` | `npm run lesson3:upload_mcp` | Upload workspace files through MCP servers |

Install dependencies:

```bash
npm run lesson3:install
```

## Lesson 04

| Example | Run | Description |
|---------|-----|-------------|
| `01_04_audio` | `npm run lesson4:audio` | Audio transcription, analysis, and TTS with Gemini |
| `01_04_video` | `npm run lesson4:video` | Video analysis, transcription, and extraction with Gemini |
| `01_04_generation` | `npm run lesson4:generation` | Interactive video-processing example with Gemini and MCP tools |
| `01_04_video_generation` | `npm run lesson4:video_generation` | Frame-based video generation with Gemini and Kling |
| `01_04_reports` | `npm run lesson4:reports` | PDF reports from HTML, local assets, and generated images |
| `01_04_image_guidance` | `npm run lesson4:image_guidance` | Pose-guided image generation from JSON templates |
| `01_04_json_image` | `npm run lesson4:json_image` | Token-efficient image generation from JSON prompts |
| `01_04_image_editing` | `npm run lesson4:image_editing` | Iterative image generation and editing with quality checks |
| `01_04_sprites` | `npm run lesson4:sprites` | Parallel isometric sprite-set generation from JSON templates |
| `01_04_image_recognition` | `npm run lesson4:image_recognition` | Vision-based image classification with MCP file operations |

Install dependencies:

```bash
npm run lesson4:install
```

## Lesson 05

| Example | Run | Description |
|---------|-----|-------------|
| `01_05_confirmation` | `npm run lesson5:confirmation` | Email-sending agent with human-in-the-loop confirmation UI |
| `01_05_agent` | `npm run lesson5:agent` | API server for agent orchestration, tool execution, and MCP integration |

Install dependencies:

```bash
npm run lesson5:install
```

`01_05_agent` requires a one-time database setup before the first run:

```bash
npm run lesson5:agent:db:push
npm run lesson5:agent:db:seed
```

The agent server starts on `http://127.0.0.1:3000` by default. The seed script creates a bearer token `0f47acce-3aa7-4b58-9389-21b2940ecc70` for authentication. You can override the port and other settings via `01_05_agent/.env` (local keys take priority over the root `.env`).

## Lesson 06

| Example | Run | Description |
|---------|-----|-------------|
| `02_01_agentic_rag` | `npm run lesson6:agentic_rag` | Agentic RAG with multi-step retrieval and conversation history |

Install dependencies:

```bash
npm run lesson6:install
```

## Lesson 07

| Example | Run | Description |
|---------|-----|-------------|
| `02_02_chunking` | `npm run lesson7:chunking` | Four text chunking strategies compared side-by-side |
| `02_02_embedding` | `npm run lesson7:embedding` | Interactive embedding demo with a pairwise similarity matrix |
| `02_02_hybrid_rag` | `npm run lesson7:hybrid_rag` | Hybrid RAG agent with SQLite FTS5 full-text search and sqlite-vec vector similarity |

Install dependencies:

```bash
npm run lesson7:install
```

## Lesson 08

| Example | Run | Description |
|---------|-----|-------------|
| `02_03_graph_agents` | `npm run lesson8:graph_agents` | Graph RAG agent with Neo4j knowledge graph, hybrid search, and entity exploration |

Install dependencies:

```bash
npm run lesson8:install
```

Requires a running Neo4j 5.11+ instance (needed for vector index support):

```bash
docker run -d --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:5
```

## Lesson 09

| Example | Run | Description |
|---------|-----|-------------|
| `02_04_ops` | `npm run lesson9:ops` | Multi-agent daily ops generator with task delegation |

Install dependencies:

```bash
npm run lesson9:install
```

## Lesson 10

| Example | Run | Description |
|---------|-----|-------------|
| `02_05_agent` | `npm run lesson10:agent` | Context engineering agent with observational memory (observer/reflector pattern) |
| `02_05_sandbox` | `npm run lesson10:sandbox` | MCP sandbox agent with tool discovery and QuickJS code execution |

Install dependencies:

```bash
npm run lesson10:install
```

## Lesson 11

| Example | Run | Description |
|---------|-----|-------------|
| `03_01_observability` | `npm run lesson11:observability` | Minimal agent server with Langfuse tracing at the adapter boundary |
| `03_01_evals` | `npm run lesson11:evals` | Agent server with Langfuse tracing and synthetic tool-use evaluation suite |

Install dependencies:

```bash
npm run lesson11:install
```

Both examples include a demo client — start the server first in a separate terminal:

```bash
npm run lesson11:observability          # terminal 1: start server
npm run lesson11:observability:demo     # terminal 2: run demo session against the server

npm run lesson11:evals                  # terminal 1: start server
npm run lesson11:evals:demo             # terminal 2: run demo session against the server
npm run lesson11:evals:tools            # standalone: synthetic tool-use eval (no server needed)
npm run lesson11:evals:correctness      # standalone: response-correctness eval (no server needed)
```

Both examples require `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` for tracing (optional — degrades gracefully when missing). These can be set in the root `.env` (shared) or in each project's local `.env` (takes priority).

## Lesson 12

| Example | Run | Description |
|---------|-----|-------------|
| `03_02_code` | `npm run lesson12:code` | Code execution agent with a Deno sandbox and MCP file tools |
| `03_02_email` | `npm run lesson12:email` | Two-phase email agent: triage with labels, then isolated KB-scoped draft sessions |
| `03_02_events` | `npm run lesson12:events` | Multi-agent event architecture with heartbeat loop, observer/reflector memory, and human-in-the-loop |

Install dependencies:

```bash
npm run lesson12:install
```

`03_02_code` requires [Deno](https://deno.land/#installation) — the agent executes LLM-generated TypeScript in an isolated Deno sandbox.

`03_02_events` runs an autonomous multi-round demo by default (resets workspace, runs heartbeat, prints summary):

```bash
npm run lesson12:events                                       # default: report-v2 workflow, 10 rounds
```

It requires `GEMINI_API_KEY` for image generation. Optional flags via the local `package.json`:

```bash
bun run demo --workflow report-v2 --rounds 12 --delay-ms 500  # custom rounds/delay
bun run start                                                  # bare index.ts (no reset, no summary)
```

## Lesson 13

| Example | Run | Description |
|---------|-----|-------------|
| `03_03_browser` | `npm run lesson13:browser` | Browser automation agent with Playwright, session persistence, and MCP file tools |
| `03_03_calendar` | `npm run lesson13:calendar` | Calendar agent with add-events and notification-webhook phases |
| `03_03_language` | `npm run lesson13:language` | English coaching agent with Gemini for ASR, scoring, drills, and TTS |

Install dependencies:

```bash
npm run lesson13:install
```

`03_03_browser` requires a one-time login to [Goodreads](https://www.goodreads.com) to save session cookies:

```bash
npm run lesson13:browser:login   # opens browser — log into Goodreads, then press Enter
npm run lesson13:browser          # start chatting, e.g. "List all books by Jim Collins"
```

`03_03_language` requires `GEMINI_API_KEY`.

## Lesson 14

| Example | Run | Description |
|---------|-----|-------------|
| `03_04_gmail` | `npm run lesson14:gmail` | Native Gmail tools agent with OAuth, Zod schemas, and Promptfoo evals |

Install dependencies:

```bash
npm run lesson14:install
```

Requires Google OAuth credentials (`credentials.json`) and a one-time auth flow:

```bash
npm run lesson14:gmail:auth
```

## Lesson 15

| Example | Run | Description |
|---------|-----|-------------|
| `03_05_apps` | `npm run lesson15:apps` | MCP app server with CLI agent, todo/shopping list UI, and live browser preview |
| `03_05_artifacts` | `npm run lesson15:artifacts` | CLI artifact agent with live browser preview, WebSocket sync, and capability packs |
| `03_05_awareness` | `npm run lesson15:awareness` | Awareness agent with temporal context, memory recall, and scout delegation via MCP |
| `03_05_render` | `npm run lesson15:render` | Component-guardrailed rendering agent with live preview and structured specs |

Install dependencies:

```bash
npm run lesson15:install
```

Helpful demos:

```bash
cd 03_05_artifacts && bun run demo
cd 03_05_awareness && bun run demo
cd 03_05_render && bun run demo
```

Each `03_05_*` directory ships its own `.env.example` — copy it to `.env` and set the keys you need.

`03_05_apps` opens a local UI plus an MCP app server for editing `todo.md` and `shopping.md`.

`03_05_artifacts` and `03_05_render` can optionally force a seeded dataset with `DEMO_DATASET_FILE=sales-activities.csv bun run demo`.

`03_05_awareness` requires one API key (`OPENAI_API_KEY` or `OPENROUTER_API_KEY`). The other Lesson 15 examples can also run with a local fallback when no model key is set.

## Lesson 16

| Example | Run | Description |
|---------|-----|-------------|
| `04_01_garden` | `npm run lesson16:garden` | Digital garden assistant focused on `vault/**`, with markdown content that builds into a static website |

Install dependencies:

```bash
npm run lesson16:install
```

Useful commands:

```bash
npm run lesson16:garden
npm run lesson16:garden:build
npm run lesson16:garden:preview
```

`04_01_garden` is a personal digital garden where the `vault/**` markdown content acts as both the agent's workspace and the source for a static site generated by `grove/`.

`04_01_garden` reads the shared repo-level `.env` through the workspace `config.js`, so it can run with either `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. If both keys are present, it defaults to OpenAI unless you set `AI_PROVIDER=openrouter`.

A good first exercise is to ask the agent to add 3-4 favorite books to the shelf, then run `npm run lesson16:garden:preview` to rebuild the grove and open the generated site locally.

## Lesson 19

| Example | Run | Description |
|---------|-----|-------------|
| `04_04_system` | `npm run lesson19:system` | Multi-agent system with MCP tools, agent delegation, and a markdown workspace |
| `04_04_system` (daily news) | `npm run lesson19:daily-news` | Daily-news workflow demo with sequential phase delegation |
| `04_04_system` (examples) | `npm run lesson19:examples` | Example queries: ideas, knowledge notes, contacts, tools, and sources |

Install dependencies:

```bash
npm run lesson19:install
```

`04_04_system` reads the shared repo-level `.env` through the workspace `config.js`, so it can run with either `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

Run individual example queries by number (1-7):

```bash
npm run lesson19:examples -- 1
```

## Lesson 21

| Example | Run | Description |
|---------|-----|-------------|
| `05_01_agent_graph` | `npm run lesson21:agent_graph` | Multi-agent graph with orchestrator, task delegation, artifact writing, and a live Cytoscape dashboard |

Install dependencies:

```bash
npm run lesson21:install
```

`05_01_agent_graph` reads the shared repo-level `.env` through the workspace `config.js`, so it can run with either `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

Pass a custom task as the first argument (defaults to a TypeScript 5.0 blog post):

```bash
cd 05_01_agent_graph && npm start "Research and summarise the latest advances in WebAssembly"
```

The dashboard opens automatically in the browser at `http://127.0.0.1:3001` (or the next available port). All session data is persisted to `.data/` and cleared on each run.

## Lesson 20

| Example | Run | Description |
|---------|-----|-------------|
| `04_05_apps` | `npm run lesson20:apps` | Marketing ops agent with MCP-powered dashboard apps (todos, newsletters, sales, coupons, Stripe) |
| `04_05_apps` (MCP server) | `npm run lesson20:apps:mcp` | MCP server backing the apps agent |
| `04_05_review` | `npm run lesson20:review` | AI-powered markdown document review with inline comments, suggestions, and a Svelte UI |

Install dependencies:

```bash
npm run lesson20:install
```

`04_05_apps` requires the MCP server running in a separate terminal **before** starting the app:

```bash
npm run lesson20:apps:mcp    # terminal 1: start MCP server
npm run lesson20:apps        # terminal 2: start the app
```

`04_05_review` builds the Svelte frontend and starts the server in one step:

```bash
npm run lesson20:review
```

Both examples read the shared repo-level `.env` through the workspace `config.js`, so they can run with either `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
