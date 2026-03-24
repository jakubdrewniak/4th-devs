# PDFKit Layout Guide

Critical rules for generating clean PDFs with `npm:pdfkit`. Violating these rules produces broken reports with blank pages.

## Deno Imports

Use `npm:` prefix ONLY for third-party packages. For Node built-ins use `node:` prefix:
```typescript
import PDFDocument from "npm:pdfkit";     // ✅ third-party
import path from "node:path";              // ✅ Node built-in
import { join, dirname } from "node:path"; // ✅ named exports
```
NEVER use `import { dirname } from "npm:path"` — this will fail with `does not provide an export named 'dirname'`.

## Cursor Management

PDFKit has an auto-advancing cursor (`doc.x`, `doc.y`). Every `doc.text()` call moves it.

- Use the 3-arg form for positioned elements: `doc.text(str, x, y, { width })`
- **CRITICAL**: After drawing any block that uses explicit x positions (cards, charts, tables), reset **both** cursors:
  ```typescript
  doc.x = doc.page.margins.left;
  doc.y = blockBottom + gap;
  ```
  If you only reset `doc.y`, subsequent `doc.text(str)` calls without explicit x/y will render in a narrow column on the right side of the page because `doc.x` is still stuck at the last explicit position.

## Page Breaks — NO EMPTY PAGES

The final PDF must **NEVER** contain blank or near-blank pages. Every page must have substantial content.

### Where to call `doc.addPage()`

Only call `addPage()` **immediately before** drawing the next content block, inside that block's own guard:
```typescript
if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
```

### NEVER do this

- NEVER call `doc.addPage()` at the **end** of a helper function or after finishing a section. The caller decides if a new page is needed for the next section, not the current one.
- NEVER write `if (doc.y > bottom) doc.addPage();` as cleanup at the end of a table/chart helper. This creates blank trailing pages.
- NEVER call `doc.moveDown()` or `doc.addPage()` after the last content block. Call `doc.end()` immediately.

### `doc.moveDown()` limits

Keep values small (0.2–0.8). NEVER use values > 1.5. Large gaps push the cursor past the page bottom, triggering automatic page breaks that create blank pages.

## Page Numbers

Do NOT add page numbers. Skip them entirely. A clean report without page numbers is far better than one with blank pages or "Page undefined".

Specifically, NEVER use any of these patterns:
- `doc.on("pageAdded", ...)` — causes blank pages, undefined page numbers, and broken layouts
- `bufferPages: true` in the PDFDocument constructor
- `doc.switchToPage(i)` — writing to earlier pages can trigger overflow and create phantom pages

## Header

Render the title header ONLY on page 1. Do not repeat it on subsequent pages.

## Footer / Notes

- Render the footer (source/timestamp) on the **same page** as the last content.
- If it doesn't fit, shrink it or skip it. NEVER let a footer be the only content on a page.
- Do NOT call `doc.moveDown()` after the footer. Call `doc.end()` immediately.
- Use small font (8pt), muted gray color, full page width.

## KPI Cards

- Layout as a row of 3–4 cards. Card width: `(usableWidth - (n-1) * gap) / n`.
- Draw each card's background with `doc.roundedRect(x, y, w, h, r).fill(bgColor)`.
- Place label text (small font, muted color) and value text (large font, bold) at explicit coordinates inside the card.
- After drawing all cards: `doc.x = doc.page.margins.left; doc.y = cardsY + cardHeight + sectionGap;`

## Vertical Bar Chart

- Calculate total chart height **upfront**: `titleHeight + chartHeight + labelHeight`.
- Ensure the full chart fits on one page before drawing.
- Bar width: `(chartWidth - (numBars - 1) * barGap) / numBars`
- Bar height: `(value / maxValue) * maxBarPixelHeight`
- Bar Y position: `chartBottom - barHeight` (bars grow upward from the baseline).
- Draw all bars in a single loop using `doc.rect(x, y, barW, barH).fill(color)`. Use `doc.save()` / `doc.restore()` around each fill to prevent color bleed.
- Place month labels directly below each bar: `doc.text(label, barX, chartBottom + 4, { width: barW, align: "center" })`.
- At most one max-value label above the chart. No horizontal gridlines across bars.
- After the chart: `doc.x = doc.page.margins.left; doc.y = chartBottom + labelHeight + sectionGap;`

## Tables

- Compute column widths BEFORE drawing. Every header must fit without truncation.
- Draw header row: colored background rect, bold text.
- Data rows: alternate `#FFFFFF` / `#F9FAFB` backgrounds.
- Right-align numeric columns (spend, percentages).
- Before each row, check page overflow. If `rowY + rowHeight > pageBottom`, call `doc.addPage()` and redraw the header.
- After the table: `doc.x = doc.page.margins.left; doc.y = lastRowY + rowHeight + sectionGap;`
- **Do NOT add a page-overflow guard after setting `doc.y`**. Let the next section's own guard handle it.
