import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

/**
 * Small 1x1 PNG logo (base64 encoded).
 * This is a minimal valid PNG file for demonstration purposes.
 * In production, you would load this from a file or generate it dynamically.
 *
 * Format: 1x1 transparent PNG
 */
const LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Binary resource example: Server logo image.
 * Demonstrates blob (binary) content support per MCP spec.
 */
export const logoResource = {
  uri: 'logo://server',
  name: 'Server Logo',
  description: 'MCP server logo image (binary resource example)',
  mimeType: 'image/png',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('logo_resource', { message: 'Server logo requested' });

    return {
      contents: [
        {
          uri: 'logo://server',
          mimeType: 'image/png',
          blob: LOGO_PNG_BASE64,
        },
      ],
    };
  },
};

/**
 * Alternative: SVG logo as text content.
 * SVG can be provided as text since it's XML-based.
 */
export const logoSvgResource = {
  uri: 'logo://server/svg',
  name: 'Server Logo (SVG)',
  description: 'MCP server logo in SVG format (text resource example)',
  mimeType: 'image/svg+xml',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('logo_svg_resource', { message: 'Server SVG logo requested' });

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="#4A90E2" />
  <text x="50" y="55" font-family="Arial" font-size="30" fill="white" text-anchor="middle">MCP</text>
</svg>`;

    return {
      contents: [
        {
          uri: 'logo://server/svg',
          mimeType: 'image/svg+xml',
          text: svgContent,
        },
      ],
    };
  },
};
