# 04_05_review

Markdown review lab. A document-centered UI with inline comment tooltips, powered by a review agent that anchors suggestions to exact text.

## Run

```bash
bun install
bun run start          # builds frontend + starts server
```

Opens at `http://127.0.0.1:4405`.

For development with HMR, run two terminals:

```bash
bun run dev:server     # backend on :4405
bun run dev:client     # vite on :5174, proxies /api → :4405
```

## How it works

Pick a document and a prompt, hit Run. The agent reviews block by block (or the whole document at once), adding comments anchored to exact quotes. Comments appear as inline highlights — click one or press `j`/`k` to navigate, and a tooltip shows the comment with accept/reject actions.

Accepting a suggestion patches the markdown file. Rejecting dismisses it. Revert undoes an accepted suggestion.

Prompts live in `workspace/prompts`. A prompt can also reference extra workspace files through frontmatter `contextFiles`, which is useful for assets such as internal-linking sitemaps.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous comment |
| `a` | Accept current suggestion |
| `r` | Reject current comment |
| `u` | Revert accepted suggestion |
| `Esc` | Dismiss tooltip / cancel edit |
| `⌘↵` | Run review |

## Stack

**Backend:** Node server, agent loop with OpenAI Responses API, review engine with streaming NDJSON progress.

**Frontend:** Svelte 5 (runes), Vite, no runtime CSS framework.

**Parsing:** `remark` (unified + remark-gfm) for AST-based block detection, `marked` for inline HTML rendering.

## Structure

```text
04_05_review/
├── app.js                     # entry — starts server
├── src/                       # backend
│   ├── server.js              # HTTP + static file serving
│   ├── review-engine.js       # streaming review, accept/reject/revert
│   ├── agent.js               # tool-calling loop
│   ├── markdown.js            # remark parser + serializer
│   ├── tools.js               # add_comment definition + handler
│   └── store.js               # file-backed docs, prompts, reviews
├── frontend/                  # Svelte 5 source
│   ├── App.svelte
│   ├── components/            # TopBar, DocView, Block, CommentTooltip, StatusBar, Toasts
│   └── lib/                   # state (runes), api, keyboard, inline markdown
├── workspace/
│   ├── documents/             # markdown docs to review
│   ├── prompts/               # review prompts (frontmatter + body)
│   ├── reference/             # optional prompt context, e.g. fake sitemap files
│   ├── reviews/               # persisted review JSON
│   └── system/agents/         # reviewer agent profile
├── vite.config.js
└── public/                    # build output (served by backend)
```
