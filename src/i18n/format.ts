// Remplacement de jetons {clé} par les valeurs fournies — i18n sans dépendance.
// Un jeton sans valeur fournie reste intact (échec visible plutôt que masqué).
export function formatTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (token, key: string) => {
    const value = values[key]
    return value === undefined ? token : String(value)
  })
}
