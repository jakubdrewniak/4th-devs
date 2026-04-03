import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  renderTodoAppHtml,
  TODO_RESOURCE_URI,
} from "../interfaces/todo-app.js";
import {
  renderStripeAppHtml,
  STRIPE_RESOURCE_URI,
} from "../interfaces/stripe-app.js";
import {
  renderNewsletterAppHtml,
  NEWSLETTER_RESOURCE_URI,
} from "../interfaces/newsletter-app.js";
import {
  renderSalesAppHtml,
  SALES_RESOURCE_URI,
} from "../interfaces/sales-app.js";
import {
  renderCouponAppHtml,
  COUPON_RESOURCE_URI,
} from "../interfaces/coupon-app.js";
import {
  renderCampaignDetailAppHtml,
  CAMPAIGN_DETAIL_RESOURCE_URI,
} from "../interfaces/campaign-detail-app.js";

import {
  addTodo,
  completeTodo,
  readTodosState,
  removeTodo,
  reopenTodo,
  replaceTodos,
  summarizeTodos,
} from "../store/todos.js";
import {
  createCoupon,
  deactivateCoupon,
  readCoupons,
  readCouponsFiltered,
  readProducts,
  readSales,
  readSalesFiltered,
  summarizeCoupons,
  summarizeProducts,
  summarizeSales,
  updateProduct,
} from "../store/stripe.js";
import {
  compareCampaigns,
  findCampaign,
  formatCampaignReport,
  readCampaigns,
  readCampaignsFiltered,
  summarizeCampaigns,
} from "../store/newsletters.js";

export const MARKETING_MCP_RESOURCE_META = {
  prefersBorder: true,
  csp: {
    resourceDomains: ["https://unpkg.com"],
  },
};

export const isAppOnlyTool = (tool) => {
  const visibility = tool?._meta?.ui?.visibility;
  return Array.isArray(visibility) && visibility.length === 1 && visibility[0] === "app";
};

const toTodoPayload = (state) => ({
  items: state.items,
  updatedAt: state.updatedAt,
  summary: summarizeTodos(state),
});

const todoResult = (text, state) => ({
  content: [{ type: "text", text }],
  structuredContent: toTodoPayload(state),
});

const stripeResult = async (text) => ({
  content: [{ type: "text", text }],
  structuredContent: {
    products: await readProducts(),
    coupons: await readCoupons(),
    sales: await readSales(),
  },
});

const salesResult = async (text, salesData) => ({
  content: [{ type: "text", text }],
  structuredContent: salesData,
});

const couponsResult = async (text, coupons) => ({
  content: [{ type: "text", text }],
  structuredContent: { coupons },
});

const newsletterResult = async (text) => ({
  content: [{ type: "text", text }],
  structuredContent: {
    campaigns: await readCampaigns(),
  },
});

const campaignDetailResult = (text, campaign) => ({
  content: [{ type: "text", text }],
  structuredContent: { campaign },
});

const campaignCompareResult = (text, comparison) => ({
  content: [{ type: "text", text }],
  structuredContent: comparison,
});

const registerResources = (server) => {
  registerAppResource(
    server,
    "Todo Board UI",
    TODO_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: TODO_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderTodoAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );

  registerAppResource(
    server,
    "Stripe Dashboard UI",
    STRIPE_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: STRIPE_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderStripeAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );

  registerAppResource(
    server,
    "Sales Analytics UI",
    SALES_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: SALES_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderSalesAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );

  registerAppResource(
    server,
    "Coupon Manager UI",
    COUPON_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: COUPON_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderCouponAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );

  registerAppResource(
    server,
    "Campaign Detail UI",
    CAMPAIGN_DETAIL_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: CAMPAIGN_DETAIL_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderCampaignDetailAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );

  registerAppResource(
    server,
    "Newsletter Campaigns UI",
    NEWSLETTER_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: MARKETING_MCP_RESOURCE_META },
    },
    async () => ({
      contents: [{
        uri: NEWSLETTER_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: renderNewsletterAppHtml(),
        _meta: { ui: MARKETING_MCP_RESOURCE_META },
      }],
    }),
  );
};

const registerTodoTools = (server) => {
  const appTool = (name, config, handler) => registerAppTool(
    server,
    name,
    {
      ...config,
      _meta: { ui: { resourceUri: TODO_RESOURCE_URI, ...config._meta?.ui } },
    },
    handler,
  );

  appTool(
    "open_todo_board",
    {
      title: "Open todo board",
      description: "Open the interactive todo board.",
      inputSchema: {},
    },
    async () => {
      const state = await readTodosState();
      return todoResult(`Opened todo board. ${summarizeTodos(state)}.`, state);
    },
  );

  appTool(
    "list_todos",
    {
      title: "List todos",
      description: "List current todos with ids and status.",
      inputSchema: {},
    },
    async () => {
      const state = await readTodosState();
      return todoResult(`Todos: ${summarizeTodos(state)}.`, state);
    },
  );

  appTool(
    "add_todo",
    {
      title: "Add todo",
      description: "Add a new todo item.",
      inputSchema: { text: z.string().min(1).describe("Todo text.") },
    },
    async ({ text }) => {
      const { item, state } = await addTodo(text);
      return todoResult(`Added ${item.id}: ${item.text}`, state);
    },
  );

  appTool(
    "complete_todo",
    {
      title: "Complete todo",
      description: "Mark a todo as done by id or text.",
      inputSchema: { target: z.string().min(1).describe("Todo id or text fragment.") },
    },
    async ({ target }) => {
      const { item, state } = await completeTodo(target);
      return todoResult(`Completed ${item.id}: ${item.text}`, state);
    },
  );

  appTool(
    "reopen_todo",
    {
      title: "Reopen todo",
      description: "Reopen a completed todo.",
      inputSchema: { target: z.string().min(1).describe("Todo id or text fragment.") },
    },
    async ({ target }) => {
      const { item, state } = await reopenTodo(target);
      return todoResult(`Reopened ${item.id}: ${item.text}`, state);
    },
  );

  appTool(
    "remove_todo",
    {
      title: "Remove todo",
      description: "Remove a todo by id or text.",
      inputSchema: { target: z.string().min(1).describe("Todo id or text fragment.") },
    },
    async ({ target }) => {
      const { item, state } = await removeTodo(target);
      return todoResult(`Removed ${item.id}: ${item.text}`, state);
    },
  );

  server.registerTool(
    "get_todos_state",
    {
      title: "Get todos state",
      description: "Read latest todos for the app.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => {
      const state = await readTodosState();
      return todoResult(`Loaded. ${summarizeTodos(state)}.`, state);
    },
  );

  server.registerTool(
    "save_todos_state",
    {
      title: "Save todos state",
      description: "Persist todo board state.",
      inputSchema: {
        items: z.array(z.object({
          id: z.string().optional(),
          text: z.string(),
          done: z.boolean().optional(),
        })),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ items }) => {
      const state = await replaceTodos(items);
      return todoResult(`Saved. ${summarizeTodos(state)}.`, state);
    },
  );
};

const registerStripeTools = (server) => {
  // ── Product tools → Stripe product catalog UI ──
  const productTool = (name, config, handler) => registerAppTool(
    server,
    name,
    {
      ...config,
      _meta: { ui: { resourceUri: STRIPE_RESOURCE_URI, ...config._meta?.ui } },
    },
    handler,
  );

  productTool(
    "open_stripe_dashboard",
    {
      title: "Open product catalog",
      description: "Open the product catalog with pricing and inline editing.",
      inputSchema: {},
    },
    async () => stripeResult(
      `Opened product catalog.\n${await summarizeProducts()}`,
    ),
  );

  productTool(
    "list_products",
    {
      title: "List products",
      description: "List all products with pricing.",
      inputSchema: {},
    },
    async () => stripeResult(`Products:\n${await summarizeProducts()}`),
  );

  productTool(
    "update_product",
    {
      title: "Update product",
      description: "Update a product's name, description, price, active status, or features.",
      inputSchema: {
        product_id: z.string().describe("Product ID (e.g. prod_starter)."),
        name: z.string().optional().describe("New product name."),
        description: z.string().optional().describe("New description."),
        price: z.number().optional().describe("New price in cents."),
        active: z.boolean().optional().describe("Active status."),
        features: z.array(z.string()).optional().describe("List of feature strings."),
      },
    },
    async ({ product_id, ...updates }) => {
      const product = await updateProduct(product_id, updates);
      return stripeResult(`Updated ${product.id}: ${product.name}.`);
    },
  );

  server.registerTool(
    "get_stripe_state",
    {
      title: "Get stripe state",
      description: "Read full stripe state for the product catalog app.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => stripeResult("Loaded stripe state."),
  );

  // ── Sales tools → Sales analytics UI ──
  const salesTool = (name, config, handler) => registerAppTool(
    server,
    name,
    {
      ...config,
      _meta: { ui: { resourceUri: SALES_RESOURCE_URI, ...config._meta?.ui } },
    },
    handler,
  );

  salesTool(
    "open_sales_analytics",
    {
      title: "Open sales analytics",
      description: "Open scoped sales analytics. Supports date range and product filtering.",
      inputSchema: {
        from: z.string().optional().describe("Start date (YYYY-MM-DD). Defaults to beginning of sales data."),
        to: z.string().optional().describe("End date (YYYY-MM-DD). Defaults to end of sales data."),
        product_id: z.string().optional().describe("Filter to a specific product (e.g. prod_starter, prod_growth)."),
      },
    },
    async ({ from, to, product_id }) => {
      const data = await readSalesFiltered({ from, to, productId: product_id });
      const totalRev = Object.values(data.totals).reduce((s, t) => s + t.revenue, 0);
      const totalSales = Object.values(data.totals).reduce((s, t) => s + t.sales, 0);
      const formatCents = (c) => "$" + (c / 100).toFixed(2);
      return salesResult(
        `Sales ${data.period.from} to ${data.period.to}: ${totalSales} sales, ${formatCents(totalRev)} revenue.`,
        data,
      );
    },
  );

  salesTool(
    "get_sales_report",
    {
      title: "Get sales report",
      description: "Get 30-day sales and revenue data.",
      inputSchema: {},
    },
    async () => salesResult(`Sales report:\n${await summarizeSales()}`, await readSales()),
  );

  server.registerTool(
    "get_sales_state",
    {
      title: "Get sales state",
      description: "Read sales data for the sales analytics app.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => salesResult("Loaded sales state.", await readSales()),
  );

  // ── Coupon tools → Coupon manager UI ──
  const couponTool = (name, config, handler) => registerAppTool(
    server,
    name,
    {
      ...config,
      _meta: { ui: { resourceUri: COUPON_RESOURCE_URI, ...config._meta?.ui } },
    },
    handler,
  );

  couponTool(
    "open_coupon_manager",
    {
      title: "Open coupon manager",
      description: "Open the interactive coupon manager.",
      inputSchema: {
        active: z.boolean().optional().describe("Filter by active status."),
        product_id: z.string().optional().describe("Filter to coupons for a specific product."),
      },
    },
    async ({ active, product_id }) => {
      const coupons = await readCouponsFiltered({ active, productId: product_id });
      return couponsResult(`${coupons.length} coupons.`, coupons);
    },
  );

  couponTool(
    "list_coupons",
    {
      title: "List coupons",
      description: "List all coupon codes in the coupon manager.",
      inputSchema: {},
    },
    async () => couponsResult(`Coupons:\n${await summarizeCoupons()}`, await readCoupons()),
  );

  couponTool(
    "create_coupon",
    {
      title: "Create coupon",
      description: "Create a new discount coupon. Opens the interactive coupon manager.",
      inputSchema: {
        code: z.string().describe("Coupon code (alphanumeric, auto-uppercased)."),
        percent_off: z.number().min(1).max(100).describe("Discount percentage."),
        product_id: z.string().optional().describe("Restrict to a product ID."),
        campaign_id: z.string().optional().describe("Link to a campaign ID."),
        max_redemptions: z.number().optional().describe("Max uses. Default 100."),
      },
    },
    async ({ code, percent_off, product_id, campaign_id, max_redemptions }) => {
      const coupon = await createCoupon({
        code,
        percentOff: percent_off,
        productId: product_id ?? null,
        campaignId: campaign_id ?? null,
        maxRedemptions: max_redemptions ?? 100,
      });
      const all = await readCoupons();
      return couponsResult(`Created coupon ${coupon.code}: ${coupon.percentOff}% off.`, all);
    },
  );

  couponTool(
    "deactivate_coupon",
    {
      title: "Deactivate coupon",
      description: "Deactivate a coupon by code or id.",
      inputSchema: { code: z.string().describe("Coupon code or id.") },
    },
    async ({ code }) => {
      const coupon = await deactivateCoupon(code);
      const all = await readCoupons();
      return couponsResult(`Deactivated coupon ${coupon.code}.`, all);
    },
  );

  server.registerTool(
    "get_coupons_state",
    {
      title: "Get coupons state",
      description: "Read all coupons for the coupon manager app.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => couponsResult("Loaded coupons.", await readCoupons()),
  );
};

const registerNewsletterTools = (server) => {
  const appTool = (name, config, handler) => registerAppTool(
    server,
    name,
    {
      ...config,
      _meta: { ui: { resourceUri: NEWSLETTER_RESOURCE_URI, ...config._meta?.ui } },
    },
    handler,
  );

  appTool(
    "open_newsletter_dashboard",
    {
      title: "Open newsletter dashboard",
      description: "Open the newsletter campaigns overview dashboard.",
      inputSchema: {},
    },
    async () => newsletterResult(`Campaigns:\n${await summarizeCampaigns()}`),
  );

  appTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: "List all newsletter campaigns with key metrics.",
      inputSchema: {},
    },
    async () => newsletterResult(`Campaigns:\n${await summarizeCampaigns()}`),
  );

  appTool(
    "get_campaign_report",
    {
      title: "Get campaign report",
      description: "Get detailed report for a specific campaign. Opens the focused campaign detail view.",
      inputSchema: { campaign: z.string().describe("Campaign name or id.") },
      _meta: { ui: { resourceUri: CAMPAIGN_DETAIL_RESOURCE_URI } },
    },
    async ({ campaign }) => {
      const result = await findCampaign(campaign);
      if (!result) {
        throw new Error(`Campaign not found: ${campaign}`);
      }
      return campaignDetailResult(formatCampaignReport(result), result);
    },
  );

  appTool(
    "compare_campaigns",
    {
      title: "Compare campaigns",
      description: "Compare two campaigns side by side with delta metrics.",
      inputSchema: {
        left: z.string().describe("First campaign name or id."),
        right: z.string().describe("Second campaign name or id."),
      },
    },
    async ({ left, right }) => {
      const comparison = await compareCampaigns(left, right);
      return campaignCompareResult(comparison.summary, comparison);
    },
  );

  server.registerTool(
    "get_campaigns_state",
    {
      title: "Get campaigns state",
      description: "Read all campaigns for the app.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => newsletterResult("Loaded campaigns."),
  );
};

export const createMarketingMcpServer = ({
  name = "04_05_apps_mcp",
  version = "0.1.0",
  description = "Marketing ops workspace with todo, Stripe, and newsletter tools.",
} = {}) => {
  const server = new McpServer({
    name,
    version,
    description,
  });

  registerResources(server);
  registerTodoTools(server);
  registerStripeTools(server);
  registerNewsletterTools(server);

  return server;
};
