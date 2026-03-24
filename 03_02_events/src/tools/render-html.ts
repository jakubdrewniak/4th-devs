import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { marked } from 'marked'
import { WORKSPACE_ROOT_DIR } from '../config/index.js'
import type { Tool } from '../types.js'
import { asWorkspaceSafePath, WORKSPACE_DIR } from './common.js'

const TEMPLATE_PATH = join(WORKSPACE_ROOT_DIR, 'template.html')
const CONTENT_PLACEHOLDER = '{{CONTENT}}'

marked.setOptions({ gfm: true, breaks: false })

const markdownToHtml = (markdown: string): string => {
  const result = marked.parse(markdown)
  return typeof result === 'string' ? result.trim() : ''
}

export const renderHtmlTools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'render_html',
      description:
        'Convert a markdown file to a styled HTML document using the project template. ' +
        'Reads the markdown, converts to HTML, injects into template.html, and writes the output file.',
      parameters: {
        type: 'object',
        properties: {
          markdown_path: {
            type: 'string',
            description: 'Workspace-relative path to the source markdown file (e.g. "report/final-report.md").',
          },
          output_path: {
            type: 'string',
            description: 'Workspace-relative path for the output HTML file (e.g. "deliverables/report.html").',
          },
          title: {
            type: 'string',
            description: 'Optional HTML <title> override. If omitted, uses the first H1 from the markdown.',
          },
        },
        required: ['markdown_path', 'output_path'],
      },
    },
    handler: async (args) => {
      const mdPath = asWorkspaceSafePath(args.markdown_path)
      const outPath = asWorkspaceSafePath(args.output_path)

      if (!mdPath || !outPath) {
        return { kind: 'text', content: 'Error: markdown_path and output_path must be valid workspace-relative paths.' }
      }

      let template: string
      try {
        template = await readFile(TEMPLATE_PATH, 'utf-8')
      } catch {
        return { kind: 'text', content: `Error: template.html not found. Expected at workspace/template.html` }
      }

      if (!template.includes(CONTENT_PLACEHOLDER)) {
        return { kind: 'text', content: `Error: template.html does not contain placeholder "${CONTENT_PLACEHOLDER}".` }
      }

      let markdown: string
      try {
        markdown = await readFile(join(WORKSPACE_DIR, mdPath), 'utf-8')
      } catch {
        return { kind: 'text', content: `Error: could not read markdown file at "${mdPath}".` }
      }

      const htmlContent = markdownToHtml(markdown)

      const titleArg = typeof args.title === 'string' ? args.title.trim() : ''
      const h1Match = markdown.match(/^#\s+(.+)$/m)
      const pageTitle = titleArg || h1Match?.[1] || 'Document'

      let output = template.replace(CONTENT_PLACEHOLDER, htmlContent)
      output = output.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`)

      const absoluteOutPath = join(WORKSPACE_DIR, outPath)
      await mkdir(dirname(absoluteOutPath), { recursive: true })
      await writeFile(absoluteOutPath, output, 'utf-8')

      return {
        kind: 'text',
        content: JSON.stringify({
          success: true,
          markdown_path: mdPath,
          output_path: outPath,
          title: pageTitle,
          content_length: htmlContent.length,
        }, null, 2),
      }
    },
  },
]
