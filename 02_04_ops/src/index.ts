import { createInterface } from 'node:readline/promises'
import { runAgent } from './agent.js'

const DEMO_FILE = 'demo/example.md'

const confirmRun = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n⚠️  UWAGA: Uruchomienie tego agenta może zużyć zauważalną liczbę tokenów.')
  console.log('   Jeśli nie chcesz uruchamiać go teraz, najpierw sprawdź plik demo:')
  console.log(`   Demo: ${DEMO_FILE}`)
  console.log('')

  const answer = await rl.question('Czy chcesz kontynuować? (yes/y): ')
  rl.close()

  const normalized = answer.trim().toLowerCase()
  if (normalized !== 'yes' && normalized !== 'y') {
    console.log('Przerwano.')
    process.exit(0)
  }
}

const today = new Date().toISOString().split('T')[0]

async function main() {
  console.log(`\n========================================`)
  console.log(`  Daily Ops Generator — ${today}`)
  console.log(`========================================\n`)

  await confirmRun()

  const task = [
    `Prepare the Daily Ops note for ${today}.`,
    `Start by reading the workflow instructions from workflows/daily-ops.md using the read_file tool.`,
    `Then follow the steps described in the workflow precisely.`,
    `Make sure to write the final output to output/${today}.md`,
  ].join(' ')

  const result = await runAgent('orchestrator', task)

  console.log(`\n========================================`)
  console.log(`  Result`)
  console.log(`========================================\n`)
  console.log(result)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
