export const fr = {
  app: { title: "LogAssist", subtitle: "Assistant IA pour apprendre des logiciels" },
  sidebar: {
    newConversation: "Nouvelle conversation",
    search: "Rechercher…",
    general: "Générales",
    rename: "Renommer",
    archive: "Archiver",
    delete: "Supprimer",
  },
  chat: {
    placeholder: "Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)",
    send: "Envoyer",
    stop: "Interrompre",
    copy: "Copier",
    regenerate: "Régénérer",
    noConversation: "Sélectionnez ou créez une conversation",
    interrupted: "Interrompu",
    configureProvider: "Configurez un fournisseur dans les réglages (prochaine étape) pour discuter.",
  },
  errors: {
    auth: "Clé API invalide ou expirée",
    modelNotfound: "Modèle inexistant chez ce fournisseur",
    network: "Fournisseur injoignable — vérifiez l'URL et votre connexion",
    rateLimit: "Limite de débit atteinte",
    quota: "Quota ou crédit épuisé",
    unavailable: "Service momentanément indisponible",
    imageUnsupported: "Images non supportées par ce modèle",
    unknown: "Erreur inattendue du fournisseur",
  },
} as const

export type Dict = typeof fr
export const t = fr // point d'entrée unique (i18n complet en V1.1)
