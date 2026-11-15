// Erreurs publiques du connecteur — côté TypeScript (miroir de Rust).
// Chaque kind DOIT avoir sa clé dans src/i18n/fr.ts (connectors.errors.*).

export const CONNECTOR_ERROR_KINDS = [
  "not_configured",
  "auth",
  "forbidden",
  "rate_limit",
  "not_found",
  "too_large",
  "binary",
  "denied_path",
  "offline",
  "timeout",
  "invalid_arguments",
  "unknown",
] as const;

export type ConnectorErrorKind = (typeof CONNECTOR_ERROR_KINDS)[number];

export interface ConnectorErrorPayload {
  kind: ConnectorErrorKind;
  message: string;
}

export function isConnectorError(err: unknown): err is ConnectorErrorPayload {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    "message" in err &&
    CONNECTOR_ERROR_KINDS.includes((err as ConnectorErrorPayload).kind)
  );
}