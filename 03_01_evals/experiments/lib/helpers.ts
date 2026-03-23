import { createInterface } from 'node:readline/promises'
import type { RunEvaluator } from '@langfuse/client'
import type { Message } from '../../src/types.js'

interface ConfirmExperimentParams {
  name: string
  datasetCases: number
  description: string
}

export const confirmExperiment = async (params: ConfirmExperimentParams): Promise<void> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('')
  console.log('⚠️  UWAGA: Zaraz zostanie uruchomiony eksperyment ewaluacyjny.')
  console.log(`   Nazwa: ${params.name}`)
  console.log(`   Opis:  ${params.description}`)
  console.log('')
  console.log('   Co się stanie:')
  console.log(`   • Dla każdego z ${params.datasetCases} przypadków testowych zostanie wysłane zapytanie do LLM`)
  console.log('   • Każde zapytanie zużywa tokeny (i generuje koszty)')
  console.log('   • Wyniki zostaną zapisane w Langfuse (dataset + experiment)')
  console.log('')

  const answer = await rl.question('   Czy chcesz kontynuować? (yes/y): ')
  rl.close()

  const normalized = answer.trim().toLowerCase()
  if (normalized !== 'yes' && normalized !== 'y') {
    console.log('   Przerwano.')
    process.exit(0)
  }

  console.log('')
}

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const toCaseInput = (item: unknown): { id: string; message: string } => {
  if (typeof item !== 'object' || item == null) {
    return { id: 'unknown', message: '' }
  }

  const candidate = item as { id?: unknown; message?: unknown }
  return {
    id: typeof candidate.id === 'string' ? candidate.id : 'unknown',
    message: typeof candidate.message === 'string' ? candidate.message : '',
  }
}

export const extractToolNames = (messages: Message[]): string[] =>
  messages.flatMap((message) =>
    'type' in message && message.type === 'function_call' ? [message.name] : [],
  )

export const createAvgScoreEvaluator = (scoreName: string): RunEvaluator => {
  return async ({ itemResults }) => {
    const scores = itemResults
      .flatMap((item) => item.evaluations)
      .filter((evaluation) => evaluation.name === scoreName)
      .map((evaluation) => evaluation.value)
      .filter((value): value is number => typeof value === 'number')

    if (scores.length === 0) {
      return {
        name: `avg_${scoreName}`,
        value: 0,
        comment: `No per-item ${scoreName} scores produced`,
      }
    }

    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length
    return {
      name: `avg_${scoreName}`,
      value: avg,
      comment: `${(avg * 100).toFixed(1)}% across ${scores.length} items`,
    }
  }
}
