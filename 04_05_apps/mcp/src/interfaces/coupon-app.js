import { MCP_APPS_APP_MODULE_URL, TAILWIND_BROWSER_URL } from "./shared.js";

export const COUPON_RESOURCE_URI = "ui://stripe/coupons.html";

export const renderCouponAppHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Coupon Manager</title>
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
        <div class="text-xs text-zinc-500 font-medium" id="status">Connecting...</div>
        <div class="flex items-center gap-3 text-xs" id="summary-bar"></div>
      </div>

      <!-- Create form -->
      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm" id="create-section">
        <h2 class="text-sm font-semibold text-zinc-100 tracking-tight mb-4">Create coupon</h2>
        <form id="create-form" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Code</label>
            <input id="f-code" type="text" placeholder="SAVE20" class="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 font-mono" required />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">% Off</label>
            <input id="f-pct" type="number" min="1" max="100" placeholder="20" class="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600" required />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Product (optional)</label>
            <select id="f-product" class="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600">
              <option value="">All products</option>
              <option value="prod_starter">Starter</option>
              <option value="prod_growth">Growth</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Max uses</label>
            <div class="flex gap-2">
              <input id="f-max" type="number" min="1" value="100" class="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600" />
              <button type="submit" id="create-btn" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0">Create</button>
            </div>
          </div>
        </form>
        <div id="create-error" class="text-xs text-red-400 mt-2 hidden"></div>
      </section>

      <!-- Coupon list -->
      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-zinc-100 tracking-tight">All coupons</h2>
          <a href="https://dashboard.stripe.com/coupons" data-external-service="stripe" data-external-url="https://dashboard.stripe.com/coupons" class="inline-flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:underline">View all in Stripe<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
        </div>
        <div class="flex flex-col gap-2" id="coupon-list"></div>
      </section>
    </main>

    <script type="module">
      import { App } from "${MCP_APPS_APP_MODULE_URL}";
      const app = new App({ name: "Coupon Manager", version: "0.1.0" });
      const statusEl = document.getElementById("status");
      const summaryBar = document.getElementById("summary-bar");
      const couponList = document.getElementById("coupon-list");
      const form = document.getElementById("create-form");
      const createBtn = document.getElementById("create-btn");
      const createError = document.getElementById("create-error");

      let busy = false;
      const setBusy = (v) => { busy = v; createBtn.disabled = v; };

      const escapeAttr = (value) => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

      const extLink = (service, path, label) => {
        const urls = {
          stripe: "https://dashboard.stripe.com" + path,
          resend: "https://resend.com" + path,
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

      const syncModelContext = async (coupons) => {
        const safe = Array.isArray(coupons) ? coupons : [];
        const active = safe.filter((c) => c.active).length;
        try {
          await app.updateModelContext({
            content: [{ type: "text", text: "Coupon manager: " + safe.length + " coupons (" + active + " active)." }],
            structuredContent: { kind: "coupons", coupons: safe },
          });
        } catch {}
      };

      const renderSummary = (coupons) => {
        const active = coupons.filter((c) => c.active).length;
        const inactive = coupons.length - active;
        const redeemed = coupons.reduce((s, c) => s + c.timesRedeemed, 0);
        summaryBar.innerHTML =
          '<span class="text-emerald-400 font-medium">' + active + ' active</span>'
          + '<span class="text-zinc-600">•</span>'
          + '<span class="text-zinc-500">' + inactive + ' inactive</span>'
          + '<span class="text-zinc-600">•</span>'
          + '<span class="text-zinc-400">' + redeemed + ' total redemptions</span>';
      };

      const renderCoupons = (coupons) => {
        couponList.innerHTML = "";
        if (!coupons?.length) { couponList.innerHTML = '<div class="text-sm text-zinc-500 py-4 text-center">No coupons yet. Create one above.</div>'; return; }

        coupons.forEach((coupon) => {
          const row = document.createElement("div");
          row.className = "flex flex-wrap items-center justify-between gap-3 bg-zinc-950/60 border border-zinc-800 rounded-xl px-4 py-3 transition-colors hover:border-zinc-700";

          const expires = coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString() : "—";
          const campaign = coupon.campaignId
            ? '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/40 text-amber-400 border border-amber-900/50">' + coupon.campaignId + '</span>'
            : "";

          const left = document.createElement("div");
          left.className = "flex items-center gap-3 flex-wrap";
          left.innerHTML =
            '<span class="font-mono text-sm font-semibold text-emerald-400">' + coupon.code + '</span>'
            + '<span class="text-xs text-zinc-400">' + coupon.percentOff + '% off</span>'
            + (coupon.productId ? '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-950/40 text-blue-400 border border-blue-900/50">' + coupon.productId + '</span>' : "")
            + campaign;

          const right = document.createElement("div");
          right.className = "flex items-center gap-3 shrink-0";
          right.innerHTML =
            '<span class="text-xs text-zinc-500">' + coupon.timesRedeemed + '/' + coupon.maxRedemptions + '</span>'
            + '<span class="text-xs text-zinc-600">exp ' + expires + '</span>';

          const stripeLink = document.createElement("span");
          stripeLink.innerHTML = extLink("stripe", "/coupons/" + coupon.id, "Stripe");
          right.appendChild(stripeLink);

          const badge = document.createElement("span");
          badge.className = "text-[10px] font-medium px-2 py-0.5 rounded-full "
            + (coupon.active
              ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/50"
              : "bg-zinc-800 text-zinc-500 border border-zinc-700");
          badge.textContent = coupon.active ? "Active" : "Inactive";
          right.appendChild(badge);

          if (coupon.active) {
            const deactivateBtn = document.createElement("button");
            deactivateBtn.type = "button";
            deactivateBtn.className = "text-[10px] font-medium px-2.5 py-1 rounded-lg border border-red-900/50 bg-red-950/30 text-red-400 hover:bg-red-950/50 hover:text-red-300 transition-colors";
            deactivateBtn.textContent = "Deactivate";
            deactivateBtn.addEventListener("click", async () => {
              if (busy) return;
              setBusy(true);
              statusEl.textContent = "Deactivating " + coupon.code + "...";
              try {
                const result = await app.callServerTool({ name: "deactivate_coupon", arguments: { code: coupon.code } });
                if (!result.isError && result.structuredContent?.coupons) apply(result.structuredContent);
                statusEl.textContent = "Deactivated " + coupon.code + ".";
              } catch (e) { statusEl.textContent = e.message || String(e); }
              finally { setBusy(false); }
            });
            right.appendChild(deactivateBtn);
          }

          row.append(left, right);
          couponList.appendChild(row);
        });
      };

      const apply = (data) => {
        const coupons = Array.isArray(data?.coupons) ? data.coupons : (Array.isArray(data) ? data : []);
        renderCoupons(coupons);
        renderSummary(coupons);
        void syncModelContext(coupons);
      };

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busy) return;
        createError.classList.add("hidden");
        setBusy(true);
        statusEl.textContent = "Creating coupon...";
        try {
          const args = {
            code: document.getElementById("f-code").value.trim(),
            percent_off: Number(document.getElementById("f-pct").value),
            max_redemptions: Number(document.getElementById("f-max").value) || 100,
          };
          const productId = document.getElementById("f-product").value;
          if (productId) args.product_id = productId;

          const result = await app.callServerTool({ name: "create_coupon", arguments: args });
          if (result.isError) throw new Error("Failed to create coupon.");
          if (result.structuredContent?.coupons) apply(result.structuredContent);
          statusEl.textContent = "Coupon created.";
          form.reset();
          document.getElementById("f-max").value = "100";
        } catch (e) {
          createError.textContent = e.message || String(e);
          createError.classList.remove("hidden");
          statusEl.textContent = "Error creating coupon.";
        } finally { setBusy(false); }
      });

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
