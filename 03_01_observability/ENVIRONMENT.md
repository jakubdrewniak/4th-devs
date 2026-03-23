# Environment Variables

Create a `.env` file in this directory with:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com

PORT=3010
```

`LANGFUSE_*` is optional. If missing, the app still runs with tracing disabled.
