export interface ProductRow {
  name: string
  revenue: number
  note: string
}

export const PRODUCT_ROWS: ProductRow[] = [
  { name: 'ProMax X1', revenue: 142_400, note: 'Referral campaign launched in late January.' },
  { name: 'NeoCore S', revenue: 98_750, note: 'Bundle offer increased conversion on returning traffic.' },
  { name: 'Drift Pad', revenue: 76_200, note: 'Seasonal demand is trending up into the next quarter.' },
  { name: 'Halo Desk', revenue: 61_850, note: 'Flat compared with the previous month.' },
]

export const SEED_PROMPT_TEMPLATES = [
  'Summarize the latest support notes and propose the next action.',
  'Show the top products from last month and explain the trend.',
  'Draft a follow-up email for the enterprise lead.',
  'Create a launch brief for the analytics workspace.',
]
