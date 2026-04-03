import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { WORKSPACE_ROOT } from "./todos.js";

const CAMPAIGNS_PATH = join(WORKSPACE_ROOT, "newsletters", "campaigns.json");

const readJson = async (path) => JSON.parse(await readFile(path, "utf-8"));

export const readCampaigns = async () => readJson(CAMPAIGNS_PATH);

export const findCampaign = async (idOrName) => {
  const campaigns = await readCampaigns();
  const needle = String(idOrName).trim().toLowerCase();
  return campaigns.find((campaign) =>
    campaign.id.toLowerCase() === needle || campaign.name.toLowerCase() === needle,
  ) ?? null;
};

const pct = (numerator, denominator) => denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "0%";
const formatCents = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

const getCampaignTimelineLabel = (campaign) => {
  if (campaign.status === "sent") {
    return formatDate(campaign.sentAt) ? `sent ${formatDate(campaign.sentAt)}` : "sent";
  }

  if (campaign.status === "scheduled") {
    return formatDate(campaign.scheduledAt)
      ? `scheduled ${formatDate(campaign.scheduledAt)}`
      : "scheduled";
  }

  return "draft";
};

export const summarizeCampaigns = async () => {
  const campaigns = await readCampaigns();
  if (campaigns.length === 0) {
    return "No campaigns sent yet.";
  }

  return campaigns.map((campaign) =>
    `${campaign.name} (${campaign.id}): ${getCampaignTimelineLabel(campaign)} — ${pct(campaign.opened, campaign.delivered)} open, ${pct(campaign.clicked, campaign.delivered)} CTR, ${campaign.conversions} conversions, ${formatCents(campaign.revenue)} revenue`,
  ).join("\n");
};

export const formatCampaignReport = (campaign) => {
  const timelineLine = campaign.status === "sent"
    ? `Sent: ${formatDate(campaign.sentAt) ?? "unknown date"} to ${campaign.audience.toLocaleString()} subscribers`
    : campaign.status === "scheduled"
      ? `Scheduled: ${formatDate(campaign.scheduledAt) ?? "unknown date"} for ${campaign.audience.toLocaleString()} subscribers`
      : `Status: Draft for ${campaign.audience.toLocaleString()} subscribers`;

  return [
    `Campaign: ${campaign.name}`,
    `Subject: ${campaign.subject}`,
    timelineLine,
    campaign.status === "sent"
      ? `Delivered: ${campaign.delivered.toLocaleString()} (${pct(campaign.delivered, campaign.audience)})`
      : null,
    campaign.status === "sent"
      ? `Opened: ${campaign.opened.toLocaleString()} (${pct(campaign.opened, campaign.delivered)})`
      : null,
    campaign.status === "sent"
      ? `Clicked: ${campaign.clicked.toLocaleString()} (${pct(campaign.clicked, campaign.delivered)})`
      : null,
    campaign.status === "sent" ? `Conversions: ${campaign.conversions}` : null,
    campaign.status === "sent" ? `Revenue: ${formatCents(campaign.revenue)}` : null,
    campaign.couponCode ? `Coupon: ${campaign.couponCode}` : null,
    campaign.summary ? `Summary: ${campaign.summary}` : null,
  ].filter(Boolean).join("\n");
};

export const compareCampaigns = async (leftIdOrName, rightIdOrName) => {
  const [left, right] = await Promise.all([
    findCampaign(leftIdOrName),
    findCampaign(rightIdOrName),
  ]);
  if (!left) throw new Error(`Campaign not found: ${leftIdOrName}`);
  if (!right) throw new Error(`Campaign not found: ${rightIdOrName}`);

  const safeRate = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;
  const delta = (a, b) => b === 0 ? 0 : ((a - b) / b * 100);
  const fmtDelta = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

  return {
    left,
    right,
    deltas: {
      openRate: fmtDelta(delta(safeRate(left.opened, left.delivered), safeRate(right.opened, right.delivered))),
      clickRate: fmtDelta(delta(safeRate(left.clicked, left.delivered), safeRate(right.clicked, right.delivered))),
      conversions: fmtDelta(delta(left.conversions, right.conversions)),
      revenue: fmtDelta(delta(left.revenue, right.revenue)),
    },
    summary: [
      `${left.name} vs ${right.name}`,
      `Open rate: ${pct(left.opened, left.delivered)} vs ${pct(right.opened, right.delivered)}`,
      `Click rate: ${pct(left.clicked, left.delivered)} vs ${pct(right.clicked, right.delivered)}`,
      `Conversions: ${left.conversions} vs ${right.conversions}`,
      `Revenue: ${formatCents(left.revenue)} vs ${formatCents(right.revenue)}`,
    ].join("\n"),
  };
};

export const readCampaignsFiltered = async ({ from, to } = {}) => {
  let campaigns = await readCampaigns();
  if (from) campaigns = campaigns.filter((c) => c.sentAt >= from);
  if (to) campaigns = campaigns.filter((c) => c.sentAt <= to);
  return campaigns;
};
