# Financial Report Guidelines

Conventions for generating enterprise financial reports as PDF.

## Report Structure (single PDF, no empty pages)

1. **Title bar**: Dark background banner with report title, subtitle (departments, currency), and dataset summary.
2. **KPI cards**: 3-4 visual metric cards in a grid (not plain text). Each card has a small label and a large compact value (e.g., "$68.7M"). Use `Intl.NumberFormat` with `notation: "compact"` for card values.
3. **Monthly trend chart**: A vertical bar chart with 12 bars. Use short month labels ("Jan", "Feb", ..., "Dec") — never raw numbers like "01". Show only the max value label above the chart area, not on every gridline.
4. **Top contributors table**: A clean table (departments, categories, or vendors). Columns: Name, Spend (exact formatted, e.g., "$10,025,756"), Share (%). Right-align numeric columns.
5. **Footer**: Small muted text with generation timestamp and data source path. Always full-width at the bottom of the last page.

## Formatting

- Use compact notation ("$68.7M") in KPI cards and chart axis labels.
- Use exact comma-separated values ("$10,025,756") in table cells.
- Month labels are always short English names: "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec".
- Percentages: one decimal place (e.g., "14.6%").

## Data Aggregation

- Sum `amount` across all valid line items for totals.
- Group by `period` (YYYY-MM) for monthly trends.
- Group by `department`, `category`, or `vendor` for top-N rankings.
- Compute share as `(group_total / grand_total * 100)`.

## Important

- Keep the report concise. Aim for 1-2 pages. Never produce empty pages.
- Every table column must be wide enough to fit its header text without truncation. If a header is long, abbreviate it or make the column wider.
