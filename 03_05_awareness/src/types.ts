import type OpenAI from 'openai'

export type Message = OpenAI.Responses.EasyInputMessage

export interface AgentTemplate {
  name: string
  model: string
  systemPrompt: string
  tools: string[]
}

export interface RecallScoutSession {
  lastResponseId?: string
}

export interface Session {
  id: string
  messages: Message[]
  turns: number
  lastResponseId?: string
  scoutSession?: RecallScoutSession
}

export interface ChatLogEntry {
  at: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
}

export interface ImportantDate {
  title: string
  person: string
  date: string
  recurrence: 'yearly' | 'once'
  note?: string
}

export interface UpcomingDate extends ImportantDate {
  nextOccurrence: string
  daysUntil: number
  isToday: boolean
  isTomorrow: boolean
}

export interface WeatherSnapshot {
  location: string
  summary: string
  temperatureC: number | null
  observedAt: string
  source: string
}

export interface AwarenessState {
  turnsSinceScout: number
  lastScoutAt?: string
  lastScoutReason?: string
}

export interface AgentResponse {
  text: string
  usedTool: boolean
}
