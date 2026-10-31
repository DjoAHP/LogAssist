export interface KnowledgeSection {
  name: string
  content: string
}

export function buildSystemPrompt(input: {
  general: string
  profile: string
  project?: string
  knowledge?: KnowledgeSection[]
}): string {
  const sections: string[] = []
  if (input.general.trim()) sections.push(`## Instructions générales\n${input.general.trim()}`)
  if (input.profile.trim()) sections.push(`## Profil\n${input.profile.trim()}`)
  if (input.project?.trim()) sections.push(`## Projet\n${input.project.trim()}`)
  // Connaissances activées : intention explicite de l'utilisateur, on les
  // pousse même si les sections de base sont vides.
  for (const k of input.knowledge ?? []) {
    if (k.content.trim()) sections.push(`## Connaissance : ${k.name}\n${k.content.trim()}`)
  }
  return sections.join("\n\n")
}
