import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { ensureWorkspaceInitialized } from './bootstrap.js'
import { PATHS } from './config.js'
import { logger, ui } from './logger.js'
import { createMcpManager } from './mcp/client.js'
import { runAwarenessTurn, createSession } from './core/agent.js'
import { appendConversationLogs, historyToMessages, loadRecentHistory } from './core/chat-history.js'
import { loadAgentTemplate } from './core/template.js'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10)
const pad2 = (value: number): string => String(value).padStart(2, '0')

const DEMO_FACTUAL_PATH = `${PATHS.memoryFactualDir}/F002-night-out.md`
const DEMO_MUTATED_PATHS = [
  PATHS.identityPath,
  PATHS.preferencesPath,
  PATHS.importantDatesPath,
  DEMO_FACTUAL_PATH,
  PATHS.awarenessStatePath,
  PATHS.chatHistoryPath,
] as const

type FileBackup = {
  path: string
  content: string | null
}

const readOrNull = async (path: string): Promise<string | null> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return await file.text()
}

const backupFiles = async (paths: readonly string[]): Promise<FileBackup[]> =>
  Promise.all(paths.map(async (path) => ({ path, content: await readOrNull(path) })))

const restoreFiles = async (backup: FileBackup[]): Promise<void> => {
  await Promise.all(
    backup.map(async ({ path, content }) => {
      if (content == null) {
        await rm(path, { force: true })
        return
      }
      await writeFile(path, content, 'utf-8')
    }),
  )
}

const seedDemoData = async (): Promise<void> => {
  const now = new Date()
  const momBirthday = new Date(now)
  momBirthday.setDate(momBirthday.getDate() + 5)
  const teamMeetup = new Date(now)
  teamMeetup.setDate(teamMeetup.getDate() + 6)
  const momBirthdayDate = `1966-${pad2(momBirthday.getMonth() + 1)}-${pad2(momBirthday.getDate())}`

  await Promise.all([
    writeFile(
      PATHS.identityPath,
      [
        '# User Identity',
        '',
        '- Name: Alex',
        '- Location: Warsaw, Poland',
        '- Timezone: Europe/Warsaw',
        '- Preferred language: English',
        '- Notes: Works late on Fridays and often goes for pub crawls with friends.',
        '',
      ].join('\n'),
      'utf-8',
    ),
    writeFile(
      PATHS.preferencesPath,
      [
        '# User Preferences',
        '',
        '- Night out style: likes lively but conversation-friendly places; avoids super loud clubs.',
        '- Drinks: prefers craft IPA and dry cider over sweet cocktails.',
        '- Late food: likes zapiekanka, kebab, and pizza slices; avoids very spicy food late at night.',
        '- Budget mode: usually asks for cheap and fast options after midnight.',
        '',
      ].join('\n'),
      'utf-8',
    ),
    writeFile(
      PATHS.importantDatesPath,
      `${JSON.stringify(
        {
          dates: [
            {
              title: 'Mom birthday',
              person: 'Mom',
              date: momBirthdayDate,
              recurrence: 'yearly',
              note: 'Buy flowers and call in the morning.',
            },
            {
              title: 'Team meetup',
              person: 'friends',
              date: toIsoDay(teamMeetup),
              recurrence: 'once',
              note: 'Reserved table near Plac Zbawiciela.',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf-8',
    ),
    writeFile(
      DEMO_FACTUAL_PATH,
      [
        '# F002 Night-Out Facts',
        '',
        '- User usually starts in Srodmiescie and may move toward Praga later.',
        '- User values places where talking is possible.',
        '- User asks for practical options, not long explanations.',
        '',
      ].join('\n'),
      'utf-8',
    ),
    writeFile(PATHS.awarenessStatePath, `${JSON.stringify({ turnsSinceScout: 0 }, null, 2)}\n`, 'utf-8'),
  ])
}

const seedSimulatedHistory = async (): Promise<void> => {
  const seedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const sessionId = 'seed-history'
  const rows = [
    // { at: seedAt, sessionId, role: 'user', content: 'I like craft beer but not very loud places.' },
    // { at: seedAt, sessionId, role: 'assistant', content: 'Got it. I will prioritize conversation-friendly pubs.' },
    // { at: seedAt, sessionId, role: 'user', content: 'Late-night food should be quick and not too spicy.' },
    // { at: seedAt, sessionId, role: 'assistant', content: 'Noted: quick, filling, mild options after midnight.' },
  ]
  await writeFile(PATHS.chatHistoryPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8')
}

const demoMessages = [
  'hey',
  'how are you doing?',
  'yeah thinking about going out tonight honestly',
  'yeah maybe a pub crawl, been ages',
  'it has been a long week tbh',
  'oh right. ok well right now I am in srodmiescie and starving',
  'alright cheers',
]

const main = async (): Promise<void> => {
  await ensureWorkspaceInitialized()

  const persist = process.env.DEMO_PERSIST === '1' || process.env.DEMO_PERSIST?.toLowerCase() === 'true'
  const backup = await backupFiles(DEMO_MUTATED_PATHS)

  const sessionId = `demo-${randomUUID()}`
  let mcp: Awaited<ReturnType<typeof createMcpManager>> | null = null

  try {
    await seedDemoData()
    await seedSimulatedHistory()

    const template = await loadAgentTemplate('awareness')
    const history = await loadRecentHistory(12)
    const session = createSession(sessionId, historyToMessages(history))
    mcp = await createMcpManager(process.cwd()).catch((error) => {
      logger.warn('demo.mcp_unavailable', { error: String(error) })
      return null
    })

    ui.banner(template.model, history.length)
    logger.info('demo.started', {
      messages: demoMessages.length,
      injectedHistory: history.length,
      persistDemoData: persist,
    })

    for (const message of demoMessages) {
      console.log(`you > ${message}`)
      const response = await runAwarenessTurn(session, message, mcp)
      ui.assistant(response.text)
      await appendConversationLogs(sessionId, message, response.text)
      await sleep(1200)
    }
    logger.info('demo.completed', { sessionId })
  } finally {
    if (mcp) await mcp.close()
    if (!persist) {
      await restoreFiles(backup)
      logger.info('demo.restored_original_workspace')
    }
  }
}

main().catch((error) => {
  logger.error('demo.failed', { error: error instanceof Error ? error.stack ?? error.message : String(error) })
  process.exitCode = 1
})
