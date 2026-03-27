export const renderWebUi = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>03_05 Render</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #070b14;
        --card: #101827;
        --card-border: #263347;
        --text: #d6deed;
        --muted: #8d9ab0;
        --accent: #56b6f6;
        --ok: #44d18e;
        --warn: #f0b33f;
        --err: #ff6b6b;
        --scrollbar-size: 11px;
        --scrollbar-track: color-mix(in srgb, #ffffff 6%, transparent);
        --scrollbar-thumb: color-mix(in srgb, #d6deed 34%, transparent);
        --scrollbar-thumb-hover: color-mix(in srgb, #d6deed 52%, transparent);
      }

      * { box-sizing: border-box; }
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
      }
      *::-webkit-scrollbar {
        width: var(--scrollbar-size);
        height: var(--scrollbar-size);
      }
      *::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
        border-radius: 999px;
      }
      *::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
      }
      *::-webkit-scrollbar-corner {
        background: transparent;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top, #0f1f3a 0%, var(--bg) 50%);
        color: var(--text);
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          Segoe UI,
          Roboto,
          Helvetica,
          Arial,
          sans-serif;
      }

      .layout {
        width: 100%;
        margin: 0;
        padding: 10px;
        display: grid;
        gap: 10px;
        min-height: 100vh;
        grid-template-rows: auto 1fr;
      }

      .card {
        background: color-mix(in srgb, var(--card) 92%, black 8%);
        border: 1px solid var(--card-border);
        border-radius: 12px;
      }

      .status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        gap: 10px;
        flex-wrap: wrap;
      }

      .status-line {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--muted);
        box-shadow: 0 0 12px transparent;
      }

      .badge {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .mono {
        font-family:
          ui-monospace,
          SFMono-Regular,
          Menlo,
          Monaco,
          Consolas,
          Liberation Mono,
          monospace;
      }

      .message {
        padding: 0 14px 14px;
        color: var(--text);
      }

      .workspace {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        min-height: calc(100vh - 130px);
      }

      .viewer-wrap {
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        min-height: 0;
      }

      .viewer {
        width: 100%;
        height: 100%;
        min-height: calc(100vh - 200px);
        border: 1px solid var(--card-border);
        border-radius: 10px;
        background: #fff;
      }

      .overlay {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border: 1px dashed var(--card-border);
        border-radius: 10px;
        padding: 18px;
        margin-bottom: 10px;
        color: var(--muted);
      }

      .overlay.visible { display: flex; }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
        border-top-color: var(--accent);
        border-radius: 999px;
        animation: spin 0.75s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .error {
        display: none;
        border: 1px solid color-mix(in srgb, var(--err) 55%, #000 45%);
        border-radius: 10px;
        background: color-mix(in srgb, var(--err) 12%, #000 88%);
        color: #ffd8d8;
        padding: 12px;
      }

      .error.visible { display: block; }

      .inspector {
        display: grid;
        grid-template-rows: auto auto 1fr 1fr;
        gap: 10px;
        min-height: 0;
        padding: 10px;
      }

      .inspector-head {
        border: 1px solid var(--card-border);
        border-radius: 10px;
        padding: 10px;
        display: grid;
        gap: 8px;
      }

      .meta-row {
        display: grid;
        gap: 6px;
      }

      .meta-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .meta-value {
        font-size: 12px;
        color: var(--text);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .json-panel {
        border: 1px solid var(--card-border);
        border-radius: 10px;
        min-height: 0;
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .json-title {
        padding: 8px 10px;
        border-bottom: 1px solid var(--card-border);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .json-pre {
        margin: 0;
        padding: 10px;
        overflow: auto;
        font-size: 12px;
        line-height: 1.5;
      }

      @media (max-width: 1200px) {
        .workspace {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(420px, 1fr) minmax(420px, 1fr);
        }
        .viewer {
          min-height: 420px;
        }
      }
    </style>
  </head>
  <body>
    <main class="layout">
      <section class="card">
        <div class="status">
          <div class="status-line">
            <span id="status-dot" class="dot"></span>
            <span id="status-badge" class="badge mono">idle</span>
            <span class="badge mono">phase:</span>
            <span id="phase-value" class="badge mono">idle</span>
          </div>
          <div class="status-line">
            <span class="badge mono">socket:</span>
            <span id="socket-value" class="badge mono">connecting</span>
            <span class="badge mono">updated:</span>
            <span id="updated-value" class="badge mono">-</span>
          </div>
        </div>
        <div id="message-value" class="message">Waiting for CLI prompt...</div>
      </section>

      <section class="workspace">
        <section class="card viewer-wrap">
          <div id="loading-overlay" class="overlay">
            <span class="spinner"></span>
            <span>Generating render document...</span>
          </div>
          <div id="error-box" class="error"></div>
          <iframe
            id="render-frame"
            class="viewer"
            title="Render Preview"
            sandbox="allow-scripts allow-same-origin"
          ></iframe>
        </section>

        <section class="card inspector">
          <div class="inspector-head">
            <div class="meta-row">
              <div class="meta-label mono">title</div>
              <div id="doc-title" class="meta-value mono">-</div>
            </div>
            <div class="meta-row">
              <div class="meta-label mono">model / packs</div>
              <div id="doc-model" class="meta-value mono">-</div>
              <div id="doc-packs" class="meta-value mono">-</div>
            </div>
            <div class="meta-row">
              <div class="meta-label mono">summary</div>
              <div id="doc-summary" class="meta-value">-</div>
            </div>
          </div>

          <section class="json-panel">
            <div class="json-title mono">spec</div>
            <pre id="spec-json" class="json-pre mono">{}</pre>
          </section>

          <section class="json-panel">
            <div class="json-title mono">state</div>
            <pre id="state-json" class="json-pre mono">{}</pre>
          </section>
        </section>
      </section>
    </main>

    <script>
      (() => {
        const statusDot = document.getElementById('status-dot');
        const statusBadge = document.getElementById('status-badge');
        const phaseValue = document.getElementById('phase-value');
        const socketValue = document.getElementById('socket-value');
        const updatedValue = document.getElementById('updated-value');
        const messageValue = document.getElementById('message-value');
        const loadingOverlay = document.getElementById('loading-overlay');
        const errorBox = document.getElementById('error-box');
        const frame = document.getElementById('render-frame');

        const docTitle = document.getElementById('doc-title');
        const docModel = document.getElementById('doc-model');
        const docPacks = document.getElementById('doc-packs');
        const docSummary = document.getElementById('doc-summary');
        const specJson = document.getElementById('spec-json');
        const stateJson = document.getElementById('state-json');

        let currentDocumentId = null;

        const palette = {
          idle: '#8d9ab0',
          loading: '#f0b33f',
          ready: '#44d18e',
          error: '#ff6b6b'
        };

        const toLocalTime = (iso) => {
          if (!iso) return '-';
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return '-';
          return date.toLocaleTimeString();
        };

        const setSocketState = (state) => {
          socketValue.textContent = state;
        };

        const stringify = (value) => {
          try {
            return JSON.stringify(value ?? {}, null, 2);
          } catch {
            return '{"error":"Unable to stringify value."}';
          }
        };

        const renderDocumentInfo = (doc) => {
          if (!doc || typeof doc !== 'object') {
            docTitle.textContent = '-';
            docModel.textContent = '-';
            docPacks.textContent = '-';
            docSummary.textContent = '-';
            specJson.textContent = '{}';
            stateJson.textContent = '{}';
            currentDocumentId = null;
            return;
          }

          docTitle.textContent = String(doc.title || '-');
          docModel.textContent = String(doc.model || '-');
          docPacks.textContent = Array.isArray(doc.packs) ? doc.packs.join(', ') : '-';
          docSummary.textContent = String(doc.summary || '-');
          specJson.textContent = stringify(doc.spec);
          stateJson.textContent = stringify(doc.state);

          if (doc.id && doc.id !== currentDocumentId && typeof doc.html === 'string') {
            frame.srcdoc = doc.html;
            currentDocumentId = doc.id;
          }
        };

        const renderState = (state) => {
          if (!state || typeof state !== 'object') return;

          const status = String(state.status || 'idle');
          statusBadge.textContent = status;
          phaseValue.textContent = String(state.phase || 'idle');
          messageValue.textContent = String(state.message || '');
          updatedValue.textContent = toLocalTime(state.updatedAt);
          statusDot.style.background = palette[status] || palette.idle;
          statusDot.style.boxShadow = '0 0 12px ' + (palette[status] || palette.idle);

          const isLoading = status === 'loading';
          loadingOverlay.classList.toggle('visible', isLoading);

          const isError = status === 'error';
          errorBox.classList.toggle('visible', isError);
          errorBox.textContent = isError ? String(state.error || 'Unknown error') : '';

          renderDocumentInfo(state.document);
        };

        const connect = () => {
          const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new WebSocket(protocol + '//' + location.host + '/ws');
          setSocketState('connecting');

          socket.addEventListener('open', () => setSocketState('open'));
          socket.addEventListener('close', () => {
            setSocketState('reconnecting');
            setTimeout(connect, 1000);
          });
          socket.addEventListener('error', () => setSocketState('error'));
          socket.addEventListener('message', (event) => {
            try {
              const packet = JSON.parse(event.data);
              if (packet && packet.type === 'preview_state') {
                renderState(packet.state);
              }
            } catch {
              // Ignore malformed packets.
            }
          });
        };

        connect();
      })();
    </script>
  </body>
</html>
`
