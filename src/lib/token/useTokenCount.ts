import { useMemo } from "react"
import { encoding_for_model, get_encoding, Tiktoken } from "@dqbd/tiktoken"
import { getModelPricing, getTiktokenModel } from "./pricing"

interface TokenCountResult {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number  // en USD
  inputCost: number
  outputCost: number
}

/**
 * Hook pour compter les tokens et estimer le coût.
 * Utilise tiktoken (WASM) côté client — pas d'appel réseau.
 */
export function useTokenCount(
  providerId: string,
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string = "",
  knowledgeContent: string = ""
): TokenCountResult {
  // Modèle tiktoken à utiliser
  const tiktokenModel = useMemo(
    () => getTiktokenModel(providerId, modelId),
    [providerId, modelId]
  )

  // Instancie l'encodeur (memoized pour éviter réinstanciation)
  const encoder = useMemo((): Tiktoken => {
    try {
      return encoding_for_model(tiktokenModel)
    } catch {
      return get_encoding("cl100k_base")
    }
  }, [tiktokenModel])

  // Pricing
  const pricing = useMemo(
    () => getModelPricing(providerId, modelId),
    [providerId, modelId]
  )

  // Comptage tokens
  const { inputTokens, outputTokens } = useMemo(() => {
    let input = 0
    let output = 0

    // System prompt
    if (systemPrompt) {
      input += encoder.encode(systemPrompt).length
    }

    // Knowledge
    if (knowledgeContent) {
      input += encoder.encode(knowledgeContent).length
    }

    // Messages
    for (const msg of messages) {
      const tokens = encoder.encode(msg.content).length
      if (msg.role === "assistant") {
        output += tokens
      } else {
        input += tokens
      }
    }

    return { inputTokens: input, outputTokens: output }
  }, [encoder, messages, systemPrompt, knowledgeContent])

  // Calcul coût
  const { inputCost, outputCost, estimatedCost } = useMemo(() => {
    const inputCost = (inputTokens / 1000) * pricing.input
    const outputCost = (outputTokens / 1000) * pricing.output
    return {
      inputCost,
      outputCost,
      estimatedCost: inputCost + outputCost,
    }
  }, [inputTokens, outputTokens, pricing])

  // Nettoyage de l'encodeur au démontage
  // (tiktoken utilise WASM, nettoyage manuel recommandé)
  // Note: on ne peut pas facilement disposer l'encoder ici car useMemo
  // Le GC gérera, mais pour production on pourrait faire un useEffect cleanup

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
    inputCost,
    outputCost,
  }
}

/**
 * Version simple pour un seul texte (ex: preview avant envoi)
 */
export function countTokens(text: string, model: string = "gpt-4o"): number {
  try {
    const enc = encoding_for_model(model as any)
    const count = enc.encode(text).length
    enc.free()
    return count
  } catch {
    const enc = get_encoding("cl100k_base")
    const count = enc.encode(text).length
    enc.free()
    return count
  }
}

/**
 * Formate un coût en USD pour affichage
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001) return "< $0.0001"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/**
 * Formate un nombre de tokens pour affichage
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}