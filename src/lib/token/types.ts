export type UsageSource = "provider" | "estimated"

export interface TurnMetrics {
  inputTokens: number
  outputTokens: number
  usageSource: UsageSource
  costMicrousd: number | null
}
