import type { AIMessage } from '../../electron/types'

export const DEFAULT_VISIBLE_AI_MESSAGES = 40
const BOTTOM_STICK_THRESHOLD_PX = 72

export function visibleAIMessageWindow(
  messages: AIMessage[],
  expanded: boolean,
  limit = DEFAULT_VISIBLE_AI_MESSAGES,
): { messages: AIMessage[]; hiddenCount: number } {
  if (expanded || messages.length <= limit) return { messages, hiddenCount: 0 }
  return { messages: messages.slice(-limit), hiddenCount: messages.length - limit }
}

export function isNearConversationBottom(metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= BOTTOM_STICK_THRESHOLD_PX
}

export function shouldRenderMessageMarkdown(message: AIMessage): boolean {
  return message.role === 'assistant' && message.id !== 'streaming' && message.content.length > 0
}
