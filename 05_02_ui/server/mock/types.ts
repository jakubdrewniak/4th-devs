import type { StreamEvent } from '../../shared/chat'

export interface MockStep {
  delayMs: number
  event: StreamEvent
  sideEffect?: () => Promise<void>
}

export interface BuiltScenario {
  steps: MockStep[]
  events: StreamEvent[]
  nextSeq: number
}

export type ScenarioName = 'sales' | 'email' | 'artifact' | 'research'
