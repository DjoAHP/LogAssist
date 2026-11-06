export const CHAT_BOTTOM_THRESHOLD = 80

interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearChatBottom(metrics: ScrollMetrics): boolean {
  const remaining = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop
  return remaining <= CHAT_BOTTOM_THRESHOLD
}
