export function formatCostMicrousd(costMicrousd: number): string {
  const cost = costMicrousd / 1_000_000
  if (cost < 0.0001) return "< $0.0001"
  if (cost < 0.01) return `$${(cost + Number.EPSILON).toFixed(4)}`
  if (cost < 1) return `$${(cost + Number.EPSILON).toFixed(3)}`
  return `$${(cost + Number.EPSILON).toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}
