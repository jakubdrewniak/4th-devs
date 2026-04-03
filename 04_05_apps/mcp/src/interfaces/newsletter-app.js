import { MCP_APPS_APP_MODULE_URL, TAILWIND_BROWSER_URL } from "./shared.js";

export const NEWSLETTER_RESOURCE_URI = "ui://newsletters/campaigns.html";

export const renderNewsletterAppHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter Dashboard</title>
    <script src="${TAILWIND_BROWSER_URL}"></script>
    <style type="text/tailwindcss">
      @theme {
        --font-sans: "Inter", system-ui, -apple-system, sans-serif;
        --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
      }
      body { background-color: transparent; color: #e4e4e4; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 999px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
    </style>
  </head>
  <body class="p-5 font-sans antialiased">
    <main class="flex flex-col gap-5 max-w-4xl mx-auto">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="text-xs text-zinc-500 font-medium" id="status">Connecting...</div>
          <a href="https://resend.com/emails" data-external-service="resend" data-external-url="https://resend.com/emails" class="inline-flex items-center gap-1 text-[10px] font-medium text-sky-400 hover:underline">Open Resend<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
        </div>
        <div class="text-xs text-zinc-400" id="summary"></div>
      </div>
      <div class="flex flex-col gap-4" id="campaigns"></div>
    </main>

    <script type="module">
      import { App } from "${MCP_APPS_APP_MODULE_URL}";
      const app = new App({ name: "Newsletter Dashboard", version: "0.1.0" });
      const statusEl = document.getElementById("status");
      const summaryEl = document.getElementById("summary");
      const campaignsEl = document.getElementById("campaigns");

      const fmt = (cents) => "$" + (cents / 100).toFixed(2);
      const pct = (n, d) => d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "0%";
      const formatDate = (value) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
      };
      const getCampaignAudienceLabel = (campaign) => {
        if (campaign.status === "sent") {
          return "Sent " + (formatDate(campaign.sentAt) ?? "unknown date") + " to " + campaign.audience.toLocaleString() + " subscribers";
        }

        if (campaign.status === "scheduled") {
          return "Scheduled " + (formatDate(campaign.scheduledAt) ?? "unknown date") + " for " + campaign.audience.toLocaleString() + " subscribers";
        }

        return "Draft for " + campaign.audience.toLocaleString() + " subscribers";
      };
      const getSalesWindow = (campaign) => {
        const sentDate = new Date(campaign.sentAt);
        if (campaign.status !== "sent" || Number.isNaN(sentDate.getTime())) {
          return null;
        }

        return {
          from: new Date(sentDate.getTime() - 2 * 86400000).toISOString().slice(0, 10),
          to: new Date(sentDate.getTime() + 14 * 86400000).toISOString().slice(0, 10),
        };
      };

      let expandedId = null;

      const escapeAttr = (value) => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

      const extLink = (service, path, label) => {
        const urls = {
          stripe: "https://dashboard.stripe.com" + path,
          resend: "https://resend.com/emails" + path,
          linear: "https://linear.app" + path,
        };
        const colors = { stripe: "text-violet-400", resend: "text-sky-400", linear: "text-indigo-400" };
        const url = urls[service];
        return '<a href="' + escapeAttr(url) + '" data-external-service="' + escapeAttr(service) + '" data-external-url="' + escapeAttr(url) + '" class="inline-flex items-center gap-1 text-[10px] font-medium ' + (colors[service] || "text-zinc-400") + ' hover:underline">'
          + '<span>' + label + '</span>'
          + '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>'
          + '</a>';
      };

      const openExternalLink = async (link) => {
        const url = link?.dataset?.externalUrl;
        if (!url) return;
        const service = link.dataset.externalService || "external link";

        try {
          const result = await app.openLink({ url });
          if (result?.isError) {
            statusEl.textContent = "The host blocked opening " + service + ".";
          }
        } catch (error) {
          statusEl.textContent = error instanceof Error ? error.message : "Couldn't open " + service + ".";
        }
      };

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const link = target.closest("a[data-external-url]");
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        void openExternalLink(link);
      });

      const syncModelContext = async (campaigns) => {
        const safe = Array.isArray(campaigns) ? campaigns : [];
        const totalRevenue = safe.reduce((sum, c) => sum + (c?.revenue ?? 0), 0);
        try {
          await app.updateModelContext({
            content: [{ type: "text", text: "Newsletter dashboard: " + safe.length + " campaigns, " + fmt(totalRevenue) + " total revenue." }],
            structuredContent: { kind: "newsletters", campaigns: safe },
          });
        } catch {}
      };

      const syncComparisonContext = async (comparison) => {
        if (!comparison?.left || !comparison?.right) return;

        try {
          await app.updateModelContext({
            content: [{
              type: "text",
              text: "Comparing " + comparison.left.name + " vs " + comparison.right.name + ".",
            }],
            structuredContent: { kind: "campaign-comparison", ...comparison },
          });
        } catch {}
      };

      const renderCampaigns = (campaigns) => {
        campaignsEl.innerHTML = "";
        if (!campaigns?.length) { campaignsEl.innerHTML = '<div class="text-sm text-zinc-500 py-4 text-center">No campaigns.</div>'; return; }

        const sent = campaigns.filter((c) => c.status === "sent");
        const upcoming = campaigns.filter((c) => c.status !== "sent");
        const totalRevenue = sent.reduce((s, c) => s + (c.revenue ?? 0), 0);
        const totalConversions = sent.reduce((s, c) => s + (c.conversions ?? 0), 0);
        summaryEl.textContent = sent.length + " sent • " + upcoming.length + " upcoming • " + totalConversions + " conversions • " + fmt(totalRevenue) + " revenue";

        campaigns.forEach((campaign) => {
          const isSent = campaign.status === "sent";
          const isDraft = campaign.status === "draft";
          const isScheduled = campaign.status === "scheduled";

          const statusBadge = isDraft
            ? '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">Draft</span>'
            : isScheduled
            ? '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-950/40 text-blue-400 border border-blue-900/50">Scheduled</span>'
            : '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-900/50">Sent</span>';

          const dateLabel = isSent
            ? "Sent " + new Date(campaign.sentAt).toLocaleDateString()
            : isScheduled
            ? "Scheduled " + new Date(campaign.scheduledAt).toLocaleDateString()
            : "Draft";

          const revenueLabel = isSent
            ? '<span class="text-zinc-600">•</span><span class="text-emerald-400 font-medium">' + fmt(campaign.revenue) + '</span>'
            : "";

          const card = document.createElement("section");
          card.className = "bg-zinc-900/60 border border-zinc-800/80 rounded-2xl shadow-sm overflow-hidden transition-colors hover:border-zinc-700 cursor-pointer"
            + (isDraft ? " border-dashed" : "");

          const header = document.createElement("div");
          header.className = "flex items-start justify-between gap-4 p-5";
          header.innerHTML = '<div class="flex-1">'
            + '<div class="flex items-center gap-2"><span class="text-sm font-semibold text-zinc-100">' + campaign.name + '</span>' + statusBadge + '</div>'
            + '<div class="text-xs text-zinc-500 mt-0.5">' + campaign.subject + '</div>'
            + '<div class="flex items-center gap-3 mt-2 text-xs text-zinc-400">'
            + '<span>' + dateLabel + '</span>'
            + '<span class="text-zinc-600">•</span>'
            + '<span>' + campaign.audience.toLocaleString() + ' subscribers</span>'
            + revenueLabel
            + '<span class="text-zinc-600">•</span>'
            + extLink("resend", "/" + campaign.id, "Resend")
            + '</div>'
            + '</div>'
            + '<div class="flex items-center gap-2 shrink-0">'
            + (campaign.couponCode ? '<span class="font-mono text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2 py-0.5 rounded-lg">' + campaign.couponCode + '</span>' : "")
            + (isSent ? '<svg class="w-4 h-4 text-zinc-500 transition-transform' + (expandedId === campaign.id ? ' rotate-180' : '') + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>' : "")
            + '</div>';
          card.appendChild(header);

          const detail = document.createElement("div");
          detail.id = "detail-" + campaign.id;

          if (isSent) {
            detail.style.display = expandedId === campaign.id ? "block" : "none";
            detail.innerHTML = '<div class="border-t border-zinc-800/60 px-5 pb-5 pt-4">'
              + '<div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">'
              + metricHtml("Delivered", pct(campaign.delivered, campaign.audience), campaign.delivered.toLocaleString())
              + metricHtml("Opened", pct(campaign.opened, campaign.delivered), campaign.opened.toLocaleString())
              + metricHtml("Clicked", pct(campaign.clicked, campaign.delivered), campaign.clicked.toLocaleString())
              + metricHtml("Conversions", String(campaign.conversions), pct(campaign.conversions, campaign.clicked) + " of clicks")
              + metricHtml("Revenue", fmt(campaign.revenue), "attributed")
              + '</div>'
              + (campaign.productHighlight ? '<div class="text-xs text-blue-400/80 mb-2">Product highlight: ' + campaign.productHighlight + '</div>' : "")
              + (campaign.summary ? '<p class="text-xs text-zinc-400 leading-relaxed mb-4">' + campaign.summary + '</p>' : "")
              + '<div class="flex flex-wrap gap-2">'
              + '<button data-action="todo" data-campaign="' + campaign.name + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">+ Add follow-up todo</button>'
              + '<button data-action="compare" data-campaign="' + campaign.id + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Compare with...</button>'
              + (campaign.couponCode ? "" : '<button data-action="coupon" data-campaign="' + campaign.id + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 hover:bg-emerald-900/30 text-emerald-400 transition-colors">Create coupon</button>')
              + '</div>'
              + '</div>';
          } else {
            detail.style.display = expandedId === campaign.id ? "block" : "none";
            const actions = isDraft
              ? '<button data-action="todo" data-campaign="' + campaign.name + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">+ Add todo to finalize</button>'
              : '<button data-action="todo" data-campaign="' + campaign.name + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">+ Add pre-send todo</button>';
            detail.innerHTML = '<div class="border-t border-zinc-800/60 px-5 pb-5 pt-4">'
              + '<div class="text-xs text-zinc-400 leading-relaxed mb-3">'
              + (isDraft ? 'This campaign is still a draft. ' : 'Scheduled to send to ' + campaign.audience.toLocaleString() + ' subscribers. ')
              + (campaign.productHighlight ? 'Product highlight: ' + campaign.productHighlight + '. ' : "")
              + (campaign.couponCode ? 'Uses coupon: ' + campaign.couponCode + '.' : "")
              + '</div>'
              + '<div class="flex flex-wrap gap-2">'
              + actions
              + (campaign.couponCode ? "" : '<button data-action="coupon" data-campaign="' + campaign.id + '" class="action-btn text-[10px] font-medium px-3 py-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 hover:bg-emerald-900/30 text-emerald-400 transition-colors">Create coupon</button>')
              + '</div></div>';
          }
          card.appendChild(detail);

          header.addEventListener("click", () => {
            const wasExpanded = expandedId === campaign.id;
            expandedId = wasExpanded ? null : campaign.id;
            renderCampaigns(campaigns);
          });

          card.addEventListener("click", (e) => {
            const btn = e.target.closest(".action-btn");
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            const doAction = async () => {
              const prev = btn.textContent;
              btn.disabled = true;
              btn.textContent = "Working...";
              try {
                if (action === "todo") {
                  await app.callServerTool({ name: "add_todo", arguments: { text: "Review " + btn.dataset.campaign + " campaign results and plan next steps" } });
                  btn.textContent = "Added!";
                } else if (action === "compare") {
                  const others = campaigns.filter((c) => c.id !== btn.dataset.campaign);
                  if (others.length > 0) {
                    await app.callServerTool({ name: "compare_campaigns", arguments: { left: campaign.name, right: others[0].name } });
                    btn.textContent = "Compared!";
                  }
                } else if (action === "coupon") {
                  await app.callServerTool({ name: "open_coupon_manager", arguments: {} });
                  btn.textContent = "Opened!";
                }
              } catch (err) {
                btn.textContent = "Error";
                statusEl.textContent = err.message || String(err);
              }
              setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
            };
            void doAction();
          });

          campaignsEl.appendChild(card);
        });
      };

      const metricHtml = (label, value, sub) =>
        '<div class="bg-zinc-950/60 border border-zinc-800 rounded-xl p-3">'
        + '<div class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">' + label + '</div>'
        + '<div class="text-lg font-semibold text-zinc-100 mt-0.5">' + value + '</div>'
        + (sub ? '<div class="text-xs text-zinc-500">' + sub + '</div>' : "")
        + '</div>';

      const renderCampaignDetail = (campaign) => {
        campaignsEl.innerHTML = "";
        const card = document.createElement("section");
        card.className = "bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm flex flex-col gap-5";

        card.innerHTML =
          '<div class="flex items-start justify-between gap-4">'
          + '<div>'
          + '<div class="text-lg font-semibold text-zinc-100">' + campaign.name + '</div>'
          + '<div class="text-sm text-zinc-400 mt-0.5">' + campaign.subject + '</div>'
          + '<div class="flex items-center gap-3 mt-1 text-xs text-zinc-500">'
          + '<span>' + getCampaignAudienceLabel(campaign) + '</span>'
          + extLink("resend", "/" + campaign.id, "Open in Resend")
          + '</div></div>'
          + '<div class="flex flex-col items-end gap-1.5 shrink-0">'
          + (campaign.couponCode ? '<span class="font-mono text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2.5 py-1 rounded-lg">' + campaign.couponCode + '</span>' : "")
          + '</div></div>'
          + '<div class="grid grid-cols-2 sm:grid-cols-5 gap-3">'
          + metricHtml("Delivered", pct(campaign.delivered, campaign.audience), campaign.delivered.toLocaleString())
          + metricHtml("Opened", pct(campaign.opened, campaign.delivered), campaign.opened.toLocaleString())
          + metricHtml("Clicked", pct(campaign.clicked, campaign.delivered), campaign.clicked.toLocaleString())
          + metricHtml("Conversions", String(campaign.conversions), pct(campaign.conversions, campaign.clicked) + " of clicks")
          + metricHtml("Revenue", fmt(campaign.revenue), "attributed")
          + '</div>'
          + (campaign.productHighlight ? '<div class="text-xs text-blue-400/80">Product highlight: ' + campaign.productHighlight + '</div>' : "")
          + (campaign.summary ? '<p class="text-sm text-zinc-400 leading-relaxed">' + campaign.summary + '</p>' : "")
          + '<div class="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-4">'
          + '<button data-action="todo" data-campaign="' + campaign.name + '" class="action-btn text-xs font-medium px-3.5 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">+ Add follow-up todo</button>'
          + (campaign.couponCode ? "" : '<button data-action="coupon" data-campaign="' + campaign.id + '" class="action-btn text-xs font-medium px-3.5 py-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 hover:bg-emerald-900/30 text-emerald-400 transition-colors">Create coupon</button>')
          + (campaign.status === "sent" ? '<button data-action="sales" class="action-btn text-xs font-medium px-3.5 py-2 rounded-lg border border-blue-900/50 bg-blue-950/30 hover:bg-blue-900/30 text-blue-400 transition-colors">View sales around send date</button>' : "")
          + '<button data-action="back" class="action-btn text-xs font-medium px-3.5 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Back to all campaigns</button>'
          + '</div>';

        card.addEventListener("click", (e) => {
          const btn = e.target.closest(".action-btn");
          if (!btn) return;
          const action = btn.dataset.action;
          const doAction = async () => {
            const prev = btn.textContent;
            btn.disabled = true;
            btn.textContent = "Working...";
            try {
              if (action === "todo") {
                await app.callServerTool({ name: "add_todo", arguments: { text: "Review " + campaign.name + " results and plan next steps" } });
                btn.textContent = "Added!";
              } else if (action === "coupon") {
                await app.callServerTool({ name: "open_coupon_manager", arguments: {} });
                btn.textContent = "Opened!";
              } else if (action === "sales") {
                const salesWindow = getSalesWindow(campaign);
                if (!salesWindow) {
                  throw new Error("Sales context is only available for sent campaigns.");
                }
                await app.callServerTool({ name: "open_sales_analytics", arguments: salesWindow });
                btn.textContent = "Opened!";
              } else if (action === "back") {
                const result = await app.callServerTool({ name: "get_campaigns_state", arguments: {} });
                if (result.structuredContent?.campaigns) {
                  renderCampaigns(result.structuredContent.campaigns);
                  statusEl.textContent = "Ready — click a campaign to expand.";
                }
                return;
              }
            } catch (err) { btn.textContent = "Error"; }
            setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
          };
          void doAction();
        });

        campaignsEl.appendChild(card);
        summaryEl.textContent = campaign.name;
      };

      const renderComparison = (data) => {
        campaignsEl.innerHTML = "";
        const { left, right, deltas } = data;
        if (!left || !right) { campaignsEl.textContent = "Missing comparison data."; return; }

        const wrapper = document.createElement("section");
        wrapper.className = "bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm flex flex-col gap-4";

        const table = document.createElement("div");
        table.className = "grid grid-cols-4 gap-px text-xs";
        table.innerHTML =
          '<div class="text-zinc-600 py-2 font-medium">Metric</div>'
          + '<div class="text-zinc-600 py-2 font-medium text-right">' + left.name + '</div>'
          + '<div class="text-zinc-600 py-2 font-medium text-right">' + right.name + '</div>'
          + '<div class="text-zinc-600 py-2 font-medium text-right">Delta</div>';

        const addRow = (label, lVal, rVal, delta) => {
          const cls = delta?.startsWith("+") ? "text-emerald-400" : delta?.startsWith("-") ? "text-red-400" : "text-zinc-500";
          table.innerHTML +=
            '<div class="text-zinc-400 py-2.5 border-t border-zinc-800/60">' + label + '</div>'
            + '<div class="text-zinc-200 py-2.5 border-t border-zinc-800/60 text-right font-medium">' + lVal + '</div>'
            + '<div class="text-zinc-200 py-2.5 border-t border-zinc-800/60 text-right font-medium">' + rVal + '</div>'
            + '<div class="py-2.5 border-t border-zinc-800/60 text-right font-semibold ' + cls + '">' + (delta ?? "—") + '</div>';
        };

        addRow("Open rate", pct(left.opened, left.delivered), pct(right.opened, right.delivered), deltas.openRate);
        addRow("Click rate", pct(left.clicked, left.delivered), pct(right.clicked, right.delivered), deltas.clickRate);
        addRow("Conversions", String(left.conversions), String(right.conversions), deltas.conversions);
        addRow("Revenue", fmt(left.revenue), fmt(right.revenue), deltas.revenue);
        addRow("Audience", left.audience.toLocaleString(), right.audience.toLocaleString(), null);

        wrapper.innerHTML = '<div class="text-base font-semibold text-zinc-100">' + left.name + ' vs ' + right.name + '</div>';
        wrapper.appendChild(table);
        campaignsEl.appendChild(wrapper);
        summaryEl.textContent = left.name + " vs " + right.name;
        void syncComparisonContext(data);
      };

      app.ontoolresult = (result) => {
        const sc = result?.structuredContent;
        if (!sc) return;
        if (sc.left && sc.right && sc.deltas) {
          renderComparison(sc);
          statusEl.textContent = "Comparison ready.";
        } else if (sc.campaign) {
          renderCampaignDetail(sc.campaign);
          statusEl.textContent = "Campaign detail ready.";
        } else if (sc.campaigns) {
          renderCampaigns(sc.campaigns);
          statusEl.textContent = "Synced.";
          void syncModelContext(sc.campaigns);
        }
      };
      app.ontoolinput = () => { statusEl.textContent = "Loading..."; };
      app.ontoolcancelled = () => { statusEl.textContent = "Cancelled."; };
      app.onteardown = async () => ({});

      const boot = async () => {
        try {
          await app.connect();
          statusEl.textContent = "Connected — waiting for initial tool result.";
        } catch (error) { statusEl.textContent = error.message || String(error); }
      };
      void boot();
    </script>
  </body>
</html>`;
