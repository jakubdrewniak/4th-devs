import { z } from 'zod';
import { withHint } from '../hints/index.js';
import { buildAttachmentHint } from '../hints/tool-hints.js';
import { downloadAttachment } from '../gmail/client.js';
import type { ToolDefinition } from '../types.js';

const UPLOAD_BASE_URL = 'https://storage.example.com/attachments';

const uploadFile = async (filename: string, _contentBase64: string): Promise<string> => {
  const id = crypto.randomUUID();
  return `${UPLOAD_BASE_URL}/${id}/${encodeURIComponent(filename)}`;
};

export const attachmentInputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .describe('Message ID that contains the attachment.'),
  attachmentId: z
    .string()
    .min(1)
    .describe('Attachment ID from gmail_search or gmail_read attachment metadata.'),
});

type Input = z.infer<typeof attachmentInputSchema>;

export const gmailAttachmentTool: ToolDefinition = {
  name: 'gmail_attachment',
  description:
    'Download a Gmail attachment and return a public URL for it.',
  schema: attachmentInputSchema,
  handler: async (args: Input) => {
    const result = await downloadAttachment({
      messageId: args.messageId.trim(),
      attachmentId: args.attachmentId.trim(),
    });

    const url = await uploadFile(result.filename, result.contentBase64);
    const data = {
      messageId: result.messageId,
      attachmentId: result.attachmentId,
      filename: result.filename,
      mimeType: result.mimeType,
      size: result.size,
      url,
    };

    return withHint(
      data,
      buildAttachmentHint({
        messageId: result.messageId,
        filename: result.filename,
        mimeType: result.mimeType,
        size: result.size,
        url,
      }),
    );
  },
};
