# gmail_search

Search messages using Gmail query syntax.
This is the primary discovery tool for messages, drafts (`is:draft`), and thread entry points.

## Input

```json
{
  "query": {
    "type": "string",
    "default": "",
    "description": "Gmail query syntax, e.g. from:anna@company.com is:unread has:attachment"
  },
  "limit": {
    "type": "number",
    "default": 20,
    "minimum": 1,
    "maximum": 50
  },
  "cursor": {
    "type": "string",
    "nullable": true,
    "description": "Pagination token from previous response.nextCursor"
  }
}
```

## Output

```json
{
  "items": [
    {
      "messageId": "string",
      "threadId": "string",
      "subject": "string",
      "sender": "string",
      "recipients": ["string"],
      "receivedAt": "string (ISO 8601)",
      "isDraft": "boolean",
      "isRead": "boolean",
      "labels": ["string"],
      "attachments": [
        {
          "attachmentId": "string",
          "filename": "string",
          "mimeType": "string",
          "size": "number (bytes)"
        }
      ]
    }
  ],
  "nextCursor": "string | null"
}
```

## Notes

- `messages.list` returns IDs only; implementation hydrates each item via `messages.get`.
- Labels are resolved to names (cached `labels.list`) for LLM readability.
- Attachments are listed as metadata only; content is fetched with `gmail_attachment`.
