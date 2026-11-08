use std::fmt;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use super::types::{McpAuthConfig, McpAuthStatus, McpErrorKind, McpErrorPayload, McpRuntimeServer};

const SECRET_ENVELOPE_VERSION: u8 = 1;
const MAX_STORED_SECRET_UTF16_BYTES: usize = 2_560;
const TINYFISH_ENDPOINT: &str = "https://agent.tinyfish.ai/mcp";

#[derive(PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEnvelope {
    version: u8,
    config_fingerprint: String,
    secret: String,
}

impl SecretEnvelope {
    pub fn new(server: &McpRuntimeServer, secret: impl Into<String>) -> Self {
        Self {
            version: SECRET_ENVELOPE_VERSION,
            config_fingerprint: binding_fingerprint(server),
            secret: secret.into(),
        }
    }
}

impl fmt::Debug for SecretEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SecretEnvelope")
            .field("version", &self.version)
            .field("config_fingerprint", &self.config_fingerprint)
            .field("secret", &"[rédigé]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoredSecretValidationError {
    Empty,
    TooLarge,
}

pub trait SecretStore: Send + Sync {
    fn get(&self, secret_ref: &str) -> Result<Option<String>, String>;
    fn set(&self, secret_ref: &str, value: &str) -> Result<(), String>;
    fn delete(&self, secret_ref: &str) -> Result<(), String>;
}

pub fn secret_ref_for(server_id: &str) -> String {
    format!("logassist/mcp/{server_id}")
}

fn normalize_endpoint(endpoint: &str) -> String {
    let Ok(mut url) = Url::parse(endpoint) else {
        return endpoint.to_owned();
    };

    let default_port = match url.scheme() {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    };
    if url.port() == default_port {
        let _ = url.set_port(None);
    }

    url.to_string()
}

pub fn binding_fingerprint(server: &McpRuntimeServer) -> String {
    let auth = match &server.auth {
        McpAuthConfig::None => serde_json::json!({"type":"none"}),
        McpAuthConfig::Bearer => serde_json::json!({"type":"bearer"}),
        McpAuthConfig::ApiKey { header } => {
            serde_json::json!({"type":"api_key","header":header.to_ascii_lowercase()})
        }
    };
    let endpoint = normalize_endpoint(&server.endpoint);
    let canonical = serde_json::json!({"id": &server.id, "endpoint": endpoint, "auth": auth});
    let digest = Sha256::digest(serde_json::to_vec(&canonical).expect("canonical JSON"));
    let mut fingerprint = String::with_capacity("sha256:".len() + digest.len() * 2);
    fingerprint.push_str("sha256:");
    for byte in digest {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        fingerprint.push(HEX[(byte >> 4) as usize] as char);
        fingerprint.push(HEX[(byte & 0x0f) as usize] as char);
    }
    fingerprint
}

fn not_configured() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::NotConfigured,
        "Secret MCP absent ou lié à une autre configuration",
    )
}

fn read_store_error() -> McpErrorPayload {
    McpErrorPayload::unknown("Impossible de lire le secret MCP")
}

fn validate_stored_secret(
    secret: &str,
    stored_value: &str,
) -> Result<(), StoredSecretValidationError> {
    if secret.is_empty() {
        return Err(StoredSecretValidationError::Empty);
    }

    match stored_value.encode_utf16().count().checked_mul(2) {
        Some(bytes) if bytes <= MAX_STORED_SECRET_UTF16_BYTES => Ok(()),
        _ => Err(StoredSecretValidationError::TooLarge),
    }
}

fn accepts_legacy_tinyfish_secret(server: &McpRuntimeServer) -> bool {
    server.id == "tinyfish"
        && server.builtin
        && matches!(&server.auth, McpAuthConfig::Bearer)
        && normalize_endpoint(&server.endpoint) == TINYFISH_ENDPOINT
}

pub fn decode_stored_secret(
    server: &McpRuntimeServer,
    stored: &str,
) -> Result<String, McpErrorPayload> {
    match serde_json::from_str::<SecretEnvelope>(stored) {
        Ok(envelope)
            if envelope.version == SECRET_ENVELOPE_VERSION
                && envelope.config_fingerprint == binding_fingerprint(server) =>
        {
            validate_stored_secret(&envelope.secret, stored).map_err(|_| not_configured())?;
            Ok(envelope.secret)
        }
        Ok(_) => Err(not_configured()),
        Err(_) if accepts_legacy_tinyfish_secret(server) => {
            validate_stored_secret(stored, stored).map_err(|_| not_configured())?;
            Ok(stored.to_owned())
        }
        Err(_) => Err(not_configured()),
    }
}

pub fn auth_status<S: SecretStore>(
    store: &S,
    server: &McpRuntimeServer,
) -> Result<McpAuthStatus, McpErrorPayload> {
    if matches!(&server.auth, McpAuthConfig::None) {
        return Ok(McpAuthStatus::NotRequired);
    }

    let Some(stored) = store
        .get(&secret_ref_for(&server.id))
        .map_err(|_| read_store_error())?
    else {
        return Ok(McpAuthStatus::Missing);
    };

    Ok(match decode_stored_secret(server, &stored) {
        Ok(_) => McpAuthStatus::Configured,
        Err(_) => McpAuthStatus::Stale,
    })
}

pub fn read_secret<S: SecretStore>(
    store: &S,
    server: &McpRuntimeServer,
) -> Result<Option<String>, McpErrorPayload> {
    if matches!(&server.auth, McpAuthConfig::None) {
        return Ok(None);
    }

    let stored = store
        .get(&secret_ref_for(&server.id))
        .map_err(|_| read_store_error())?
        .ok_or_else(not_configured)?;

    decode_stored_secret(server, &stored).map(Some)
}

pub fn store_secret<S: SecretStore>(
    store: &S,
    server: &McpRuntimeServer,
    secret: &str,
) -> Result<(), McpErrorPayload> {
    if matches!(&server.auth, McpAuthConfig::None) {
        return Err(McpErrorPayload::new(
            McpErrorKind::InvalidConfig,
            "Ce serveur MCP ne requiert pas de secret",
        ));
    }

    let envelope = SecretEnvelope::new(server, secret);
    let serialized = serde_json::to_string(&envelope)
        .map_err(|_| McpErrorPayload::unknown("Impossible de sérialiser le secret MCP"))?;
    validate_stored_secret(secret, &serialized).map_err(|error| match error {
        StoredSecretValidationError::Empty => McpErrorPayload::new(
            McpErrorKind::InvalidConfig,
            "Le secret MCP ne peut pas être vide",
        ),
        StoredSecretValidationError::TooLarge => McpErrorPayload::new(
            McpErrorKind::InvalidConfig,
            "Le secret MCP dépasse la taille maximale autorisée",
        ),
    })?;

    store
        .set(&secret_ref_for(&server.id), &serialized)
        .map_err(|_| McpErrorPayload::unknown("Impossible d'enregistrer le secret MCP"))
}

pub fn delete_secret<S: SecretStore>(store: &S, server_id: &str) -> Result<(), McpErrorPayload> {
    store
        .delete(&secret_ref_for(server_id))
        .map_err(|_| McpErrorPayload::unknown("Impossible de supprimer le secret MCP"))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;
    use crate::mcp::types::{
        McpAuthConfig, McpAuthStatus, McpErrorKind, McpRuntimeServer, McpRuntimeTool,
        McpTransportKind,
    };

    #[derive(Default)]
    struct MemoryState {
        entries: HashMap<String, String>,
        get_calls: Vec<String>,
        set_calls: Vec<(String, String)>,
        delete_calls: Vec<String>,
        get_error: Option<String>,
        set_error: Option<String>,
        delete_error: Option<String>,
    }

    #[derive(Default)]
    struct MemoryStore {
        state: Mutex<MemoryState>,
    }

    impl MemoryStore {
        fn insert(&self, secret_ref: &str, value: &str) {
            self.state
                .lock()
                .expect("store")
                .entries
                .insert(secret_ref.to_owned(), value.to_owned());
        }

        fn set_get_error(&self, message: &str) {
            self.state.lock().expect("store").get_error = Some(message.to_owned());
        }

        fn set_set_error(&self, message: &str) {
            self.state.lock().expect("store").set_error = Some(message.to_owned());
        }

        fn set_delete_error(&self, message: &str) {
            self.state.lock().expect("store").delete_error = Some(message.to_owned());
        }
    }

    impl SecretStore for MemoryStore {
        fn get(&self, secret_ref: &str) -> Result<Option<String>, String> {
            let mut state = self.state.lock().expect("store");
            state.get_calls.push(secret_ref.to_owned());
            if let Some(message) = &state.get_error {
                return Err(message.clone());
            }
            Ok(state.entries.get(secret_ref).cloned())
        }

        fn set(&self, secret_ref: &str, value: &str) -> Result<(), String> {
            let mut state = self.state.lock().expect("store");
            state
                .set_calls
                .push((secret_ref.to_owned(), value.to_owned()));
            if let Some(message) = &state.set_error {
                return Err(message.clone());
            }
            state
                .entries
                .insert(secret_ref.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, secret_ref: &str) -> Result<(), String> {
            let mut state = self.state.lock().expect("store");
            state.delete_calls.push(secret_ref.to_owned());
            if let Some(message) = &state.delete_error {
                return Err(message.clone());
            }
            state.entries.remove(secret_ref);
            Ok(())
        }
    }

    fn remote_server() -> McpRuntimeServer {
        McpRuntimeServer {
            id: "remote-docs".to_owned(),
            name: "Documentation distante".to_owned(),
            endpoint: "https://mcp.example.com/v1".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned(),
            },
            timeout_ms: 15_000,
            enabled: true,
            builtin: false,
            tools: vec![McpRuntimeTool {
                native_name: "search".to_owned(),
                input_schema: json!({ "type": "object" }),
                enabled: true,
            }],
        }
    }

    fn tinyfish_server() -> McpRuntimeServer {
        McpRuntimeServer {
            id: "tinyfish".to_owned(),
            name: "TinyFish".to_owned(),
            endpoint: "https://agent.tinyfish.ai/mcp".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::Bearer,
            timeout_ms: 30_000,
            enabled: true,
            builtin: true,
            tools: Vec::new(),
        }
    }

    fn envelope(server: &McpRuntimeServer, secret: &str) -> String {
        serde_json::to_string(&SecretEnvelope::new(server, secret)).expect("enveloppe sérialisable")
    }

    const WINDOWS_BLOB_LIMIT_BYTES: usize = 2_560;

    fn utf16_bytes(value: &str) -> usize {
        value
            .encode_utf16()
            .count()
            .checked_mul(size_of::<u16>())
            .expect("taille UTF-16 représentable")
    }

    fn envelope_secret_boundary(server: &McpRuntimeServer, character: &str) -> (String, String) {
        let mut fitting = String::new();
        loop {
            let exceeding = format!("{fitting}{character}");
            if utf16_bytes(&envelope(server, &exceeding)) > WINDOWS_BLOB_LIMIT_BYTES {
                return (fitting, exceeding);
            }
            fitting = exceeding;
        }
    }

    #[test]
    fn secret_ref_uses_the_server_identifier() {
        assert_eq!(secret_ref_for("remote-docs"), "logassist/mcp/remote-docs");
        assert_eq!(secret_ref_for("tinyfish"), "logassist/mcp/tinyfish");
    }

    #[test]
    fn fingerprint_ignores_runtime_and_display_fields_and_header_case() {
        let server = remote_server();
        let expected = binding_fingerprint(&server);
        let mut changed = server.clone();
        changed.name = "Autre nom".to_owned();
        changed.timeout_ms = 99;
        changed.enabled = false;
        changed.builtin = true;
        changed.tools = Vec::new();
        changed.auth = McpAuthConfig::ApiKey {
            header: "x-api-key".to_owned(),
        };

        assert_eq!(binding_fingerprint(&changed), expected);
    }

    #[test]
    fn fingerprint_normalizes_equivalent_https_endpoints() {
        let mut canonical = remote_server();
        canonical.endpoint = "https://mcp.example.com/".to_owned();
        let expected = binding_fingerprint(&canonical);

        for equivalent in [
            "HTTPS://MCP.EXAMPLE.COM",
            "https://mcp.example.com:443",
            "https://MCP.example.COM/",
        ] {
            let mut server = canonical.clone();
            server.endpoint = equivalent.to_owned();
            assert_eq!(binding_fingerprint(&server), expected, "{equivalent}");
        }
    }

    #[test]
    fn fingerprint_falls_back_to_the_raw_invalid_endpoint_without_panicking() {
        let mut server = remote_server();
        server.endpoint = "endpoint invalide".to_owned();
        let fingerprint = binding_fingerprint(&server);

        assert_eq!(binding_fingerprint(&server), fingerprint);
        server.endpoint.push_str(" différent");
        assert_ne!(binding_fingerprint(&server), fingerprint);
    }

    #[test]
    fn fingerprint_changes_with_each_secret_binding_field() {
        let server = remote_server();
        let fingerprint = binding_fingerprint(&server);

        let mut changed_id = server.clone();
        changed_id.id = "other-id".to_owned();
        assert_ne!(binding_fingerprint(&changed_id), fingerprint);

        let mut changed_endpoint = server.clone();
        changed_endpoint.endpoint = "https://other.example.com/mcp".to_owned();
        assert_ne!(binding_fingerprint(&changed_endpoint), fingerprint);

        let mut changed_auth_type = server.clone();
        changed_auth_type.auth = McpAuthConfig::Bearer;
        assert_ne!(binding_fingerprint(&changed_auth_type), fingerprint);

        let mut changed_header = server.clone();
        changed_header.auth = McpAuthConfig::ApiKey {
            header: "Authorization".to_owned(),
        };
        assert_ne!(binding_fingerprint(&changed_header), fingerprint);
    }

    #[test]
    fn fingerprint_has_a_lowercase_sha256_format() {
        let fingerprint = binding_fingerprint(&remote_server());
        let digest = fingerprint.strip_prefix("sha256:").expect("préfixe sha256");

        assert_eq!(digest.len(), 64);
        assert!(
            digest
                .chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
        );
    }

    #[test]
    fn envelope_round_trip_returns_the_original_secret() {
        let server = remote_server();
        let stored = envelope(&server, "  secret exact  ");

        assert_eq!(
            decode_stored_secret(&server, &stored).expect("enveloppe valide"),
            "  secret exact  "
        );
    }

    #[test]
    fn new_envelope_serializes_and_decodes_the_original_secret() {
        let server = remote_server();
        let envelope = SecretEnvelope::new(&server, "constructor-secret");
        let stored = serde_json::to_string(&envelope).expect("enveloppe sérialisable");

        assert_eq!(
            decode_stored_secret(&server, &stored).expect("enveloppe valide"),
            "constructor-secret"
        );
    }

    #[test]
    fn envelope_debug_always_redacts_the_secret() {
        let server = remote_server();
        let secret = "debug-secret-must-not-appear";
        let envelope = SecretEnvelope::new(&server, secret);

        let debug = format!("{envelope:?}");

        assert!(debug.contains("version: 1"));
        assert!(debug.contains(&binding_fingerprint(&server)));
        assert!(debug.contains("secret: \"[rédigé]\""));
        assert!(!debug.contains(secret));
    }

    #[test]
    fn decode_rejects_an_envelope_with_an_empty_secret() {
        let server = remote_server();
        let stored = envelope(&server, "");

        assert_eq!(
            decode_stored_secret(&server, &stored)
                .expect_err("secret vide")
                .kind,
            McpErrorKind::NotConfigured
        );
    }

    #[test]
    fn decode_rejects_an_envelope_over_the_windows_blob_limit() {
        let server = remote_server();
        let (_, exceeding) = envelope_secret_boundary(&server, "x");
        let stored = envelope(&server, &exceeding);
        assert!(utf16_bytes(&stored) > WINDOWS_BLOB_LIMIT_BYTES);

        assert_eq!(
            decode_stored_secret(&server, &stored)
                .expect_err("enveloppe trop volumineuse")
                .kind,
            McpErrorKind::NotConfigured
        );
    }

    #[test]
    fn envelope_with_another_version_is_stale_and_never_exposes_its_secret() {
        let server = remote_server();
        let secret = "secret-version-stale";
        let stored = serde_json::to_string(&SecretEnvelope {
            version: 2,
            config_fingerprint: binding_fingerprint(&server),
            secret: secret.to_owned(),
        })
        .expect("enveloppe sérialisable");

        let error = decode_stored_secret(&server, &stored).expect_err("version obsolète");
        assert_eq!(error.kind, McpErrorKind::NotConfigured);
        assert!(!error.message.contains(secret));
    }

    #[test]
    fn envelope_bound_to_another_configuration_is_stale() {
        let server = remote_server();
        let stored = serde_json::to_string(&SecretEnvelope {
            version: 1,
            config_fingerprint: "sha256:wrong".to_owned(),
            secret: "must-not-escape".to_owned(),
        })
        .expect("enveloppe sérialisable");

        let error = decode_stored_secret(&server, &stored).expect_err("empreinte obsolète");
        assert_eq!(error.kind, McpErrorKind::NotConfigured);
        assert!(!error.message.contains("must-not-escape"));
    }

    #[test]
    fn raw_legacy_secret_is_accepted_only_for_tinyfish() {
        assert_eq!(
            decode_stored_secret(&tinyfish_server(), "legacy-tinyfish-key")
                .expect("migration TinyFish"),
            "legacy-tinyfish-key"
        );

        let error = decode_stored_secret(&remote_server(), "legacy-remote-key")
            .expect_err("secret brut distant refusé");
        assert_eq!(error.kind, McpErrorKind::NotConfigured);
        assert!(!error.message.contains("legacy-remote-key"));
    }

    #[test]
    fn raw_legacy_secret_requires_the_closed_builtin_tinyfish_identity() {
        let secret = "legacy-tinyfish-key";
        let mut not_builtin = tinyfish_server();
        not_builtin.builtin = false;
        let mut wrong_endpoint = tinyfish_server();
        wrong_endpoint.endpoint = "https://other.example.com/mcp".to_owned();
        let mut wrong_auth = tinyfish_server();
        wrong_auth.auth = McpAuthConfig::ApiKey {
            header: "X-API-Key".to_owned(),
        };

        for server in [not_builtin, wrong_endpoint, wrong_auth] {
            assert_eq!(
                decode_stored_secret(&server, secret)
                    .expect_err("identité TinyFish non fermée")
                    .kind,
                McpErrorKind::NotConfigured
            );
        }
    }

    #[test]
    fn raw_legacy_tinyfish_accepts_a_normalized_canonical_endpoint() {
        let mut server = tinyfish_server();
        server.endpoint = "HTTPS://AGENT.TINYFISH.AI:443/mcp".to_owned();

        assert_eq!(
            decode_stored_secret(&server, "legacy-key").expect("endpoint canonique"),
            "legacy-key"
        );
    }

    #[test]
    fn raw_legacy_tinyfish_rejects_empty_and_oversized_values() {
        let server = tinyfish_server();
        assert_eq!(
            decode_stored_secret(&server, "")
                .expect_err("secret vide")
                .kind,
            McpErrorKind::NotConfigured
        );

        let largest = "x".repeat(WINDOWS_BLOB_LIMIT_BYTES / size_of::<u16>());
        assert_eq!(utf16_bytes(&largest), WINDOWS_BLOB_LIMIT_BYTES);
        assert_eq!(
            decode_stored_secret(&server, &largest).expect("borne incluse"),
            largest
        );

        let oversized = format!("{largest}x");
        assert!(utf16_bytes(&oversized) > WINDOWS_BLOB_LIMIT_BYTES);
        assert_eq!(
            decode_stored_secret(&server, &oversized)
                .expect_err("secret trop volumineux")
                .kind,
            McpErrorKind::NotConfigured
        );
    }

    #[test]
    fn unusual_legacy_json_is_still_a_raw_tinyfish_secret() {
        let stored = r#"{"legacy":"strange-json-secret"}"#;

        assert_eq!(
            decode_stored_secret(&tinyfish_server(), stored).expect("migration TinyFish"),
            stored
        );
        assert_eq!(
            decode_stored_secret(&remote_server(), stored)
                .expect_err("JSON hors enveloppe refusé")
                .kind,
            McpErrorKind::NotConfigured
        );
    }

    #[test]
    fn auth_status_is_not_required_without_reading_the_store() {
        let store = MemoryStore::default();
        let mut server = remote_server();
        server.auth = McpAuthConfig::None;

        assert_eq!(
            auth_status(&store, &server).expect("statut"),
            McpAuthStatus::NotRequired
        );
        assert!(store.state.lock().expect("store").get_calls.is_empty());
    }

    #[test]
    fn auth_status_is_missing_when_the_store_has_no_entry() {
        let store = MemoryStore::default();
        let server = remote_server();

        assert_eq!(
            auth_status(&store, &server).expect("statut"),
            McpAuthStatus::Missing
        );
    }

    #[test]
    fn auth_status_is_configured_for_a_valid_envelope() {
        let store = MemoryStore::default();
        let server = remote_server();
        store.insert(&secret_ref_for(&server.id), &envelope(&server, "valid-key"));

        assert_eq!(
            auth_status(&store, &server).expect("statut"),
            McpAuthStatus::Configured
        );
    }

    #[test]
    fn auth_status_is_stale_for_an_invalid_entry() {
        let store = MemoryStore::default();
        let server = remote_server();
        store.insert(&secret_ref_for(&server.id), "invalid-remote-entry");

        assert_eq!(
            auth_status(&store, &server).expect("statut"),
            McpAuthStatus::Stale
        );
    }

    #[test]
    fn empty_and_oversized_envelopes_are_stale_and_unreadable() {
        let server = remote_server();
        let (_, exceeding) = envelope_secret_boundary(&server, "x");

        for stored in [envelope(&server, ""), envelope(&server, &exceeding)] {
            let store = MemoryStore::default();
            store.insert(&secret_ref_for(&server.id), &stored);

            assert_eq!(
                auth_status(&store, &server).expect("statut"),
                McpAuthStatus::Stale
            );
            assert_eq!(
                read_secret(&store, &server)
                    .expect_err("secret invalide")
                    .kind,
                McpErrorKind::NotConfigured
            );
        }
    }

    #[test]
    fn auth_status_maps_store_failures_to_a_generic_unknown_error() {
        let store = MemoryStore::default();
        let server = remote_server();
        store.set_get_error("backend leaked stored-secret-value");

        let error = auth_status(&store, &server).expect_err("lecture en échec");
        assert_eq!(error.kind, McpErrorKind::Unknown);
        assert!(!error.message.contains("stored-secret-value"));
    }

    #[test]
    fn read_secret_returns_none_for_auth_none_without_store_access() {
        let store = MemoryStore::default();
        let mut server = remote_server();
        server.auth = McpAuthConfig::None;

        assert_eq!(read_secret(&store, &server).expect("sans auth"), None);
        assert!(store.state.lock().expect("store").get_calls.is_empty());
    }

    #[test]
    fn read_secret_returns_the_decoded_valid_secret() {
        let store = MemoryStore::default();
        let server = remote_server();
        store.insert(
            &secret_ref_for(&server.id),
            &envelope(&server, "decoded-secret"),
        );

        assert_eq!(
            read_secret(&store, &server).expect("secret valide"),
            Some("decoded-secret".to_owned())
        );
    }

    #[test]
    fn read_secret_reports_not_configured_for_missing_or_stale_values() {
        let missing_store = MemoryStore::default();
        let server = remote_server();
        assert_eq!(
            read_secret(&missing_store, &server)
                .expect_err("secret absent")
                .kind,
            McpErrorKind::NotConfigured
        );

        let stale_store = MemoryStore::default();
        stale_store.insert(&secret_ref_for(&server.id), "stale-remote-secret");
        let error = read_secret(&stale_store, &server).expect_err("secret obsolète");
        assert_eq!(error.kind, McpErrorKind::NotConfigured);
        assert!(!error.message.contains("stale-remote-secret"));
    }

    #[test]
    fn store_secret_writes_a_bound_envelope_under_the_derived_reference() {
        let store = MemoryStore::default();
        let server = remote_server();
        let secret = "  exact-key-with-spaces  ";

        store_secret(&store, &server, secret).expect("écriture");

        let state = store.state.lock().expect("store");
        assert_eq!(state.set_calls.len(), 1);
        let (stored_ref, stored_value) = &state.set_calls[0];
        assert_eq!(stored_ref, "logassist/mcp/remote-docs");
        let stored: SecretEnvelope = serde_json::from_str(stored_value).expect("enveloppe JSON");
        assert_eq!(stored.version, 1);
        assert_eq!(stored.config_fingerprint, binding_fingerprint(&server));
        assert_eq!(stored.secret, secret);
    }

    #[test]
    fn store_secret_refuses_auth_none_without_writing() {
        let store = MemoryStore::default();
        let mut server = remote_server();
        server.auth = McpAuthConfig::None;

        let error = store_secret(&store, &server, "unused").expect_err("auth absente");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
        assert!(store.state.lock().expect("store").set_calls.is_empty());
    }

    #[test]
    fn store_secret_refuses_an_empty_secret_without_writing() {
        let store = MemoryStore::default();

        let error = store_secret(&store, &remote_server(), "").expect_err("secret vide");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
        assert!(store.state.lock().expect("store").set_calls.is_empty());
    }

    #[test]
    fn store_secret_enforces_the_exact_envelope_limit_for_ascii() {
        let store = MemoryStore::default();
        let server = remote_server();
        let (largest, exceeding) = envelope_secret_boundary(&server, "x");

        assert!(utf16_bytes(&envelope(&server, &largest)) <= WINDOWS_BLOB_LIMIT_BYTES);
        assert!(utf16_bytes(&envelope(&server, &exceeding)) > WINDOWS_BLOB_LIMIT_BYTES);
        store_secret(&store, &server, &largest).expect("borne incluse");

        let error =
            store_secret(&store, &server, &exceeding).expect_err("caractère au-delà de la limite");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
        assert_eq!(store.state.lock().expect("store").set_calls.len(), 1);
    }

    #[test]
    fn store_secret_counts_multi_unit_unicode_in_the_envelope_limit() {
        let store = MemoryStore::default();
        let server = remote_server();
        let (largest, exceeding) = envelope_secret_boundary(&server, "🦀");

        assert!(utf16_bytes(&envelope(&server, &largest)) <= WINDOWS_BLOB_LIMIT_BYTES);
        assert!(utf16_bytes(&envelope(&server, &exceeding)) > WINDOWS_BLOB_LIMIT_BYTES);
        store_secret(&store, &server, &largest).expect("borne Unicode incluse");

        let error = store_secret(&store, &server, &exceeding)
            .expect_err("caractère Unicode au-delà de la limite");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
        assert_eq!(store.state.lock().expect("store").set_calls.len(), 1);
    }

    #[test]
    fn store_secret_replaces_a_backend_envelope_error_with_a_controlled_message() {
        let store = MemoryStore::default();
        let server = remote_server();
        let secret = "quote:\" backslash:\\ newline:\nend";
        let leaked_envelope = envelope(&server, secret);
        store.set_set_error(&leaked_envelope);

        let error = store_secret(&store, &server, secret).expect_err("écriture en échec");
        assert_eq!(error.kind, McpErrorKind::Unknown);
        assert_eq!(error.message, "Impossible d'enregistrer le secret MCP");
        assert!(!error.message.contains(secret));
        assert!(!error.message.contains(&leaked_envelope));
        assert!(!error.message.contains("configFingerprint"));
        assert!(!error.message.contains("quote"));
        assert!(!error.message.contains("\\n"));
    }

    #[test]
    fn delete_secret_delegates_the_derived_reference_idempotently() {
        let store = MemoryStore::default();
        store.insert("logassist/mcp/remote-docs", "value");

        delete_secret(&store, "remote-docs").expect("première suppression");
        delete_secret(&store, "remote-docs").expect("seconde suppression");

        assert_eq!(
            store.state.lock().expect("store").delete_calls,
            vec![
                "logassist/mcp/remote-docs".to_owned(),
                "logassist/mcp/remote-docs".to_owned()
            ]
        );
    }

    #[test]
    fn delete_secret_maps_store_failures_to_a_generic_unknown_error() {
        let store = MemoryStore::default();
        store.set_delete_error("backend leaked secret-on-delete");

        let error = delete_secret(&store, "remote-docs").expect_err("suppression en échec");
        assert_eq!(error.kind, McpErrorKind::Unknown);
        assert!(!error.message.contains("secret-on-delete"));
    }
}
