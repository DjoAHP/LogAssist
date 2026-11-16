// Moteur updater : point UNIQUE de gestion des mises à jour.
// App.tsx possède le hook ; bannière header et panneau réglages sont des
// consommateurs de l'état (jamais de seconde instance = jamais de check
// concurrent). Le réseau, la vérification de signature et l'installation
// appartiennent au plugin Rust — le hook ne fait que l'orchestrer.
// Invariant Windows : downloadAndInstall quitte l'app après le lancement
// de l'installateur ; le relance() qui suit n'est atteint que sur
// macOS/Linux (hors périmètre, conservé pour la correction de l'état).
import { useCallback, useEffect, useRef, useState } from "react"
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; received: number; total: number | null }
  | { phase: "ready"; version: string }
  | { phase: "upToDate" }
  | { phase: "error"; operation: "check" | "install" }

const GRACE_DELAY_MS = 15_000

export function useUpdater(options?: { graceDelayMs?: number }) {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" })
  const updateRef = useRef<Update | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  // Lu par rendu (pas au niveau module) pour rester testable via vi.stubEnv.
  const enabled = import.meta.env.PROD

  const runCheck = useCallback(
    async (silent: boolean): Promise<void> => {
      if (!enabled || busyRef.current) return
      busyRef.current = true
      if (!silent && mountedRef.current) setState({ phase: "checking" })
      try {
        const update = await check()
        updateRef.current = update
        if (!mountedRef.current) return
        if (update) {
          setState({ phase: "available", version: update.version })
        } else if (!silent) {
          setState({ phase: "upToDate" })
        }
      } catch {
        if (mountedRef.current) {
          setState(silent ? { phase: "idle" } : { phase: "error", operation: "check" })
        }
      } finally {
        busyRef.current = false
      }
    },
    [enabled],
  )

  const checkNow = useCallback(() => runCheck(false), [runCheck])

  const install = useCallback(async (): Promise<void> => {
    const update = updateRef.current
    if (!update || busyRef.current) return
    busyRef.current = true
    setState((prev) =>
      prev.phase === "available"
        ? { phase: "downloading", version: prev.version, received: 0, total: null }
        : prev,
    )
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (!mountedRef.current) return
        setState((prev) => {
          if (prev.phase !== "downloading") return prev
          if (event.event === "Started") {
            return { ...prev, total: event.data.contentLength ?? null }
          }
          if (event.event === "Progress") {
            return { ...prev, received: prev.received + event.data.chunkLength }
          }
          return prev
        })
      })
      if (!mountedRef.current) return
      setState({ phase: "ready", version: update.version })
      await relaunch()
    } catch {
      if (mountedRef.current) setState({ phase: "error", operation: "install" })
    } finally {
      busyRef.current = false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) return
    const timer = setTimeout(() => {
      void runCheck(true)
    }, options?.graceDelayMs ?? GRACE_DELAY_MS)
    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [enabled, runCheck, options?.graceDelayMs])

  return { state, checkNow, install }
}
