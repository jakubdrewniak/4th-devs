# gmail_send

Send a new email, reply, or forward.
Can send immediately or save as draft.

## Input

```json
{
  "mode": {
    "type": "string",
    "enum": ["new", "reply", "forward"]
  },
  "to": ["string"],
  "cc": ["string"],
  "bcc": ["string"],
  "subject": "string",
  "bodyText": "string",
  "replyToMessageId": "string | null",
  "forwardMessageId": "string | null",
  "saveAsDraft": {
    "type": "boolean",
    "default": false
  }
}
```

## Validation Rules

- `mode=new`: `to`, `subject`, and `bodyText` are required.
- `mode=reply`: `replyToMessageId` and `bodyText` are required; `subject`/`to` are optional (derived from the source message when missing).
- `mode=forward`: `forwardMessageId`, `to`, and `bodyText` are required; `subject` is optional (`Fwd:` derived when missing).
- `replyToMessageId` and `forwardMessageId` are mutually exclusive.

## Output

```json
{
  "status": "sent | drafted",
  "mode": "new | reply | forward",
  "messageId": "string | null",
  "threadId": "string | null",
  "draftId": "string | null",
  "policy": {
    "enforcedDraft": "boolean",
    "blockedRecipients": ["string"],
    "whitelist": ["string"]
  }
}
```

## Notes

- Reply mode sets `In-Reply-To` and `References` headers to preserve Gmail threading.
- Forward mode includes forwarded content in `bodyText` context.
- Send policy: recipients are restricted to a whitelist.
- By default, whitelist contains only the authorized Gmail user.
- Additional allowed recipients can be configured via `GMAIL_SEND_WHITELIST`.
- If any recipient is outside the whitelist, the tool creates a draft (`status=drafted`) even when `saveAsDraft=false`.
