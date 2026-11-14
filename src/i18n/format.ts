// Remplacement de jetons {clé} par les valeurs fournies — i18n sans dépendance.
// Un jeton sans valeur fournie reste intact (échec visible plutôt que masqué).
export function formatTemplate<T extends object>(
  template: string,
  values: T,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (token, key: string) => {
    const value = (values as Record<string, string | number | undefined>)[key]
    return value === undefined ? token : String(value)
  })
}
