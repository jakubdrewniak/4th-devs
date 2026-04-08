import { PRODUCT_ROWS } from './products'

export const previewChart = `## Top 3 Products — Feb 2026

| Product | Revenue |
| --- | ---: |
| ProMax X1 | $142,400 |
| NeoCore S | $98,750 |
| Drift Pad | $76,200 |

_Rendered by the mock chart tool. Replace this with a richer artifact renderer later._`

export const previewLaunchBrief = `## Launch Brief

### Scope
- Refine the streaming chat layout for long histories
- Keep tool results visible as first-class cards
- Preserve room for future artifact previews

### Notes
- Use virtualization for message history
- Materialize raw events into stable UI blocks
- Keep streaming transport independent from rendering`

export const previewEmail = `# Follow-up Email

Subject: Next steps after the workspace review

Hi there,

Thanks again for the walkthrough. Based on the review, I suggest that we focus next on:

- Aligning the rollout checklist for the analytics workspace
- Turning the top objections into short enablement notes
- Scheduling a quick follow-up once the preview environment is live

Best,
Alice`

export const salesSummaryMarkdown = `## What stands out

1. **${PRODUCT_ROWS[0]!.name}** leads at **$${PRODUCT_ROWS[0]!.revenue.toLocaleString()}**.
2. **${PRODUCT_ROWS[1]!.name}** stays steady, helped by its bundle positioning.
3. **${PRODUCT_ROWS[2]!.name}** is climbing into a seasonal peak.

### Likely drivers

- ${PRODUCT_ROWS[0]!.note}
- ${PRODUCT_ROWS[1]!.note}
- ${PRODUCT_ROWS[2]!.note}
`
