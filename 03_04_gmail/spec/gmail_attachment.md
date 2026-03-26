# gmail_attachment

Fetch a specific attachment payload by `messageId` and `attachmentId`.

## Input

```json
{
  "messageId": "string",
  "attachmentId": "string"
}
```

## Output

```json
{
  "messageId": "string",
  "attachmentId": "string",
  "filename": "string",
  "mimeType": "string",
  "size": "number (bytes)",
  "contentBase64": "string"
}
```

## Notes

- `contentBase64` is returned for downstream decoding/storage.
- Metadata (`filename`, `mimeType`, `size`) is looked up from message parts.
