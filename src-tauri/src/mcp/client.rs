//! Couche service MCP : validation avant transport, troncature des résultats,
//! annulation par requête et rédaction des secrets dans les messages d'erreur.
//! Aucune dépendance réseau ici : le transport réel vit dans `transport.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

pub use super::credentials::SecretStore;
use super::security::{MAX_RESULT_CHARS, validate_request};
use super::types::{McpErrorPayload, McpServerId, WebToolRequest, WebToolResult};

#[async_trait]
pub trait TinyfishExecutor: Send + Sync {
    /// Vérifie une clé candidate : liste les outils et exige search ET fetch_content.
    async fn verify(&self, api_key: &str) -> Result<(), McpErrorPayload>;
    async fn call(&self, request: &WebToolRequest) -> Result<WebToolResult, McpErrorPayload>;
}

pub fn secret_ref_for(server_id: McpServerId) -> String {
    format!("logassist/mcp/{}", server_id.as_str())
}

pub struct McpService<E: TinyfishExecutor + ?Sized, S: SecretStore> {
    executor: Arc<E>,
    store: Arc<S>,
}

impl<E: TinyfishExecutor + ?Sized, S: SecretStore> McpService<E, S> {
    pub fn new(executor: Arc<E>, store: Arc<S>) -> Self {
        Self { executor, store }
    }

    /// Configure une clé : elle est testée EN MÉMOIRE avant écriture. Un
    /// échec ne remplace jamais la clé existante (remplacement transactionnel).
    pub async fn configure(
        &self,
        server_id: McpServerId,
        candidate: &str,
    ) -> Result<(), McpErrorPayload> {
        self.executor
            .verify(candidate)
            .await
            .map_err(|e| e.redact(candidate))?;
        self.store
            .set(&secret_ref_for(server_id), candidate)
            .map_err(|m| McpErrorPayload::unknown(m).redact(candidate))
    }

    pub fn has_secret(&self, server_id: McpServerId) -> Result<bool, McpErrorPayload> {
        self.store
            .get(&secret_ref_for(server_id))
            .map(|opt| opt.is_some())
            .map_err(McpErrorPayload::unknown)
    }

    pub fn delete_secret(&self, server_id: McpServerId) -> Result<(), McpErrorPayload> {
        self.store
            .delete(&secret_ref_for(server_id))
            .map_err(McpErrorPayload::unknown)
    }

    /// Valide la requête AVANT le transport, exécute, puis tronque le contenu
    /// à MAX_RESULT_CHARS caractères. Le jeton d'annulation est contrôlé entre
    /// validation et exécution : une annulation déjà demandée court-circuite.
    pub async fn call(
        &self,
        server_id: McpServerId,
        token: &CancellationToken,
        request: &WebToolRequest,
    ) -> Result<WebToolResult, McpErrorPayload> {
        let definition = super::security::server_definition(server_id);
        validate_request(definition, request)?;
        if token.is_cancelled() {
            return Err(McpErrorPayload::cancelled());
        }
        let mut result = tokio::select! {
            result = self.executor.call(request) => result?,
            () = token.cancelled() => return Err(McpErrorPayload::cancelled()),
        };
        result.content = truncate_chars(&result.content, MAX_RESULT_CHARS);
        Ok(result)
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    value.chars().take(max_chars).collect()
}

#[derive(Default)]
pub struct McpState {
    requests: std::sync::Mutex<HashMap<String, CancellationToken>>,
}

impl McpState {
    /// Enregistre un jeton pour request_id et renvoie le jeton. Si un jeton
    /// existait déjà (réutilisation d'id), il est annulé d'abord.
    pub fn register(&self, request_id: &str) -> CancellationToken {
        let mut requests = self.requests.lock().expect("McpState verrouillé");
        if let Some(previous) = requests.insert(request_id.to_owned(), CancellationToken::new()) {
            previous.cancel();
        }
        requests
            .get(request_id)
            .cloned()
            .expect("jeton fraîchement inséré")
    }

    /// Annule le jeton de request_id. Idempotent : id inconnu = no-op.
    pub fn cancel(&self, request_id: &str) {
        let token = {
            let requests = self.requests.lock().expect("McpState verrouillé");
            requests.get(request_id).cloned()
        };
        if let Some(token) = token {
            token.cancel();
        }
    }

    /// Retire l'entrée après usage. Toujours appelé, même en cas d'erreur.
    pub fn remove(&self, request_id: &str) {
        self.requests
            .lock()
            .expect("McpState verrouillé")
            .remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Notify;

    use super::*;

    struct FakeExecutor {
        verify_result: Result<(), McpErrorPayload>,
        call_result: Result<WebToolResult, McpErrorPayload>,
        calls: AtomicUsize,
    }

    impl FakeExecutor {
        fn ok() -> Self {
            Self {
                verify_result: Ok(()),
                call_result: Ok(WebToolResult {
                    content: "réponse".to_owned(),
                    sources: Vec::new(),
                }),
                calls: AtomicUsize::new(0),
            }
        }
    }

    #[async_trait]
    impl TinyfishExecutor for FakeExecutor {
        async fn verify(&self, _api_key: &str) -> Result<(), McpErrorPayload> {
            self.verify_result.clone()
        }
        async fn call(&self, _request: &WebToolRequest) -> Result<WebToolResult, McpErrorPayload> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.call_result.clone()
        }
    }

    struct BlockingExecutor {
        started: Arc<Notify>,
    }

    #[async_trait]
    impl TinyfishExecutor for BlockingExecutor {
        async fn verify(&self, _api_key: &str) -> Result<(), McpErrorPayload> {
            Ok(())
        }

        async fn call(&self, _request: &WebToolRequest) -> Result<WebToolResult, McpErrorPayload> {
            self.started.notify_one();
            std::future::pending().await
        }
    }

    #[derive(Default)]
    struct MemoryStore {
        entries: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemoryStore {
        fn get(&self, secret_ref: &str) -> Result<Option<String>, String> {
            Ok(self.entries.lock().expect("store").get(secret_ref).cloned())
        }
        fn set(&self, secret_ref: &str, value: &str) -> Result<(), String> {
            self.entries
                .lock()
                .expect("store")
                .insert(secret_ref.to_owned(), value.to_owned());
            Ok(())
        }
        fn delete(&self, secret_ref: &str) -> Result<(), String> {
            self.entries.lock().expect("store").remove(secret_ref);
            Ok(())
        }
    }

    fn service(executor: FakeExecutor) -> McpService<FakeExecutor, MemoryStore> {
        McpService::new(Arc::new(executor), Arc::new(MemoryStore::default()))
    }

    fn search(query: &str) -> WebToolRequest {
        WebToolRequest::Search {
            query: query.to_owned(),
            purpose: None,
        }
    }

    #[tokio::test]
    async fn configure_stores_the_key_after_successful_verification() {
        let service = service(FakeExecutor::ok());
        service
            .configure(McpServerId::Tinyfish, "sk-good")
            .await
            .expect("ok");
        let store = service.store.clone();
        assert_eq!(
            store.get("logassist/mcp/tinyfish").expect("store"),
            Some("sk-good".to_owned())
        );
    }

    #[tokio::test]
    async fn failed_verification_never_replaces_the_existing_key() {
        let executor = FakeExecutor {
            verify_result: Err(McpErrorPayload::auth("401")),
            call_result: Ok(WebToolResult {
                content: String::new(),
                sources: Vec::new(),
            }),
            calls: AtomicUsize::new(0),
        };
        let service = service(executor);
        // Clé existante pré-posée : un échec de vérification ne doit pas y toucher.
        service
            .store
            .clone()
            .set("logassist/mcp/tinyfish", "sk-old")
            .expect("set");
        let outcome = service.configure(McpServerId::Tinyfish, "sk-bad").await;
        assert_eq!(
            outcome.unwrap_err().kind,
            super::super::types::McpErrorKind::Auth
        );
        let store = service.store.clone();
        assert_eq!(
            store.get("logassist/mcp/tinyfish").expect("store"),
            Some("sk-old".to_owned())
        );
    }

    #[tokio::test]
    async fn error_messages_never_contain_the_candidate_key() {
        // L'erreur simulée embarque la clé candidate : le service doit la rédiger.
        let executor = FakeExecutor {
            verify_result: Err(McpErrorPayload::auth("rejected sk-SECRET-123")),
            call_result: Ok(WebToolResult {
                content: String::new(),
                sources: Vec::new(),
            }),
            calls: AtomicUsize::new(0),
        };
        let service = service(executor);
        let outcome = service
            .configure(McpServerId::Tinyfish, "sk-SECRET-123")
            .await;
        let error = outcome.unwrap_err();
        assert!(!error.message.contains("sk-SECRET-123"));
        assert!(error.message.contains("[rédigé]"));
    }

    #[tokio::test]
    async fn call_refuses_invalid_requests_before_reaching_the_executor() {
        let executor = FakeExecutor::ok();
        let calls_before = executor.calls.load(Ordering::SeqCst);
        let service = service(executor);
        let token = CancellationToken::new();
        // Requête vide → refus de validation, zéro appel transport.
        let outcome = service
            .call(McpServerId::Tinyfish, &token, &search("  "))
            .await;
        assert_eq!(
            outcome.unwrap_err().kind,
            super::super::types::McpErrorKind::ToolDenied
        );
        let calls = service.executor.calls.load(Ordering::SeqCst);
        assert_eq!(calls, calls_before);
    }

    #[tokio::test]
    async fn oversized_results_are_truncated_to_max_result_chars() {
        let long = "x".repeat(MAX_RESULT_CHARS + 500);
        let executor = FakeExecutor {
            verify_result: Ok(()),
            call_result: Ok(WebToolResult {
                content: long,
                sources: Vec::new(),
            }),
            calls: AtomicUsize::new(0),
        };
        let service = service(executor);
        let token = CancellationToken::new();
        let result = service
            .call(McpServerId::Tinyfish, &token, &search("doc"))
            .await
            .expect("ok");
        assert_eq!(result.content.chars().count(), MAX_RESULT_CHARS);
    }

    #[tokio::test]
    async fn cancelled_requests_short_circuit_before_the_executor() {
        let executor = FakeExecutor::ok();
        let service = service(executor);
        let token = CancellationToken::new();
        token.cancel();
        let outcome = service
            .call(McpServerId::Tinyfish, &token, &search("doc"))
            .await;
        assert_eq!(
            outcome.unwrap_err().kind,
            super::super::types::McpErrorKind::Cancelled
        );
        assert_eq!(service.executor.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn cancellation_interrupts_an_active_executor_call() {
        let started = Arc::new(Notify::new());
        let service = McpService::new(
            Arc::new(BlockingExecutor {
                started: started.clone(),
            }),
            Arc::new(MemoryStore::default()),
        );
        let token = CancellationToken::new();
        let call_token = token.clone();
        let task = tokio::spawn(async move {
            service
                .call(McpServerId::Tinyfish, &call_token, &search("doc"))
                .await
        });

        started.notified().await;
        token.cancel();
        let outcome = tokio::time::timeout(std::time::Duration::from_millis(100), task)
            .await
            .expect("l'appel actif doit être interrompu")
            .expect("tâche jointe");

        assert_eq!(
            outcome.unwrap_err().kind,
            super::super::types::McpErrorKind::Cancelled
        );
    }

    #[test]
    fn state_cancel_completes_the_registered_token() {
        let state = McpState::default();
        let token = state.register("req-1");
        assert!(!token.is_cancelled());
        state.cancel("req-1");
        assert!(token.is_cancelled());
        // Idempotent : id inconnu = no-op sans panique.
        state.cancel("inconnu");
    }

    #[test]
    fn state_remove_frees_the_request_entry() {
        let state = McpState::default();
        let token = state.register("req-2");
        state.remove("req-2");
        // Après remove, cancel devient un no-op (l'entrée n'existe plus).
        state.cancel("req-2");
        assert!(!token.is_cancelled());
    }

    #[test]
    fn secret_ref_follows_the_multi_mcp_convention() {
        assert_eq!(
            secret_ref_for(McpServerId::Tinyfish),
            "logassist/mcp/tinyfish"
        );
    }
}
