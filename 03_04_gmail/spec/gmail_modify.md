# gmail_modify

Modify a message or thread state (read/unread, archive, trash, labels).

## Input

```json
{
  "kind": {
    "type": "string",
    "enum": ["message", "thread"]
  },
  "id": "string",
  "action": {
    "type": "string",
    "enum": [
      "markRead",
      "markUnread",
      "archive",
      "unarchive",
      "trash",
      "untrash",
      "addLabel",
      "removeLabel"
    ]
  },
  "label": "string | null"
}
```

## Validation Rules

- `label` is required for `addLabel` and `removeLabel`.
- `label` must be omitted for all other actions.

## Output

```json
{
  "kind": "message | thread",
  "id": "string",
  "appliedAction": "string",
  "labels": ["string"]
}
```

## Notes

- `archive` is implemented by removing the `INBOX` label.
- For thread actions, label output is the deduplicated union of labels across all thread messages.
