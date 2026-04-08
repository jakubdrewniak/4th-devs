import type { StreamEvent } from '../../../shared/chat'

const flushFrame = async (
  frame: string,
  onEvent: (event: StreamEvent) => void | Promise<void>,
): Promise<void> => {
  const payload = frame
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')

  if (!payload) {
    return
  }

  await onEvent(JSON.parse(payload) as StreamEvent)
}

export const consumeSse = async (
  response: Response,
  onEvent: (event: StreamEvent) => void | Promise<void>,
): Promise<void> => {
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Streaming request failed with ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Streaming response has no body')
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      await flushFrame(frame, onEvent)
      boundary = buffer.indexOf('\n\n')
    }
  }

  const remaining = buffer.trim()
  if (remaining) {
    await flushFrame(remaining, onEvent)
  }
}
