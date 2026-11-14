// Manifeste des connecteurs LogAssist.
// Un connecteur rattache une ressource externe (dépôt GitHub…) à une
// conversation et fournit des outils bornés au modèle.
// backend :
// - "native" : le réseau est fait par le backend Rust (commandes connector_*) ;
// - "mcp_preset" : réservé à de futurs connecteurs via un serveur MCP
//   (non implémenté en V1, ne doit jamais être utilisé tel quel).
export type ConnectorBackend = "native" | "mcp_preset"

export interface ConnectorManifest {
  /** Identifiant stable, sert de clé dans conversation_connectors (V12). */
  id: string
  /** Libellé affiché dans la galerie des connecteurs. */
  name: string
  backend: ConnectorBackend
  /** Référence Credential Manager — le secret ne vit QUE là. */
  secretRef: string
}

export const CONNECTORS: ConnectorManifest[] = [
  {
    id: "github",
    name: "GitHub",
    backend: "native",
    secretRef: "logassist/connectors/github",
  },
]
