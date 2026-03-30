# Airtable

## Positioning
Airtable is positioned as a **connected apps / app-building platform**: teams use it to model operational data (tables/records) and then build workflows and lightweight apps (interfaces, automations, integrations) on top of that data.

Deployment model: cloud-based SaaS.

## Pricing
Pricing model: tiered SaaS subscription, billed per user/seat.

Plans (as shown on the official pricing page on 2026-03-02):
- **Free**: $0
- **Team**: $20 per user/month, billed annually
- **Business**: $45 per user/month, billed annually
- **Enterprise Scale**: Custom pricing

Seat model detail (from the pricing page): Airtable charges per seat for users who have **edit permissions for at least one base** in the workspace.

## Key Features
- Relational-database-style data foundation for structured workflows (tables, linked records).
- Interface building to create app-like experiences on top of bases.
- Automations to trigger actions from data changes/events.
- Integrations with external systems (examples called out include Jira, Salesforce, and Tableau).
- Web API for programmatic access to bases/records (with documented rate limits and per-plan API call limits).

## Integrations
- Airtable emphasizes integrating with external business systems (examples: Jira, Salesforce, Tableau).
- Developer ecosystem via the Airtable Web API, personal access tokens (PATs), and documentation.

## Strengths
- Strong fit for **structured operational tracking** (pipelines, inventories, content ops, lightweight CRM) where a spreadsheet is too limited but a full custom app is overkill.
- Flexible for building multiple “apps” on a shared data model (interfaces + automations).
- Mature API surface for integrating Airtable data with other systems.

## Risks
- Can get expensive at scale because pricing is tied to editor seats.
- Not a full traditional relational database: some teams hit modeling/scale constraints and need to migrate to a dedicated DB over time.
- Governance can be challenging if many teams create bases independently (schema sprawl, duplicated sources of truth).

## Best Fit
- Ops, marketing ops, product ops, and business teams who need a **database-backed system of record** with lightweight app UX.
- Teams building internal workflow tools without a dedicated engineering team.
- Organizations that want structured data + automations + integrations more than long-form documentation.

## Sources
- https://airtable.com/pricing
- https://www.airtable.com/platform/connected-apps-platform
- https://support.airtable.com/getting-started-with-airtables-web-api
- https://airtable.com/developers/web/api/introduction
- https://www.g2.com/products/airtable/reviews
