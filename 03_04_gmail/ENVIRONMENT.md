# Environment setup

Required environment variables:

- `OPENAI_API_KEY`
- `MODEL` (optional, default: `gpt-5.2`)
- `GMAIL_CREDENTIALS_PATH` (optional override for OAuth credentials file)
- `GMAIL_SEND_WHITELIST` (optional comma-separated list of emails allowed for sending; authorized user is always allowed)
- `EVAL_MODEL` (optional override model for promptfoo eval runner)
- `EVAL_SYSTEM_PROMPT` (optional minimal system prompt override for eval runner)
- `EVAL_MOCK_GMAIL` (optional boolean: when true, tools run against deterministic in-memory Gmail fixtures)

OAuth credential file:

- `credentials.json` (Google OAuth desktop client credentials)

Token cache (auto-created):

- `.auth/gmail-token.json`

Current Gmail OAuth scopes used by this project:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.compose`
