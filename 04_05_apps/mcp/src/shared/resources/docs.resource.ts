import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

const documentationContent = `# MCP Server Template Documentation

This is the auto-generated documentation for your MCP Server Template.

## Overview

This server implements the Model Context Protocol (MCP) using Streamable HTTP transport with the following features:

- **Tools**: Extensible tool system with Zod validation
- **Prompts**: Dynamic prompt generation with pagination
- **Resources**: Static and templated resource access
- **Authentication**: Optional OAuth 2.1 with RFC9728/RFC8414 discovery
- **Logging**: Structured logging with MCP notifications
- **Security**: Origin validation, protocol version checks, token validation

## Available Tools

1. **health** - Server health check
2. **echo** - Echo messages with optional repetition  
3. **example_api_call** - Simulated API call processing

## Available Prompts

1. **greeting** - Generate personalized greetings in multiple languages
2. **analysis** - Create structured analysis prompts with customizable depth

## Available Resources

1. **config://server** - Server configuration (redacted)
2. **docs://overview** - This documentation

## Authentication

When \`AUTH_ENABLED=true\`, the server implements OAuth 2.1 Resource Server functionality:

- Validates Bearer tokens on all requests
- Provides RFC9728 Protected Resource Metadata discovery
- Supports RFC8414 Authorization Server Metadata
- Enforces audience/resource parameter binding

## Development

Run the server in development mode:

\`\`\`bash
bun dev
\`\`\`

## Production

Build and run for production:

\`\`\`bash
bun build
bun start
\`\`\`

For more details, see the README.md file.
`;

export const docsResource = {
  uri: 'docs://overview',
  name: 'Server Documentation',
  description: 'Overview documentation for this MCP server',
  mimeType: 'text/markdown',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('docs_resource', { message: 'Documentation requested' });

    return {
      contents: [
        {
          uri: 'docs://overview',
          mimeType: 'text/markdown',
          text: documentationContent,
        },
      ],
    };
  },
};
