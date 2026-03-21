export type ResponseMessageItem = {
  type: 'message'
  content: Array<{ type: string; text?: string }>
}

export type ResponseFunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type ResponseOutputItem = ResponseMessageItem | ResponseFunctionCallItem

export const getResponseMessageText = (message: ResponseMessageItem): string => {
  let text = ''
  for (const part of message.content) {
    if (part.type === 'output_text' && part.text) {
      text += part.text
    }
  }
  return text
}
