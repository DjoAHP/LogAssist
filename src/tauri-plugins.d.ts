declare module "@tauri-apps/plugin-dialog" {
  export interface SaveDialogOptions {
    filters?: Array<{ name: string; extensions: string[] }>
    defaultPath?: string
    title?: string
  }
  export function save(options?: SaveDialogOptions): Promise<string | null>
}

declare module "@tauri-apps/plugin-fs" {
  export function writeTextFile(path: string, content: string): Promise<void>
}