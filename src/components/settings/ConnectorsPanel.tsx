// Panneau « Connecteurs » : galerie de tuiles carrées (coins légèrement arrondis),
// icône + nom dessous, badge d'état (texte + icône + couleur).
import { GithubConnecteurIcon } from "@/icons"
import { t } from "@/i18n/fr"

export interface ConnectorStatus {
  configured: boolean
  login: string | null
}

export interface ConnectorsPanelProps {
  statuses: { github: ConnectorStatus }
  onSelect: (connectorId: string) => void
}

const CONNECTORS = [
  {
    id: "github" as const,
    name: t.connectors.github,
    icon: GithubConnecteurIcon,
  },
] as const

function statusBadge(status: ConnectorStatus) {
  if (!status.configured) {
    return (
      <span
        data-testid="connector-status"
        className="text-xs text-muted-foreground"
      >
        {t.connectors.status.notConfigured}
      </span>
    )
  }
  return (
    <span
      data-testid="connector-status"
      className="text-xs text-green-600 dark:text-green-400"
    >
      {status.login
        ? t.connectors.status.connected.replace("{login}", status.login)
        : t.connectors.status.connectedUnknown}
    </span>
  )
}

export function ConnectorsPanel({ statuses, onSelect }: ConnectorsPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {CONNECTORS.map((connector) => (
        <button
          key={connector.id}
          role="button"
          aria-label={connector.name}
          data-connector-id={connector.id}
          onClick={() => onSelect(connector.id)}
          className={[
            "group relative aspect-square rounded-lg border border-border bg-background",
            "flex flex-col items-center justify-center gap-2 p-4",
            "hover:border-brand-from/50 focus-visible:ring-2 focus-visible:ring-brand-to",
            "transition-colors",
          ].join(" ")}
        >
          <connector.icon className="size-8 text-foreground group-hover:text-brand-from transition-colors" aria-hidden="true" />
          <span className="text-sm font-medium text-center">{connector.name}</span>
          {statusBadge(statuses[connector.id])}
        </button>
      ))}
    </div>
  )
}
