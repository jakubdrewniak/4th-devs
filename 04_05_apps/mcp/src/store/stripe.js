import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { WORKSPACE_ROOT } from "./todos.js";

const STRIPE_DIR = join(WORKSPACE_ROOT, "stripe");
const PRODUCTS_PATH = join(STRIPE_DIR, "products.json");
const COUPONS_PATH = join(STRIPE_DIR, "coupons.json");
const SALES_PATH = join(STRIPE_DIR, "sales.json");

const readJson = async (path) => JSON.parse(await readFile(path, "utf-8"));
const writeJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");

export const readProducts = async () => readJson(PRODUCTS_PATH);
export const readCoupons = async () => readJson(COUPONS_PATH);
export const readSales = async () => readJson(SALES_PATH);

export const updateProduct = async (productId, updates) => {
  const products = await readProducts();
  const target = products.find((product) => product.id === productId);
  if (!target) {
    throw new Error(`Product not found: ${productId}`);
  }

  const allowedKeys = ["name", "description", "price", "active", "features"];
  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      target[key] = updates[key];
    }
  }

  await writeJson(PRODUCTS_PATH, products);
  return target;
};

export const createCoupon = async ({
  code,
  percentOff,
  productId = null,
  campaignId = null,
  maxRedemptions = 100,
  expiresAt = null,
}) => {
  const coupons = await readCoupons();
  const normalizedCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!normalizedCode) {
    throw new Error("Coupon code must be a non-empty alphanumeric string.");
  }

  if (coupons.some((coupon) => coupon.code === normalizedCode)) {
    throw new Error(`Coupon code already exists: ${normalizedCode}`);
  }

  if (!percentOff || percentOff < 1 || percentOff > 100) {
    throw new Error("percentOff must be between 1 and 100.");
  }

  const coupon = {
    id: `cpn_${randomUUID().slice(0, 8)}`,
    code: normalizedCode,
    percentOff,
    productId,
    campaignId,
    maxRedemptions,
    timesRedeemed: 0,
    active: true,
    expiresAt: expiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  coupons.push(coupon);
  await writeJson(COUPONS_PATH, coupons);
  return coupon;
};

export const deactivateCoupon = async (codeOrId) => {
  const coupons = await readCoupons();
  const needle = String(codeOrId).trim().toUpperCase();
  const target = coupons.find((coupon) => coupon.code === needle || coupon.id === codeOrId);
  if (!target) {
    throw new Error(`Coupon not found: ${codeOrId}`);
  }

  target.active = false;
  await writeJson(COUPONS_PATH, coupons);
  return target;
};

const formatCents = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export const summarizeProducts = async () => {
  const products = await readProducts();
  return products
    .map((product) => `${product.id}: ${product.name} — ${formatCents(product.price)}/${product.interval} (${product.active ? "active" : "inactive"})`)
    .join("\n");
};

export const summarizeCoupons = async () => {
  const coupons = await readCoupons();
  if (coupons.length === 0) {
    return "No coupons.";
  }

  return coupons
    .map((coupon) => `${coupon.code}: ${coupon.percentOff}% off${coupon.productId ? ` on ${coupon.productId}` : ""} — ${coupon.active ? "active" : "inactive"} (${coupon.timesRedeemed}/${coupon.maxRedemptions} used)`)
    .join("\n");
};

export const summarizeSales = async () => {
  const sales = await readSales();
  const totals = sales.totals;
  const starterRevenue = formatCents(totals.prod_starter.revenue);
  const growthRevenue = formatCents(totals.prod_growth.revenue);
  return `${sales.period.from} to ${sales.period.to}: Starter ${totals.prod_starter.sales} sales (${starterRevenue}), Growth ${totals.prod_growth.sales} sales (${growthRevenue}). Total: ${formatCents(totals.prod_starter.revenue + totals.prod_growth.revenue)}.`;
};

export const readSalesFiltered = async ({ from, to, productId } = {}) => {
  const sales = await readSales();
  let daily = sales.daily ?? [];

  if (from) daily = daily.filter((d) => d.date >= from);
  if (to) daily = daily.filter((d) => d.date <= to);

  const productKeys = productId
    ? [productId]
    : Object.keys(sales.totals ?? {});

  const totals = {};
  for (const key of productKeys) {
    totals[key] = { sales: 0, revenue: 0 };
    for (const day of daily) {
      const entry = day[key];
      if (!entry) continue;
      totals[key].sales += entry.sales;
      totals[key].revenue += entry.revenue;
    }
  }

  const filteredDaily = productId
    ? daily.map((d) => ({ date: d.date, [productId]: d[productId] ?? { sales: 0, revenue: 0 } }))
    : daily;

  return {
    generatedAt: sales.generatedAt,
    period: { from: from ?? sales.period.from, to: to ?? sales.period.to },
    daily: filteredDaily,
    totals,
  };
};

export const readCouponsFiltered = async ({ active, productId } = {}) => {
  let coupons = await readCoupons();
  if (typeof active === "boolean") coupons = coupons.filter((c) => c.active === active);
  if (productId) coupons = coupons.filter((c) => c.productId === productId || !c.productId);
  return coupons;
};

export const findCoupon = async (codeOrId) => {
  const coupons = await readCoupons();
  const needle = String(codeOrId).trim().toUpperCase();
  return coupons.find((c) => c.code === needle || c.id === codeOrId) ?? null;
};
