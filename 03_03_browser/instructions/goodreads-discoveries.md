# goodreads — Discoveries

## Discovery (2026-02-22T18:17:30)
Some Goodreads book pages use a legacy template where `[data-testid="averageRating"]` is absent; direct `evaluate` returning undefined can error in wrapper. Use resilient extraction with null-coalescing and fallback strategies: extract rating from visible header text or JSON-LD when data-testid selectors missing. Always return `null` instead of `undefined`.

## Discovery (2026-02-22T18:23:15)
Goodreads book page shelving UI (2026): the shelf picker opens as a `[role="dialog"]` overlay. Text-based `click({text:"Currently reading"})` may misfire because the page also contains “people are currently reading” elements behind the overlay, and the overlay can intercept pointer events.

Use DOM-scoped clicks inside the dialog via `evaluate`:

```js
(() => {
  // 1) Open shelf picker by clicking the primary shelf button (often labeled Read/Want to Read/etc.)
  const primary = [...document.querySelectorAll('button')]
    .find(b => /Shelved as/i.test(b.getAttribute('aria-label')||''));
  primary?.click();

  // 2) Click the desired shelf option within the dialog
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return {ok:false, reason:'no dialog'};

  const norm = s => (s||'').replace(/\s+/g,' ').trim();
  const option = [...dialog.querySelectorAll('button,[role="button"],a,label,div')]
    .find(el => /^Currently reading$/i.test(norm(el.textContent)) || /Currently reading/i.test(norm(el.textContent)));
  if (!option) return {ok:false, reason:'no option'};

  option.scrollIntoView({block:'center'});
  option.click();

  // 3) Verify shelf state via aria-label
  const after = [...document.querySelectorAll('button')]
    .find(b => /Shelved as/i.test(b.getAttribute('aria-label')||''));
  return {ok:true, shelvedAs: after?.getAttribute('aria-label')||null};
})()
```

Verification tip: navigating back to `https://www.goodreads.com/review/list/<USER_ID>?shelf=currently-reading` should show updated count (e.g., 14) and the title in the table.
