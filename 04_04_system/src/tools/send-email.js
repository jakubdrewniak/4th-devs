/*
  Tool: send_email (fake)

  Simulates sending an email by writing the HTML body to a file
  in workspace/ops/daily-news/{date}/sent-{timestamp}.html
*/

import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "../../workspace");

export const definition = {
  type: "function",
  name: "send_email",
  description:
    "Send an email (simulated). Writes the HTML body to the output folder instead of actually sending. " +
    "Returns the path of the written file.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      html_body: { type: "string", description: "HTML content of the email" },
    },
    required: ["to", "subject", "html_body"],
    additionalProperties: false,
  },
  strict: true,
};

export const handler = async ({ to, subject, html_body }) => {
  const date = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(WORKSPACE, "ops/daily-news", date);
  const filename = `sent-${timestamp}.html`;
  const filepath = join(dir, filename);

  await mkdir(dir, { recursive: true });
  await writeFile(filepath, html_body, "utf-8");

  return {
    status: "sent (simulated)",
    to,
    subject,
    path: `ops/daily-news/${date}/${filename}`,
  };
};
