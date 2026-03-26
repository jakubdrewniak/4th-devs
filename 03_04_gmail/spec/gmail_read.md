# gmail_read

Read either a single message or an entire thread.
Returns normalized message content for reliable summarization and follow-up actions.

## Input

```json
{
  "kind": {
    "type": "string",
    "enum": ["message", "thread"]
  },
  "id": {
    "type": "string",
    "description": "messageId when kind=message, threadId when kind=thread"
  }
}
```

## Output

```json
{
  "kind": "message | thread",
  "threadId": "string",
  "subject": "string",
  "messages": [
    {
      "messageId": "string",
      "sender": "string",
      "recipients": ["string"],
      "receivedAt": "string (ISO 8601)",
      "isDraft": "boolean",
      "isRead": "boolean",
      "labels": ["string"],
      "bodyText": "string",
      "attachments": [
        {
          "attachmentId": "string",
          "filename": "string",
          "mimeType": "string",
          "size": "number (bytes)"
        }
      ]
    }
  ]
}
```

## Notes

- For `kind=message`, `messages` contains one item.
- For `kind=thread`, messages are sorted chronologically (oldest first).
- `bodyText` prefers plain text MIME parts and falls back to stripped HTML.
