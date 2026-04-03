import { MCP_APPS_APP_MODULE_URL, TAILWIND_BROWSER_URL } from "./shared.js";

export const SALES_RESOURCE_URI = "ui://stripe/sales.html";

export const renderSalesAppHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Analytics</title>
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
    <main class="flex flex-col gap-5 max-w-5xl mx-auto">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="text-xs text-zinc-500 font-medium" id="status">Connecting...</div>
          <a href="https://dashboard.stripe.com/revenue" data-external-service="stripe" data-external-url="https://dashboard.stripe.com/revenue" class="inline-flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:underline">Open Stripe<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
        </div>
        <div class="text-xs text-zinc-500 font-medium" id="period"></div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" id="kpis"></div>

      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm">
        <h2 class="text-base font-semibold text-zinc-100 tracking-tight mb-1">Revenue over time</h2>
        <div class="mt-3 overflow-x-auto">
          <canvas id="sales-chart" height="160"></canvas>
        </div>
      </section>

      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm">
        <h2 class="text-base font-semibold text-zinc-100 tracking-tight mb-3">Per-product breakdown</h2>
        <div class="flex flex-col gap-3" id="products"></div>
      </section>
    </main>

    <script type="module">
      import { App } from "${MCP_APPS_APP_MODULE_URL}";
      const app = new App({ name: "Sales Analytics", version: "0.1.0" });
      const statusEl = document.getElementById("status");
      const periodEl = document.getElementById("period");
      const kpisEl = document.getElementById("kpis");
      const productsEl = document.getElementById("products");
      const chartCanvas = document.getElementById("sales-chart");

      const fmt = (cents) => "$" + (cents / 100).toFixed(2);

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

      const syncModelContext = async (data) => {
        const totals = data?.totals ?? {};
        const totalRevenue = Object.values(totals).reduce((s, t) => s + (t?.revenue ?? 0), 0);
        const totalSales = Object.values(totals).reduce((s, t) => s + (t?.sales ?? 0), 0);
        try {
          await app.updateModelContext({
            content: [{ type: "text", text: "Sales analytics: " + totalSales + " sales, " + fmt(totalRevenue) + " revenue for " + (data?.period?.from ?? "?") + " to " + (data?.period?.to ?? "?") + "." }],
            structuredContent: { kind: "sales", ...data },
          });
        } catch {}
      };

      const renderKpis = (totals) => {
        kpisEl.innerHTML = "";
        const totalRevenue = Object.values(totals).reduce((s, t) => s + (t?.revenue ?? 0), 0);
        const totalSales = Object.values(totals).reduce((s, t) => s + (t?.sales ?? 0), 0);

        const add = (label, value, sub) => {
          const el = document.createElement("div");
          el.className = "bg-zinc-950/60 border border-zinc-800 rounded-xl p-3";
          el.innerHTML = '<div class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">' + label + '</div>'
            + '<div class="text-lg font-semibold text-zinc-100 mt-0.5">' + value + '</div>'
            + (sub ? '<div class="text-xs text-zinc-500">' + sub + '</div>' : "");
          kpisEl.appendChild(el);
        };

        add("Total Revenue", fmt(totalRevenue), totalSales + " sales");
        for (const [id, data] of Object.entries(totals)) {
          add(id.replace("prod_", "").replace(/_/g, " "), fmt(data.revenue), data.sales + " sales");
        }
      };

      const renderProducts = (totals) => {
        productsEl.innerHTML = "";
        for (const [id, data] of Object.entries(totals)) {
          const row = document.createElement("div");
          row.className = "flex items-center justify-between gap-4 bg-zinc-950/60 border border-zinc-800 rounded-xl px-4 py-3";
          row.innerHTML = '<span class="text-sm font-semibold text-zinc-100">' + id + '</span>'
            + '<div class="flex items-center gap-4">'
            + '<span class="text-sm text-zinc-300">' + fmt(data.revenue) + '</span>'
            + '<span class="text-xs text-zinc-500">' + data.sales + ' sales</span>'
            + '</div>';
          productsEl.appendChild(row);
        }
      };

      const drawChart = (daily, totals) => {
        if (!daily?.length) return;
        const ctx = chartCanvas.getContext("2d");
        const productKeys = Object.keys(totals);
        const colors = ["#60a5fa", "#34d399", "#f59e0b", "#f87171"];
        const width = chartCanvas.parentElement.clientWidth;
        const height = 160;
        chartCanvas.width = width * 2;
        chartCanvas.height = height * 2;
        chartCanvas.style.width = width + "px";
        chartCanvas.style.height = height + "px";
        ctx.scale(2, 2);

        const allValues = daily.flatMap((d) => productKeys.map((k) => d[k]?.revenue ?? 0));
        const maxValue = Math.max(...allValues, 100);
        const pad = { top: 10, bottom: 20, left: 0, right: 0 };
        const cw = width - pad.left - pad.right;
        const ch = height - pad.top - pad.bottom;
        const step = cw / Math.max(daily.length - 1, 1);

        productKeys.forEach((key, ki) => {
          const values = daily.map((d) => d[key]?.revenue ?? 0);
          ctx.beginPath();
          ctx.strokeStyle = colors[ki % colors.length];
          ctx.lineWidth = 1.8;
          ctx.lineJoin = "round";
          values.forEach((v, i) => {
            const x = pad.left + i * step;
            const y = pad.top + ch - (v / maxValue) * ch;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();
        });

        ctx.fillStyle = "#71717a";
        ctx.font = "10px system-ui";
        ctx.textAlign = "center";
        [0, Math.floor(daily.length / 2), daily.length - 1].forEach((i) => {
          if (daily[i]) {
            ctx.fillText(daily[i].date.slice(5), pad.left + i * step, height - 4);
          }
        });
      };

      const apply = (data) => {
        if (data?.period) periodEl.textContent = data.period.from + " → " + data.period.to;
        if (data?.totals) {
          renderKpis(data.totals);
          renderProducts(data.totals);
        }
        if (data?.daily) drawChart(data.daily, data.totals ?? {});
        void syncModelContext(data);
      };

      app.ontoolresult = (result) => {
        const sc = result?.structuredContent;
        if (sc) { apply(sc); statusEl.textContent = "Synced."; }
      };
      app.ontoolinput = () => { statusEl.textContent = "Received tool input."; };
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
