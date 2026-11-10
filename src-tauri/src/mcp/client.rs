//! Couche service MCP : orchestre le registre, le pool de connexions et le
//! coffre à secrets. Aucun transport réel ici : la connexion est déléguée au
//! pool (`transport.rs`), le secret au `SecretStore`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::credentials;
pub use super::credentials::SecretStore;
use super::registry::{CallScope, McpState, RegistrySyncResult, TurnHandle};
use super::security::{tinyfish_arguments, validate_tool_arguments};
use super::transport::{McpConnectionPool, discover_tools_bounded, normalize_tool_result};
use super::types::{
    McpAuthStatus, McpErrorKind, McpErrorPayload, McpRuntimeServer, McpRuntimeTool,
    McpToolDescriptor, McpToolResult,
};

/// Borne de la validation JSON des arguments (hors thread async).
pub const ARGUMENT_VALIDATION_TIMEOUT_MS: u64 = 100;
/// Timeout imposé par le contrat TinyFish search (indépendant de la config).
pub const SEARCH_TIMEOUT_MS: u64 = 15_000;
/// Timeout imposé par le contrat TinyFish fetch_content.
pub const FETCH_TIMEOUT_MS: u64 = 120_000;

/// Valide les arguments contre le schéma déclaré du serveur. La validation est
/// déléguée à un thread bloquant et bornée : un schéma hostile (profondeur,
/// patterns) ne peut pas bloquer le runtime async plus de 100 ms.
///
/// Invariant : en cas de dépassement, le thread bloquant résiduel n'est pas
/// interrompu — il se termine sur son terme naturel et son résultat est jeté.
/// L'abandon est acceptable : son entrée est déjà bornée par
/// `validate_argument_object` (≤ MAX_ARGUMENT_BYTES, profondeur ≤
/// MAX_ARGUMENT_DEPTH), donc son coût CPU reste fini et le runtime n'est plus
/// sollicité après l'abandon.
async fn validate_arguments(schema: &Value, arguments: &Value) -> Result<(), McpErrorPayload> {
    let schema = schema.clone();
    let arguments = arguments.clone();
    let outcome = tokio::time::timeout(
        Duration::from_millis(ARGUMENT_VALIDATION_TIMEOUT_MS),
        tokio::task::spawn_blocking(move || validate_tool_arguments(&schema, &arguments)),
    )
    .await;
    match outcome {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err(McpErrorPayload::new(
            McpErrorKind::InvalidArguments,
            "Validation des arguments MCP interrompue",
        )),
        Err(_) => Err(McpErrorPayload::new(
            McpErrorKind::InvalidArguments,
            "Validation des arguments MCP trop longue",
        )),
    }
}

/// Filtre le catalogue TinyFish sur l'allowlist stricte search/fetch_content.
/// L'absence d'un outil requis rend le serveur inutilisable.
fn restrict_tinyfish_tools(
    tools: Vec<McpToolDescriptor>,
) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
    const REQUIRED_TOOLS: [&str; 2] = ["search", "fetch_content"];

    let filtered: Vec<_> = tools
        .into_iter()
        .filter(|tool| REQUIRED_TOOLS.contains(&tool.native_name.as_str()))
        .collect();
    for required in REQUIRED_TOOLS {
        if !filtered.iter().any(|tool| tool.native_name == required) {
            return Err(McpErrorPayload::new(
                McpErrorKind::InvalidResponse,
                format!("Outil TinyFish requis absent : {required}"),
            ));
        }
    }
    Ok(filtered)
}

/// Service MCP générique : une instance par application, gérée par Tauri.
pub struct McpService<S: SecretStore> {
    state: Arc<McpState>,
    pool: Arc<McpConnectionPool>,
    store: Arc<S>,
    /// Handles de tours suivis par identifiant : l'annulation cible le tour
    /// courant et un même tour enchaîne plusieurs appels. Les identifiants
    /// sont posés par l'orchestrateur (uniques par tour assistant) ou formés
    /// `manual:{id}` côté outils de test.
    turns: Mutex<HashMap<String, TurnHandle>>,
    /// Révision interne du registre : chaque sync publié augmente ce compteur.
    /// La commande React `mcp_sync_registry` ne porte pas de révision.
    next_revision: AtomicU64,
}

impl<S: SecretStore> McpService<S> {
    pub fn new(state: Arc<McpState>, pool: Arc<McpConnectionPool>, store: Arc<S>) -> Self {
        // La révision 0 n'est jamais valide (validate_revision la refuse) :
        // le registre naît à last_revision 0 et la première sync publiée
        // porte la révision 1.
        Self {
            state,
            pool,
            store,
            turns: Mutex::new(HashMap::new()),
            next_revision: AtomicU64::new(0),
        }
    }

    /// Reprend le handle courant du tour, ou l'enregistre au registre lors du
    /// premier appel. Retourne une erreur registre (doublon, limite de tours).
    fn turn_handle(&self, turn_id: &str) -> Result<TurnHandle, McpErrorPayload> {
        let mut turns = self.turns.lock().expect("verrou des tours MCP");
        if let Some(handle) = turns.get(turn_id) {
            return Ok(handle.clone());
        }
        let handle = self.state.begin_turn(turn_id)?;
        turns.insert(turn_id.to_owned(), handle.clone());
        Ok(handle)
    }

    /// Annule tous les appels en cours du tour. Idempotent : un tour inconnu
    /// (ou non ouvert) est un no-op sans erreur.
    pub fn cancel_turn(&self, turn_id: &str) -> Result<(), McpErrorPayload> {
        let turns = self.turns.lock().expect("verrou des tours MCP");
        if let Some(handle) = turns.get(turn_id) {
            self.state.cancel_turn(handle);
        }
        Ok(())
    }

    /// Clôt le tour côté registre (`TurnState` retiré, budget `MAX_ACTIVE_TURNS`
    /// restitué) : sans fin de tour, le plafond 1024 finit par refuser tout
    /// nouveau tour. La libération est celle déjà exposée par le registre :
    /// les appels encore ouverts voient leur jeton annulé, leurs CallPermit
    /// restent couverts par leur garde — sans suppression agressive. Appelé
    /// par React à la fin de chaque tour de chat. Idempotent : un tour
    /// inconnu (annulé, terminé, jamais ouvert) est un no-op sans erreur.
    pub fn finish_turn(&self, turn_id: &str) -> Result<(), McpErrorPayload> {
        let mut turns = self.turns.lock().expect("verrou des tours MCP");
        if let Some(handle) = turns.remove(turn_id) {
            self.state.finish_turn(&handle);
        }
        Ok(())
    }

    /// Publie la liste courante des serveurs et coupe les sessions des serveurs
    /// dont la liaison a changé ou disparu.
    pub async fn sync_registry(
        &self,
        servers: Vec<McpRuntimeServer>,
    ) -> Result<RegistrySyncResult, McpErrorPayload> {
        let revision = self.next_revision.fetch_add(1, Ordering::AcqRel) + 1;
        let result = self.state.sync(revision, servers)?;
        let changed: Vec<String> = result
            .changed
            .iter()
            .map(|change| change.server_id.clone())
            .collect();
        self.pool.disconnect_many(&changed).await;
        Ok(result)
    }

    /// Configure une clé : elle est testée EN MÉMOIRE avant écriture. Un
    /// échec ne remplace jamais la clé existante (remplacement transactionnel).
    pub async fn configure_auth(
        &self,
        server_id: &str,
        candidate: &str,
    ) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
        let server = self.state.server(server_id)?;
        let session = self
            .pool
            .connect_candidate(&server, candidate)
            .await
            .map_err(|error| error.redact(candidate))?;
        let discovered = match discover_tools_bounded(session.as_ref()).await {
            Ok(tools) if server.id == "tinyfish" => restrict_tinyfish_tools(tools),
            Ok(tools) => Ok(tools),
            Err(error) => Err(error),
        };
        let discovered = match discovered {
            Ok(tools) => tools,
            Err(error) => {
                session.close().await;
                return Err(error.redact(candidate));
            }
        };
        if let Err(error) = credentials::store_secret(self.store.as_ref(), &server, candidate) {
            session.close().await;
            return Err(error);
        }
        // La session validée devient la session du pool : zéro reconnexion.
        self.pool
            .install(
                server_id,
                &credentials::binding_fingerprint(&server),
                session,
            )
            .await;
        Ok(discovered)
    }

    /// Détaille le catalogue du serveur. Une session morte (Offline/Protocol)
    /// est reconstruite une seule fois ; la seconde erreur est propagée.
    pub async fn discover(
        &self,
        server_id: &str,
    ) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
        let server = self.state.server(server_id)?;
        let secret = credentials::read_secret(self.store.as_ref(), &server)?;
        let session = self.pool.session(&server, secret.as_deref()).await?;
        let discovered = match discover_tools_bounded(session.as_ref()).await {
            Ok(tools) => Ok(tools),
            Err(first_error)
                if matches!(
                    first_error.kind,
                    McpErrorKind::Offline | McpErrorKind::Protocol
                ) =>
            {
                self.pool.disconnect(server_id).await;
                let replacement = self.pool.session(&server, secret.as_deref()).await?;
                discover_tools_bounded(replacement.as_ref()).await
            }
            Err(error) => Err(error),
        };
        let discovered = discovered?;
        if server.id == "tinyfish" {
            restrict_tinyfish_tools(discovered)
        } else {
            Ok(discovered)
        }
    }

    /// Exécute un appel d'outil : allowlist (registre), validation bornée des
    /// arguments, secret, session du pool, timeout par outil et annulation.
    pub async fn call_tool(
        &self,
        server_id: &str,
        turn_id: &str,
        call_id: &str,
        native_name: &str,
        arguments: Value,
        scope: CallScope,
    ) -> Result<McpToolResult, McpErrorPayload> {
        let handle = self.turn_handle(turn_id)?;
        let permit = self
            .state
            .begin_call(&handle, call_id, server_id, native_name, scope)?;
        let server = Arc::clone(&permit.server);
        let tool = permit.tool.clone();
        let token = permit.token.clone();
        let outcome = self
            .run_call(&server, &tool, native_name, arguments, &token)
            .await;
        // Le permis retombe : l'entrée d'appel est retirée, succès ou erreur.
        drop(permit);
        // Session invalide après Timeout/Offline/Cancelled : la prochaine
        // requête repart d'une connexion propre.
        if let Err(error) = &outcome
            && matches!(
                error.kind,
                McpErrorKind::Timeout | McpErrorKind::Offline | McpErrorKind::Cancelled
            )
        {
            self.pool.disconnect(server_id).await;
        }
        outcome
    }

    async fn run_call(
        &self,
        server: &McpRuntimeServer,
        tool: &McpRuntimeTool,
        native_name: &str,
        arguments: Value,
        token: &CancellationToken,
    ) -> Result<McpToolResult, McpErrorPayload> {
        validate_arguments(&tool.input_schema, &arguments).await?;
        let secret = credentials::read_secret(self.store.as_ref(), server)?;
        let session = self.pool.session(server, secret.as_deref()).await?;
        let call_arguments = if server.id == "tinyfish" {
            tinyfish_arguments(native_name, &arguments)?
        } else {
            arguments.as_object().cloned().ok_or_else(|| {
                McpErrorPayload::new(McpErrorKind::InvalidArguments, "Arguments MCP invalides")
            })?
        };
        // Les timeouts TinyFish sont la propriété du produit, pas de la
        // configuration : un réglage trop court ne tronque pas search.
        let timeout_ms = if server.id == "tinyfish" && native_name == "search" {
            SEARCH_TIMEOUT_MS
        } else if server.id == "tinyfish" && native_name == "fetch_content" {
            FETCH_TIMEOUT_MS
        } else {
            server.timeout_ms
        };
        let outcome = tokio::select! {
            _ = token.cancelled() => Err(McpErrorPayload::cancelled()),
            result = tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                session.call_tool(native_name, call_arguments),
            ) => result.unwrap_or_else(|_| Err(McpErrorPayload::new(
                McpErrorKind::Timeout,
                "Le serveur MCP n'a pas répondu à temps",
            ))),
        };
        match outcome {
            Ok(result) => Ok(normalize_tool_result(&server.id, native_name, result)),
            Err(error) => Err(error),
        }
    }

    /// Statut d'authentification sans toucher au réseau.
    pub fn auth_status(&self, server_id: &str) -> Result<McpAuthStatus, McpErrorPayload> {
        let server = self.state.server(server_id)?;
        credentials::auth_status(self.store.as_ref(), &server)
    }

    /// Coupe la session puis efface le secret du coffre.
    pub async fn delete_secret(&self, server_id: &str) -> Result<(), McpErrorPayload> {
        self.pool.disconnect(server_id).await;
        credentials::delete_secret(self.store.as_ref(), server_id)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use rmcp::model::{CallToolResult, ContentBlock, Tool};
    use serde_json::{Value, json};
    use tokio::sync::Notify;

    use super::*;
    use crate::mcp::credentials::SecretEnvelope;
    use crate::mcp::registry::CallScope;
    use crate::mcp::transport::{McpConnectionPool, McpConnector, McpSession};
    use crate::mcp::types::{
        McpAuthConfig, McpErrorKind, McpErrorPayload, McpRuntimeServer, McpRuntimeTool,
        McpTransportKind,
    };

    struct FakeConnector {
        failure: Option<McpErrorKind>,
        bad_first_page: bool,
        // Compteur global : seule la première session créée échoue (l'échec
        // n'est pas répété à chaque reconnexion, sinon un reconnect-test
        // ne pourrait jamais réussir).
        sessions: Arc<AtomicUsize>,
        connects: Arc<AtomicUsize>,
        calls: Arc<AtomicUsize>,
        closes: Arc<AtomicUsize>,
        blocked: Arc<AtomicBool>,
        started: Arc<Notify>,
        // Derniers arguments transmis à call_tool : prouve que la
        // normalisation TinyFish (récrite) est bien dans le chemin actif.
        captured: Arc<Mutex<Option<Value>>>,
    }

    impl FakeConnector {
        fn ok() -> Self {
            Self {
                failure: None,
                bad_first_page: false,
                sessions: Arc::new(AtomicUsize::new(0)),
                connects: Arc::new(AtomicUsize::new(0)),
                calls: Arc::new(AtomicUsize::new(0)),
                closes: Arc::new(AtomicUsize::new(0)),
                blocked: Arc::new(AtomicBool::new(false)),
                started: Arc::new(Notify::new()),
                captured: Arc::new(Mutex::new(None)),
            }
        }

        fn blocking() -> Self {
            let value = Self::ok();
            value.block_calls();
            value
        }

        fn failing(kind: McpErrorKind) -> Self {
            Self {
                failure: Some(kind),
                ..Self::ok()
            }
        }

        fn offline_first_page() -> Self {
            Self {
                bad_first_page: true,
                ..Self::ok()
            }
        }

        fn block_calls(&self) {
            self.blocked.store(true, Ordering::SeqCst);
        }

        fn started(&self) -> Arc<Notify> {
            self.started.clone()
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }

        fn connect_count(&self) -> usize {
            self.connects.load(Ordering::SeqCst)
        }

        fn close_count(&self) -> usize {
            self.closes.load(Ordering::SeqCst)
        }

        fn last_call_arguments(&self) -> Option<Value> {
            self.captured.lock().expect("capture d'arguments").clone()
        }
    }

    struct FakeCallSession {
        calls: Arc<AtomicUsize>,
        closes: Arc<AtomicUsize>,
        captured: Arc<Mutex<Option<Value>>>,
        fail_first_listing: bool,
        listings: AtomicUsize,
        blocked: bool,
        started: Arc<Notify>,
    }

    #[async_trait]
    impl McpSession for FakeCallSession {
        async fn list_tools_page(
            &self,
            _cursor: Option<String>,
        ) -> Result<(Vec<Tool>, Option<String>), McpErrorPayload> {
            let listing = self.listings.fetch_add(1, Ordering::SeqCst);
            if self.fail_first_listing && listing == 0 {
                return Err(McpErrorPayload::new(
                    McpErrorKind::Offline,
                    "première page hors ligne",
                ));
            }
            let schema = Arc::new(serde_json::Map::from_iter([(
                "type".to_owned(),
                json!("object"),
            )]));
            Ok((vec![Tool::new("echo", "Echo", schema)], None))
        }

        async fn call_tool(
            &self,
            _name: &str,
            arguments: serde_json::Map<String, Value>,
        ) -> Result<CallToolResult, McpErrorPayload> {
            // Capte les arguments exactement tels que reçus du service.
            *self.captured.lock().expect("capture d'arguments") = Some(Value::Object(arguments));
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.started.notify_one();
            if self.blocked {
                std::future::pending().await
            } else {
                Ok(CallToolResult::success(vec![ContentBlock::text("ok")]))
            }
        }

        async fn close(&self) {
            self.closes.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl McpConnector for FakeConnector {
        async fn connect(
            &self,
            _server: &McpRuntimeServer,
            _secret: Option<&str>,
        ) -> Result<Arc<dyn McpSession>, McpErrorPayload> {
            self.connects.fetch_add(1, Ordering::SeqCst);
            if let Some(kind) = self.failure {
                return Err(McpErrorPayload::new(kind, "échec factice"));
            }
            let index = self.sessions.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(FakeCallSession {
                calls: self.calls.clone(),
                closes: self.closes.clone(),
                captured: self.captured.clone(),
                fail_first_listing: self.bad_first_page && index == 0,
                listings: AtomicUsize::new(0),
                blocked: self.blocked.load(Ordering::SeqCst),
                started: self.started.clone(),
            }))
        }
    }

    /// Coffre mémoire pour les tests : jamais branché au réseau.
    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<String, String>>);

    impl MemoryStore {
        fn with(key: &str, value: String) -> Self {
            Self(Mutex::new(HashMap::from([(key.to_owned(), value)])))
        }
    }

    impl SecretStore for MemoryStore {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().expect("store").get(key).cloned())
        }

        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            self.0
                .lock()
                .expect("store")
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, key: &str) -> Result<(), String> {
            self.0.lock().expect("store").remove(key);
            Ok(())
        }
    }

    fn server() -> McpRuntimeServer {
        McpRuntimeServer {
            id: "docs".to_owned(),
            name: "Docs".to_owned(),
            endpoint: "https://example.com/mcp".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::Bearer,
            timeout_ms: 60_000,
            enabled: true,
            builtin: false,
            tools: vec![McpRuntimeTool {
                native_name: "echo".to_owned(),
                input_schema: json!({ "type": "object" }),
                enabled: true,
            }],
        }
    }

    fn server_with_tool(enabled: bool) -> McpRuntimeServer {
        let mut value = server();
        value.auth = McpAuthConfig::None;
        value.tools[0].enabled = enabled;
        value
    }

    fn server_with_timeout(timeout_ms: u64) -> McpRuntimeServer {
        let mut value = server_with_tool(true);
        value.timeout_ms = timeout_ms;
        value
    }

    /// Serveur TinyFish canonique : respecte exactement les invariants de
    /// `validate_server_config` (builtin + Bearer + endpoint intégré figé).
    fn tinyfish_server() -> McpRuntimeServer {
        let mut value = server();
        value.id = "tinyfish".to_owned();
        value.name = "TinyFish".to_owned();
        value.endpoint = "https://agent.tinyfish.ai/mcp".to_owned();
        value.builtin = true;
        value.timeout_ms = 30_000;
        value.tools = vec![
            McpRuntimeTool {
                native_name: "search".to_owned(),
                input_schema: json!({ "type": "object" }),
                enabled: true,
            },
            McpRuntimeTool {
                native_name: "fetch_content".to_owned(),
                input_schema: json!({ "type": "object" }),
                enabled: true,
            },
        ];
        value
    }

    fn tinyfish_service(connector: Arc<FakeConnector>) -> McpService<MemoryStore> {
        let store = MemoryStore::with(
            "logassist/mcp/tinyfish",
            serde_json::to_string(&SecretEnvelope::new(&tinyfish_server(), "token"))
                .expect("enveloppe"),
        );
        McpService::new(
            state_with(vec![tinyfish_server()]),
            Arc::new(McpConnectionPool::new(connector)),
            Arc::new(store),
        )
    }

    fn state_with(servers: Vec<McpRuntimeServer>) -> Arc<McpState> {
        let state = Arc::new(McpState::default());
        state.sync(1, servers).expect("registre de test");
        state
    }

    fn service(connector: Arc<FakeConnector>, state: Arc<McpState>) -> McpService<MemoryStore> {
        McpService::new(
            state,
            Arc::new(McpConnectionPool::new(connector)),
            Arc::new(MemoryStore::default()),
        )
    }

    fn tool_names(tools: &[McpToolDescriptor]) -> Vec<&str> {
        tools.iter().map(|tool| tool.native_name.as_str()).collect()
    }

    #[tokio::test]
    async fn configure_tests_candidate_before_replacing_secret() {
        let existing =
            serde_json::to_string(&SecretEnvelope::new(&server(), "old")).expect("enveloppe");
        let store = Arc::new(MemoryStore::with("logassist/mcp/docs", existing));
        let connector = Arc::new(FakeConnector::failing(McpErrorKind::Auth));
        let pool = Arc::new(McpConnectionPool::new(connector));
        let service = McpService::new(state_with(vec![server()]), pool, store.clone());

        let error = service
            .configure_auth("docs", "new")
            .await
            .expect_err("candidate refusé");

        assert_eq!(error.kind, McpErrorKind::Auth);
        // La clé existante n'a pas été remplacée par le candidate refusé.
        let stored = store
            .get("logassist/mcp/docs")
            .expect("store")
            .expect("clé");
        assert!(stored.contains("\"old\""));
        assert!(!stored.contains("\"new\""));
    }

    #[tokio::test]
    async fn configure_auth_stores_a_validated_candidate_and_installs_the_session() {
        let connector = Arc::new(FakeConnector::ok());
        let store = Arc::new(MemoryStore::default());
        let service = McpService::new(
            state_with(vec![server()]),
            Arc::new(McpConnectionPool::new(connector)),
            store.clone(),
        );

        let descriptors = service
            .configure_auth("docs", "new")
            .await
            .expect("configuration acceptée");

        assert_eq!(tool_names(&descriptors), ["echo"]);
        let stored = store
            .get("logassist/mcp/docs")
            .expect("store")
            .expect("secret posé");
        assert!(stored.contains("\"new\""));
    }

    #[tokio::test]
    async fn assistant_call_checks_allowlist_and_cancellation() {
        let connector = Arc::new(FakeConnector::ok());
        let state = state_with(vec![server_with_tool(true)]);
        connector.block_calls();
        let started = connector.started();
        let service = Arc::new(service(connector.clone(), state));

        let service_task = service.clone();
        let task = tokio::spawn(async move {
            service_task
                .call_tool(
                    "docs",
                    "turn",
                    "call",
                    "echo",
                    json!({}),
                    CallScope::Assistant,
                )
                .await
        });
        started.notified().await;
        service.cancel_turn("turn").expect("annulation du tour");

        let outcome = task.await.expect("tâche jointe").expect_err("appel annulé");
        assert_eq!(outcome.kind, McpErrorKind::Cancelled);
    }

    #[tokio::test]
    async fn assistant_scope_rejects_a_disabled_tool_before_connecting() {
        let connector = Arc::new(FakeConnector::ok());
        let service = service(connector.clone(), state_with(vec![server_with_tool(false)]));

        let error = service
            .call_tool(
                "docs",
                "turn",
                "call",
                "echo",
                json!({}),
                CallScope::Assistant,
            )
            .await
            .expect_err("outil désactivé");

        assert_eq!(error.kind, McpErrorKind::ToolDenied);
        assert_eq!(connector.connect_count(), 0);
        assert_eq!(connector.call_count(), 0);
    }

    #[tokio::test]
    async fn finished_turns_release_the_registry_turn_budget() {
        let connector = Arc::new(FakeConnector::ok());
        let service = service(connector.clone(), state_with(vec![server_with_tool(true)]));

        // 2 × le budget du registre : sans fin de tour, begin_turn échouerait
        // dès le tour 1025 ("Trop de tours MCP actifs") et fuiterait la mémoire.
        for index in 0..2_048 {
            let turn_id = format!("turn-{index}");
            service.turn_handle(&turn_id).expect("tour enregistré");
            service.finish_turn(&turn_id).expect("tour terminé");
        }

        // Le budget est rendu : un nouveau tour reste ouvrable.
        service
            .turn_handle("turn-final")
            .expect("budget remis à zéro");
    }

    #[test]
    fn finishing_an_unknown_turn_is_a_no_op() {
        let connector = Arc::new(FakeConnector::ok());
        let service = service(connector.clone(), state_with(vec![server_with_tool(true)]));

        // Idempotent : un tour jamais ouvert (ou déjà terminé) ne panique pas.
        service
            .finish_turn("inconnu")
            .expect("tour inconnu : no-op");
    }

    #[tokio::test]
    async fn cancel_then_finish_is_ok_and_frees_the_turn() {
        let connector = Arc::new(FakeConnector::ok());
        let service = service(connector.clone(), state_with(vec![server_with_tool(true)]));

        service.turn_handle("turn").expect("tour enregistré");
        service.cancel_turn("turn").expect("annulation du tour");
        service.finish_turn("turn").expect("fin après annulation");

        // Tour libéré : le même identifiant peut être ré-ouvert proprement.
        service
            .turn_handle("turn")
            .expect("ré-enregistrement du tour");
    }

    // Note : test en temps réel (et non `start_paused`) car la validation des
    // arguments via `spawn_blocking` et le temps virtuel tokio se concurrencent.
    #[tokio::test]
    async fn timeout_invalidates_session_without_replaying_call() {
        let connector = Arc::new(FakeConnector::blocking());
        let service = service(
            connector.clone(),
            state_with(vec![server_with_timeout(5_000)]),
        );

        let error = service
            .call_tool(
                "docs",
                "turn",
                "call",
                "echo",
                json!({}),
                CallScope::Assistant,
            )
            .await
            .expect_err("appel bloqué expiré");

        assert_eq!(error.kind, McpErrorKind::Timeout);
        // L'appel n'est jamais rejoué : une seule invocation factice.
        assert_eq!(connector.call_count(), 1);
    }

    #[tokio::test]
    async fn pool_reuses_one_session_for_the_same_binding() {
        let connector = Arc::new(FakeConnector::ok());
        let pool = McpConnectionPool::new(connector.clone());
        let server = server();

        let first = pool
            .session(&server, Some("secret"))
            .await
            .expect("première session");
        let second = pool
            .session(&server, Some("secret"))
            .await
            .expect("seconde session");

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(connector.connect_count(), 1);
    }

    #[tokio::test]
    async fn pool_replaces_a_stale_fingerprint_and_closes_the_old_session() {
        let connector = Arc::new(FakeConnector::ok());
        let pool = McpConnectionPool::new(connector.clone());
        let mut server = server();

        let first = pool
            .session(&server, Some("secret"))
            .await
            .expect("session initiale");
        server.endpoint = "https://example.com/mcp-v2".to_owned();

        let replaced = pool
            .session(&server, Some("secret"))
            .await
            .expect("session de remplacement");

        assert!(!Arc::ptr_eq(&first, &replaced));
        assert_eq!(connector.connect_count(), 2);
        assert_eq!(connector.close_count(), 1);

        let reused = pool
            .session(&server, Some("secret"))
            .await
            .expect("session réutilisée");
        assert!(Arc::ptr_eq(&replaced, &reused));
        assert_eq!(connector.connect_count(), 2);
    }

    #[tokio::test]
    async fn disconnect_forces_a_fresh_connect_and_ignores_unknown_ids() {
        let connector = Arc::new(FakeConnector::ok());
        let pool = McpConnectionPool::new(connector.clone());
        let server = server();

        let _first = pool
            .session(&server, Some("secret"))
            .await
            .expect("première session");
        pool.disconnect(&server.id).await;
        assert_eq!(connector.close_count(), 1);

        pool.session(&server, Some("secret"))
            .await
            .expect("reconnexion");
        assert_eq!(connector.connect_count(), 2);
        assert_eq!(connector.close_count(), 1);
        // Idempotent : un identifiant inconnu ne ferme rien.
        pool.disconnect("inconnu").await;
        assert_eq!(connector.close_count(), 1);
    }

    #[tokio::test]
    async fn disconnect_many_closes_only_the_listed_slots() {
        let connector = Arc::new(FakeConnector::ok());
        let pool = McpConnectionPool::new(connector.clone());
        let server = server();

        let _session = pool
            .session(&server, Some("secret"))
            .await
            .expect("session");
        pool.disconnect_many(&["docs".to_owned(), "inconnu".to_owned()])
            .await;

        assert_eq!(connector.close_count(), 1);
        let fresh = pool
            .session(&server, Some("secret"))
            .await
            .expect("reconnexion après purge");
        assert_eq!(connector.connect_count(), 2);
        let again = pool
            .session(&server, Some("secret"))
            .await
            .expect("réutilisation après purge");
        assert!(Arc::ptr_eq(&fresh, &again));
    }

    #[tokio::test]
    async fn discover_reconnects_once_when_the_catalog_returns_offline() {
        let connector = Arc::new(FakeConnector::offline_first_page());
        let service = service(connector.clone(), state_with(vec![server_with_tool(true)]));

        let tools = service
            .discover("docs")
            .await
            .expect("découverte reconnectée");

        assert_eq!(tool_names(&tools), ["echo"]);
        assert_eq!(connector.connect_count(), 2);
        assert_eq!(connector.close_count(), 1);
    }

    #[tokio::test]
    async fn tinyfish_tool_calls_reject_invalid_arguments_before_the_network() {
        let connector = Arc::new(FakeConnector::ok());
        let service = tinyfish_service(connector.clone());

        for (index, (native_name, arguments, expected)) in [
            (
                "fetch_content",
                json!({ "urls": [
                    "https://one.example",
                    "https://two.example",
                    "https://three.example",
                    "https://four.example",
                ] }),
                McpErrorKind::InvalidArguments,
            ),
            (
                "fetch_content",
                json!({ "urls": ["http://10.0.0.4/page"] }),
                McpErrorKind::ToolDenied,
            ),
            (
                "search",
                json!({ "query": "x".repeat(2_001) }),
                McpErrorKind::InvalidArguments,
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let error = service
                .call_tool(
                    "tinyfish",
                    "turn",
                    &format!("call-{index}"),
                    native_name,
                    arguments,
                    CallScope::Assistant,
                )
                .await
                .expect_err("arguments invalides rejetés");
            assert_eq!(error.kind, expected, "{native_name}");
        }

        // Aucun appel n'a atteint la session : la validation précède le réseau.
        assert_eq!(connector.call_count(), 0);
    }

    #[tokio::test]
    async fn valid_tinyfish_call_installs_the_canonical_defaults() {
        let connector = Arc::new(FakeConnector::ok());
        let service = tinyfish_service(connector.clone());

        service
            .call_tool(
                "tinyfish",
                "turn",
                "call",
                "search",
                json!({ "query": "docs", "purpose": "apprendre" }),
                CallScope::Assistant,
            )
            .await
            .expect("appel valide");

        // La sortie de la session est la whitelist canonique exacte : aucune
        // clé de l'appelant ne passe, les défauts du produit sont installés.
        assert_eq!(
            connector.last_call_arguments().expect("arguments capturés"),
            json!({
                "query": "docs",
                "purpose": "apprendre",
                "result_limit": 5,
                "language": "fr",
                "domain_type": "web",
            })
        );
        assert_eq!(connector.call_count(), 1);
        assert_eq!(connector.connect_count(), 1);
    }

    #[tokio::test]
    async fn discover_reports_not_configured_for_an_unknown_server() {
        let connector = Arc::new(FakeConnector::ok());
        let service = service(connector.clone(), state_with(vec![server_with_tool(true)]));

        let error = service
            .discover("inconnu")
            .await
            .expect_err("serveur absent");

        assert_eq!(error.kind, McpErrorKind::NotConfigured);
        assert_eq!(connector.connect_count(), 0);
    }

    #[test]
    fn restrict_tinyfish_filters_search_and_fetch_content_and_fails_when_required() {
        let tools = vec![
            descriptor("search"),
            descriptor("fetch_content"),
            descriptor("sparkle"),
        ];

        let filtered = restrict_tinyfish_tools(tools).expect("filtrage TinyFish");
        assert_eq!(tool_names(&filtered), ["search", "fetch_content"]);

        let missing = restrict_tinyfish_tools(vec![descriptor("search")]).expect_err("incomplet");
        assert_eq!(missing.kind, McpErrorKind::InvalidResponse);
    }

    fn descriptor(name: &str) -> McpToolDescriptor {
        McpToolDescriptor {
            native_name: name.to_owned(),
            title: None,
            description: None,
            input_schema: json!({ "type": "object" }),
            output_schema: None,
            annotations: None,
            schema_hash: "sha256:test".to_owned(),
        }
    }

    #[tokio::test]
    async fn sync_registry_applies_revision_and_disconnects_changed_servers() {
        let connector = Arc::new(FakeConnector::ok());
        // Registre vierge : la première publication porte la révision 1.
        let service = service(connector.clone(), Arc::new(McpState::default()));
        let first = service
            .sync_registry(vec![server_with_tool(true)])
            .await
            .expect("sync initial");
        assert_eq!(first.revision, 1);

        let _tools = service.discover("docs").await.expect("découverte initiale");
        assert_eq!(connector.close_count(), 0);

        // Un changement reconnectant doit fermer la session du serveur modifié.
        let mut changed = server_with_tool(true);
        changed.endpoint = "https://example.com/mcp-v2".to_owned();
        let result = service.sync_registry(vec![changed]).await.expect("sync");

        assert!(result.applied);
        assert_eq!(result.revision, 2);
        assert_eq!(connector.close_count(), 1);
    }

    #[test]
    fn tool_timeouts_follow_the_spec() {
        assert_eq!(SEARCH_TIMEOUT_MS, 15_000);
        assert_eq!(FETCH_TIMEOUT_MS, 120_000);
        assert_eq!(ARGUMENT_VALIDATION_TIMEOUT_MS, 100);
    }
}
