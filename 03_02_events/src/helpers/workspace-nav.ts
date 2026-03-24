/**
 * Universal workspace navigation instructions injected into every agent's system prompt.
 * Teaches the LLM how to efficiently use the filesystem without redundant reads or path confusion.
 */

export const WORKSPACE_NAV_INSTRUCTIONS = `
<workspace-navigation>
## Filesystem rules

Your file tools operate relative to the project root. All paths you pass to files__fs_read, files__fs_write, files__fs_search, and files__fs_manage are relative — never prefix them with "workspace/" or "workspace/project/".

### Project structure
\`\`\`
.                          ← project root (files__fs_read ".")
├── goal.md                ← the goal contract (read-only reference)
├── project.md             ← project metadata
├── tasks/                 ← heartbeat task files (managed by system)
├── notes/                 ← research notes, evidence cards
│   └── web/scrape/        ← web scrape results (auto-saved by web__scrape)
├── work/                  ← intermediate working files
├── assets/                ← generated images and media
├── report/                ← report-style deliverables
├── deliverables/          ← final output artifacts
└── system/                ← runtime internals (do not modify)
\`\`\`

### Read / Edit workflow (MANDATORY)
You MUST follow this pattern for every file operation:

**Creating a new file:**
  files__fs_write with operation="create", path="...", content="..."
  This fails if the file already exists — that is intentional.

**Editing an existing file:**
  1. files__fs_read the file → note its line numbers and checksum.
  2. files__fs_write with operation="update", action="replace"|"insert_before"|"insert_after"|"delete_lines", lines="N-M", content="...", checksum="..."
  This applies a targeted line-based edit. NEVER recreate a file to change it.

**NEVER overwrite an existing file by calling operation="create" again. Always use operation="update" with line targeting.**

### HTML rendering
If the task requires an HTML deliverable and you have the render_html tool, call:
  render_html with markdown_path="report/final-report.md", output_path="deliverables/report.html"
The tool reads template.html automatically from the workspace root (you do not need to read or locate it). Just call render_html with the two paths.

### Efficiency rules
1. **Read each file once.** After reading a file, refer to its content from memory. Do not re-read it.
2. **Use paths from tool responses.** When web__scrape saves a file, the response contains the exact path. Use it directly — do not list directories to find it.
3. **Never walk the tree level by level.** If you know or were told a file path, read it directly. Only list a directory when you genuinely do not know what is inside.
4. **Use files__fs_search for keywords.** When looking for content across files, use files__fs_search instead of reading files one by one.
5. **Scrape results path pattern.** Web scrape files land at \`notes/web/scrape/YYYY-MM-DD/domain/slug.md\`. The exact path is in the scrape tool response.
</workspace-navigation>
`.trim()
