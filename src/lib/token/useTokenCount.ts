import { useEffect, useMemo, useState } from "react"
import { encoding_for_model, get_encoding, Tiktoken } from "@dqbd/tiktoken"
import { getModelPricing, getTiktokenModel, MODEL_PRICING } from "./pricing"

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
  const [wasmReady, setWasmReady] = useState(false)

  // Initialisation du WASM tiktoken (chargement asynchrone)
  useEffect(() => {
    let mounted = true
    // Force le chargement du WASM en créant un encodeur temporaire
    try {
      const testEnc = encoding_for_model("gpt-4o")
      testEnc.free()
      if (mounted) setWasmReady(true)
    } catch (e) {
      console.error("Failed to initialize tiktoken WASM:", e)
    }
    return () => { mounted = false }
  }, [])

  // Modèle tiktoken à utiliser
  const tiktokenModel = useMemo(
    () => getTiktokenModel(providerId, modelId),
    [providerId, modelId]
  )

  // Instancie l'encodeur (memoized pour éviter réinstanciation)
  const encoder = useMemo((): Tiktoken | null => {
    if (!wasmReady) return null
    try {
      return encoding_for_model(tiktokenModel)
    } catch {
      return get_encoding("cl100k_base")
    }
  }, [tiktokenModel, wasmReady])

  useEffect(() => () => encoder?.free(), [encoder])

  // Pricing
  // Pont de compatibilité de l'ancien compteur cumulatif, supprimé avec ce hook à la tâche UI.
  const pricing = useMemo(
    () => getModelPricing(providerId, modelId) ?? MODEL_PRICING.default.default,
    [providerId, modelId]
  )

  // Comptage tokens (seulement si WASM prêt)
  const { inputTokens, outputTokens } = useMemo(() => {
    if (!encoder) return { inputTokens: 0, outputTokens: 0 }

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
    const inputCost = (inputTokens / 1_000_000) * pricing.input
    const outputCost = (outputTokens / 1_000_000) * pricing.output
    return {
      inputCost,
      outputCost,
      estimatedCost: inputCost + outputCost,
    }
  }, [inputTokens, outputTokens, pricing])

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
    try {
      return enc.encode(text).length
    } finally {
      enc.free()
    }
  } catch {
    const enc = get_encoding("cl100k_base")
    try {
      return enc.encode(text).length
    } finally {
      enc.free()
    }
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
