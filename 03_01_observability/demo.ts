const PORT = process.env.PORT ?? '3000'
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`
const SESSION_ID = `obs-demo-${Date.now()}`

const messages = [
  'Hey, can you tell me what time it is in UTC?',
  'Now sum these numbers: 3, 11, 21, 34',
  'Great, briefly summarize what you just did.',
]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ensureServerRunning = async (): Promise<void> => {
  try {
    await fetch(`${BASE_URL}/api/health`)
  } catch {
    console.error(`\n  ✖ Serwer nie jest uruchomiony na ${BASE_URL}`)
    console.error('    Uruchom go najpierw w osobnym terminalu:')
    console.error('')
    console.error('    npm run lesson11:observability')
    console.error('')
    process.exit(1)
  }
}

const main = async (): Promise<void> => {
  await ensureServerRunning()
  console.log(`Demo session: ${SESSION_ID}`)

  for (const message of messages) {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: SESSION_ID,
        user_id: 'demo-user',
        message,
      }),
    })

    const data = await response.json()
    console.log('\n---')
    console.log(`User:      ${message}`)
    console.log(`Assistant: ${data.response ?? data.error}`)
    console.log(`Turns:     ${data.turns ?? 'n/a'}`)
    console.log(`Usage:     ${JSON.stringify(data.usage ?? {})}`)

    await wait(500)
  }
}

main().catch((error) => {
  console.error('Demo failed:', error)
  process.exit(1)
})
