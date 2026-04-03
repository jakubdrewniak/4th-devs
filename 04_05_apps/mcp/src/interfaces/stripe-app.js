import { MCP_APPS_APP_MODULE_URL, TAILWIND_BROWSER_URL } from "./shared.js";

export const STRIPE_RESOURCE_URI = "ui://stripe/dashboard.html";

export const renderStripeAppHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Product Catalog</title>
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
      </div>
      <section class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold text-zinc-100 tracking-tight">Products</h2>
          <a href="https://dashboard.stripe.com/products" data-external-service="stripe" data-external-url="https://dashboard.stripe.com/products" class="inline-flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:underline">View all in Stripe<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
        </div>
        <div class="flex flex-col gap-3" id="products"></div>
      </section>
    </main>

    <script type="module">
      import { App } from "${MCP_APPS_APP_MODULE_URL}";
      const app = new App({ name: "Product Catalog", version: "0.1.0" });
      const statusEl = document.getElementById("status");
      const productsEl = document.getElementById("products");

      const fmt = (cents) => "$" + (cents / 100).toFixed(2);
      let editingId = null;
      let productsData = [];
      let busy = false;

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

      const syncModelContext = async (products) => {
        try {
          await app.updateModelContext({
            content: [{ type: "text", text: "Product catalog: " + products.length + " products." }],
            structuredContent: { kind: "products", products },
          });
        } catch {}
      };

      const saveProduct = async (productId, updates) => {
        if (busy) return;
        busy = true;
        statusEl.textContent = "Saving " + productId + "...";
        try {
          const result = await app.callServerTool({
            name: "update_product",
            arguments: { product_id: productId, ...updates },
          });
          if (result.isError) throw new Error("Failed to update.");
          if (result.structuredContent?.products) {
            productsData = result.structuredContent.products;
            editingId = null;
            render();
            void syncModelContext(productsData);
          }
          statusEl.textContent = "Saved.";
        } catch (e) { statusEl.textContent = e.message || String(e); }
        finally { busy = false; }
      };

      const renderProduct = (product) => {
        const isEditing = editingId === product.id;
        const card = document.createElement("div");
        card.className = "group bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 transition-colors" + (isEditing ? " border-blue-800/60 ring-1 ring-blue-800/30" : " hover:border-zinc-700");

        if (isEditing) {
          card.innerHTML =
            '<div class="flex flex-col gap-3">'
            + '<div class="grid grid-cols-2 gap-3">'
            + '<div class="flex flex-col gap-1"><label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Name</label>'
            + '<input id="edit-name" type="text" value="' + escAttr(product.name) + '" class="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500" /></div>'
            + '<div class="flex flex-col gap-1"><label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Price (cents)</label>'
            + '<input id="edit-price" type="number" value="' + product.price + '" class="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500" /></div>'
            + '</div>'
            + '<div class="flex flex-col gap-1"><label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Description</label>'
            + '<textarea id="edit-desc" rows="2" class="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 resize-none">' + escAttr(product.description || "") + '</textarea></div>'
            + '<div class="flex flex-col gap-1"><label class="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Features (comma-separated)</label>'
            + '<input id="edit-features" type="text" value="' + escAttr((product.features || []).join(", ")) + '" class="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500" /></div>'
            + '<div class="flex items-center gap-3">'
            + '<label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer"><input id="edit-active" type="checkbox"' + (product.active ? " checked" : "") + ' class="w-4 h-4 rounded accent-blue-500" /> Active</label>'
            + '<div class="flex-1"></div>'
            + '<button id="cancel-btn" type="button" class="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Cancel</button>'
            + '<button id="save-btn" type="button" class="text-xs font-medium px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 transition-colors">Save</button>'
            + '</div></div>';

          card.querySelector("#cancel-btn").addEventListener("click", () => { editingId = null; render(); });
          card.querySelector("#save-btn").addEventListener("click", () => {
            const featuresRaw = card.querySelector("#edit-features").value;
            const features = featuresRaw.split(",").map((f) => f.trim()).filter(Boolean);
            saveProduct(product.id, {
              name: card.querySelector("#edit-name").value.trim(),
              price: Number(card.querySelector("#edit-price").value),
              description: card.querySelector("#edit-desc").value.trim(),
              features,
              active: card.querySelector("#edit-active").checked,
            });
          });
        } else {
          const left = document.createElement("div");
          left.className = "flex items-start justify-between gap-4";
          left.innerHTML =
            '<div class="flex-1">'
            + '<div class="flex items-center gap-2">'
            + '<span class="text-sm font-semibold text-zinc-100">' + product.name + '</span>'
            + '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full ' + (product.active ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50' : 'bg-zinc-800 text-zinc-500 border border-zinc-700') + '">' + (product.active ? "Active" : "Inactive") + '</span>'
            + '</div>'
            + '<div class="flex items-center gap-3 mt-0.5"><span class="text-xs text-zinc-500">' + product.id + '</span>' + extLink("stripe", "/products/" + product.id, "Open in Stripe") + '</div>'
            + '<div class="text-xs text-zinc-400 mt-1.5 leading-relaxed">' + (product.description || "") + '</div>'
            + (product.features?.length ? '<div class="flex flex-wrap gap-1.5 mt-2">' + product.features.map((f) => '<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">' + f + '</span>').join("") + '</div>' : "")
            + '</div>'
            + '<div class="text-right shrink-0 flex items-start gap-3">'
            + '<div><div class="text-lg font-semibold text-zinc-100">' + fmt(product.price) + '</div>'
            + '<div class="text-xs text-zinc-500">/' + (product.interval || "month") + '</div></div>'
            + '</div>';
          card.appendChild(left);

          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "mt-3 text-[10px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100";
          editBtn.textContent = "Edit product";
          editBtn.addEventListener("click", () => { editingId = product.id; render(); });
          card.appendChild(editBtn);
        }
        return card;
      };

      const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const render = () => {
        productsEl.innerHTML = "";
        if (!productsData.length) { productsEl.innerHTML = '<div class="text-sm text-zinc-500 py-4 text-center">No products.</div>'; return; }
        productsData.forEach((p) => productsEl.appendChild(renderProduct(p)));
      };

      app.ontoolresult = (result) => {
        const sc = result?.structuredContent;
        if (sc?.products) {
          productsData = sc.products;
          editingId = null;
          render();
          statusEl.textContent = "Synced.";
          void syncModelContext(productsData);
        }
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
