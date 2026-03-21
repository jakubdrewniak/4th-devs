import { runAgent } from './agent.js'
import { connectServer, disconnectAll } from './mcp-client.js'
import { resetLoadedTools } from './mcp-registry.js'

async function main() {
  console.log('\n========================================')
  console.log('  MCP Sandbox Agent')
  console.log('========================================\n')

  // Connect to MCP todo server
  console.log('Connecting to MCP todo server...')
  await connectServer('todo', 'bun', ['servers/todo.ts'])
  console.log('Connected.\n')

  // Reset any previously loaded tool schemas
  resetLoadedTools()

  // The task for the agent
  const task = process.argv.slice(2).join(' ')
    || 'Create a shopping list with: milk, bread, eggs. Then mark milk as completed and show me what\'s left to buy.'

  console.log(`Task: ${task}\n`)

  try {
    const result = await runAgent('sandbox', task)

    console.log('\n========================================')
    console.log('  Result')
    console.log('========================================\n')
    console.log(result)
  } finally {
    await disconnectAll()
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
