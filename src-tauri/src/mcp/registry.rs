use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::credentials::binding_fingerprint;
use super::security::validate_server_config;
use super::types::{McpErrorKind, McpErrorPayload, McpRuntimeServer, McpRuntimeTool};

const MAX_ACTIVE_MCP_TOOLS: usize = 64;
const MAX_ACTIVE_MCP_SCHEMA_BYTES: usize = 256 * 1024;
const MAX_ACTIVE_TURNS: usize = 1_024;
const MAX_ACTIVE_CALLS: usize = 4_096;
const MAX_CALLS_PER_TURN: usize = 64;
const MAX_RUNTIME_ID_CHARS: usize = 128;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallScope {
    Assistant,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnHandle {
    pub turn_id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGenerationChange {
    pub server_id: String,
    pub previous_generation: Option<u64>,
    pub current_generation: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySyncResult {
    pub applied: bool,
    pub changed: Vec<ServerGenerationChange>,
    pub revision: u64,
}

struct RegistryServer {
    server: Arc<McpRuntimeServer>,
    generation: u64,
}

struct RegistryState {
    servers: HashMap<String, RegistryServer>,
    last_revision: u64,
    next_generation: u64,
}

impl Default for RegistryState {
    fn default() -> Self {
        Self {
            servers: HashMap::new(),
            last_revision: 0,
            next_generation: 1,
        }
    }
}

struct ActiveCall {
    token: CancellationToken,
    server_id: String,
    server_generation: u64,
}

struct TurnState {
    generation: u64,
    parent_token: CancellationToken,
    calls: HashMap<String, ActiveCall>,
    seen_call_ids: HashSet<String>,
}

struct TurnRegistry {
    turns: HashMap<String, TurnState>,
    active_call_count: usize,
    next_turn_generation: u64,
}

impl Default for TurnRegistry {
    fn default() -> Self {
        Self {
            turns: HashMap::new(),
            active_call_count: 0,
            next_turn_generation: 1,
        }
    }
}

#[derive(Default)]
pub struct McpState {
    registry: RwLock<RegistryState>,
    turns: Mutex<TurnRegistry>,
}

struct CallGuard<'a> {
    state: &'a McpState,
    turn_id: String,
    turn_generation: u64,
    call_id: String,
    server_id: String,
    server_generation: u64,
    token: CancellationToken,
}

pub struct CallPermit<'a> {
    pub server: Arc<McpRuntimeServer>,
    pub tool: McpRuntimeTool,
    pub server_generation: u64,
    pub token: CancellationToken,
    _guard: CallGuard<'a>,
}

impl Drop for CallGuard<'_> {
    fn drop(&mut self) {
        let mut turns = self
            .state
            .turns
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let remove_call = turns
            .turns
            .get(&self.turn_id)
            .filter(|turn| turn.generation == self.turn_generation)
            .and_then(|turn| turn.calls.get(&self.call_id))
            .is_some_and(|active| {
                active.server_id == self.server_id
                    && active.server_generation == self.server_generation
                    && active.token == self.token
            });
        if remove_call {
            if let Some(turn) = turns
                .turns
                .get_mut(&self.turn_id)
                .filter(|turn| turn.generation == self.turn_generation)
            {
                turn.calls.remove(&self.call_id);
            }
            turns.active_call_count = turns.active_call_count.saturating_sub(1);
        }
    }
}

impl McpState {
    pub fn sync(
        &self,
        revision: u64,
        servers: Vec<McpRuntimeServer>,
    ) -> Result<RegistrySyncResult, McpErrorPayload> {
        validate_revision(revision)?;
        {
            let registry = self.registry.read().unwrap_or_else(PoisonError::into_inner);
            if revision <= registry.last_revision {
                return Ok(stale_sync_result(registry.last_revision));
            }
        }

        validate_registry_input(&servers)?;

        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        if revision <= registry.last_revision {
            return Ok(stale_sync_result(registry.last_revision));
        }

        let mut next_generation = registry.next_generation;
        let mut next_servers = HashMap::with_capacity(servers.len());
        let mut changed = Vec::new();

        for server in servers {
            let server_id = server.id.clone();
            if let Some(previous) = registry.servers.get(&server_id) {
                if requires_reconnection(previous.server.as_ref(), &server) {
                    let generation = allocate_generation(&mut next_generation)?;
                    changed.push(ServerGenerationChange {
                        server_id: server_id.clone(),
                        previous_generation: Some(previous.generation),
                        current_generation: Some(generation),
                    });
                    next_servers.insert(
                        server_id,
                        RegistryServer {
                            server: Arc::new(server),
                            generation,
                        },
                    );
                } else {
                    let published = if previous.server.as_ref() == &server {
                        Arc::clone(&previous.server)
                    } else {
                        Arc::new(server)
                    };
                    next_servers.insert(
                        server_id,
                        RegistryServer {
                            server: published,
                            generation: previous.generation,
                        },
                    );
                }
            } else {
                let generation = allocate_generation(&mut next_generation)?;
                changed.push(ServerGenerationChange {
                    server_id: server_id.clone(),
                    previous_generation: None,
                    current_generation: Some(generation),
                });
                next_servers.insert(
                    server_id,
                    RegistryServer {
                        server: Arc::new(server),
                        generation,
                    },
                );
            }
        }

        for (server_id, previous) in &registry.servers {
            if !next_servers.contains_key(server_id) {
                changed.push(ServerGenerationChange {
                    server_id: server_id.clone(),
                    previous_generation: Some(previous.generation),
                    current_generation: None,
                });
            }
        }
        changed.sort_unstable_by(|left, right| left.server_id.cmp(&right.server_id));

        let revoked_generations: HashMap<String, u64> = changed
            .iter()
            .filter_map(|change| {
                change
                    .previous_generation
                    .map(|generation| (change.server_id.clone(), generation))
            })
            .collect();
        if !revoked_generations.is_empty() {
            let mut turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);
            revoke_calls(&mut turns, &revoked_generations);
        }

        registry.servers = next_servers;
        registry.last_revision = revision;
        registry.next_generation = next_generation;
        Ok(RegistrySyncResult {
            applied: true,
            changed,
            revision,
        })
    }

    pub fn server(&self, id: &str) -> Result<McpRuntimeServer, McpErrorPayload> {
        self.registry
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .servers
            .get(id)
            .map(|registered| registered.server.as_ref().clone())
            .ok_or_else(|| {
                McpErrorPayload::new(McpErrorKind::NotConfigured, "Serveur MCP non configuré")
            })
    }

    pub fn begin_turn(&self, turn_id: &str) -> Result<TurnHandle, McpErrorPayload> {
        validate_runtime_id(turn_id)?;
        let mut turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);
        if turns.turns.contains_key(turn_id) {
            return Err(invalid_arguments("Tour MCP déjà enregistré"));
        }
        if turns.turns.len() >= MAX_ACTIVE_TURNS {
            return Err(invalid_arguments("Trop de tours MCP actifs"));
        }

        let generation = allocate_turn_generation(&mut turns.next_turn_generation)?;
        let parent_token = CancellationToken::new();
        turns.turns.insert(
            turn_id.to_owned(),
            TurnState {
                generation,
                parent_token,
                calls: HashMap::new(),
                seen_call_ids: HashSet::new(),
            },
        );
        Ok(TurnHandle {
            turn_id: turn_id.to_owned(),
            generation,
        })
    }

    pub fn cancel_turn(&self, handle: &TurnHandle) {
        let turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(turn) = turns
            .turns
            .get(&handle.turn_id)
            .filter(|turn| turn.generation == handle.generation)
        {
            turn.parent_token.cancel();
            for call in turn.calls.values() {
                call.token.cancel();
            }
        }
    }

    pub fn finish_turn(&self, handle: &TurnHandle) {
        let mut turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);
        let is_current = turns
            .turns
            .get(&handle.turn_id)
            .is_some_and(|turn| turn.generation == handle.generation);
        if !is_current {
            return;
        }
        if let Some(turn) = turns.turns.get(&handle.turn_id) {
            turn.parent_token.cancel();
            for call in turn.calls.values() {
                call.token.cancel();
            }
        }
        if let Some(finished) = turns.turns.remove(&handle.turn_id) {
            turns.active_call_count = turns.active_call_count.saturating_sub(finished.calls.len());
        }
    }

    pub fn begin_call(
        &self,
        handle: &TurnHandle,
        call_id: &str,
        server_id: &str,
        native_name: &str,
        scope: CallScope,
    ) -> Result<CallPermit<'_>, McpErrorPayload> {
        validate_runtime_id(&handle.turn_id)?;
        validate_runtime_id(call_id)?;
        if handle.generation == 0 || handle.generation > MAX_SAFE_INTEGER {
            return Err(McpErrorPayload::cancelled());
        }

        // Ordre global : registre en lecture, puis état des tours. La sync
        // prend les mêmes verrous en écriture puis en mutex avant publication.
        let registry = self.registry.read().unwrap_or_else(PoisonError::into_inner);
        let mut turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(turn) = turns
            .turns
            .get(&handle.turn_id)
            .filter(|turn| turn.generation == handle.generation)
        else {
            return Err(McpErrorPayload::cancelled());
        };
        let registered = registry.servers.get(server_id).ok_or_else(|| {
            McpErrorPayload::new(McpErrorKind::NotConfigured, "Serveur MCP non configuré")
        })?;
        let tool = require_registered_tool(registered.server.as_ref(), native_name, scope)?;

        if turn.seen_call_ids.contains(call_id) {
            return Err(invalid_arguments("Appel MCP déjà enregistré"));
        }
        if turn.seen_call_ids.len() >= MAX_CALLS_PER_TURN {
            return Err(invalid_arguments("Trop d'appels MCP pour ce tour"));
        }
        if turns.active_call_count >= MAX_ACTIVE_CALLS {
            return Err(invalid_arguments("Trop d'appels MCP actifs"));
        }

        let token = turn.parent_token.child_token();
        let server = Arc::clone(&registered.server);
        let server_generation = registered.generation;
        let active = ActiveCall {
            token: token.clone(),
            server_id: server_id.to_owned(),
            server_generation,
        };
        let Some(turn) = turns
            .turns
            .get_mut(&handle.turn_id)
            .filter(|turn| turn.generation == handle.generation)
        else {
            return Err(McpErrorPayload::cancelled());
        };
        turn.seen_call_ids.insert(call_id.to_owned());
        turn.calls.insert(call_id.to_owned(), active);
        turns.active_call_count += 1;
        drop(turns);
        drop(registry);

        Ok(CallPermit {
            server,
            tool,
            server_generation,
            token: token.clone(),
            _guard: CallGuard {
                state: self,
                turn_id: handle.turn_id.clone(),
                turn_generation: handle.generation,
                call_id: call_id.to_owned(),
                server_id: server_id.to_owned(),
                server_generation,
                token,
            },
        })
    }
}

fn stale_sync_result(revision: u64) -> RegistrySyncResult {
    RegistrySyncResult {
        applied: false,
        changed: Vec::new(),
        revision,
    }
}

fn invalid_config(message: &'static str) -> McpErrorPayload {
    McpErrorPayload::new(McpErrorKind::InvalidConfig, message)
}

fn invalid_arguments(message: &'static str) -> McpErrorPayload {
    McpErrorPayload::new(McpErrorKind::InvalidArguments, message)
}

fn validate_revision(revision: u64) -> Result<(), McpErrorPayload> {
    if revision == 0 || revision > MAX_SAFE_INTEGER {
        Err(invalid_config("Révision du registre MCP invalide"))
    } else {
        Ok(())
    }
}

fn allocate_generation(next_generation: &mut u64) -> Result<u64, McpErrorPayload> {
    if *next_generation == 0 || *next_generation >= MAX_SAFE_INTEGER {
        return Err(invalid_config("Génération du registre MCP épuisée"));
    }
    let generation = *next_generation;
    *next_generation += 1;
    Ok(generation)
}

fn allocate_turn_generation(next_generation: &mut u64) -> Result<u64, McpErrorPayload> {
    if *next_generation == 0 || *next_generation >= MAX_SAFE_INTEGER {
        return Err(invalid_config("Génération de tour MCP épuisée"));
    }
    let generation = *next_generation;
    *next_generation += 1;
    Ok(generation)
}

fn validate_registry_input(servers: &[McpRuntimeServer]) -> Result<(), McpErrorPayload> {
    let mut ids = HashSet::with_capacity(servers.len());
    for server in servers {
        validate_server_config(server)?;
        if !ids.insert(server.id.as_str()) {
            return Err(invalid_config("Identifiant de serveur MCP dupliqué"));
        }
    }
    validate_active_catalog(servers)
}

fn validate_active_catalog(servers: &[McpRuntimeServer]) -> Result<(), McpErrorPayload> {
    let schemas: Vec<&Value> = servers
        .iter()
        .filter(|server| server.enabled)
        .flat_map(|server| server.tools.iter())
        .filter(|tool| tool.enabled)
        .map(|tool| &tool.input_schema)
        .collect();
    if schemas.len() > MAX_ACTIVE_MCP_TOOLS {
        return Err(invalid_config("Trop d'outils MCP actifs"));
    }
    let schema_bytes = serde_json::to_vec(&schemas)
        .map_err(|_| invalid_config("Schémas MCP actifs non sérialisables"))?
        .len();
    if schema_bytes > MAX_ACTIVE_MCP_SCHEMA_BYTES {
        return Err(invalid_config("Schémas MCP actifs trop volumineux"));
    }
    Ok(())
}

fn requires_reconnection(previous: &McpRuntimeServer, next: &McpRuntimeServer) -> bool {
    binding_fingerprint(previous) != binding_fingerprint(next)
        || previous.timeout_ms != next.timeout_ms
        || previous.enabled != next.enabled
        || previous.tools != next.tools
}

fn require_registered_tool(
    server: &McpRuntimeServer,
    native_name: &str,
    scope: CallScope,
) -> Result<McpRuntimeTool, McpErrorPayload> {
    let tool = server
        .tools
        .iter()
        .find(|tool| tool.native_name == native_name)
        .cloned()
        .ok_or_else(|| McpErrorPayload::new(McpErrorKind::ToolNotFound, "Outil MCP inconnu"))?;
    if server.id == "tinyfish" && !matches!(native_name, "search" | "fetch_content") {
        return Err(McpErrorPayload::tool_denied("Outil TinyFish non autorisé"));
    }
    if scope == CallScope::Assistant && (!server.enabled || !tool.enabled) {
        return Err(McpErrorPayload::tool_denied("Outil MCP désactivé"));
    }
    Ok(tool)
}

fn revoke_calls(turns: &mut TurnRegistry, revoked_generations: &HashMap<String, u64>) {
    let mut removed = 0;
    for turn in turns.turns.values_mut() {
        let before = turn.calls.len();
        turn.calls.retain(|_, call| {
            let revoked = revoked_generations.get(&call.server_id) == Some(&call.server_generation);
            if revoked {
                call.token.cancel();
            }
            !revoked
        });
        removed += before - turn.calls.len();
    }
    turns.active_call_count = turns.active_call_count.saturating_sub(removed);
}

fn is_valid_runtime_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_RUNTIME_ID_CHARS
        && !value.chars().any(char::is_control)
}

fn validate_runtime_id(value: &str) -> Result<(), McpErrorPayload> {
    if is_valid_runtime_id(value) {
        Ok(())
    } else {
        Err(invalid_arguments("Identifiant d'exécution MCP invalide"))
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::PoisonError;

    use serde_json::{Value, json};

    use super::*;
    use crate::mcp::types::{
        McpAuthConfig, McpErrorKind, McpRuntimeServer, McpRuntimeTool, McpTransportKind,
    };

    const ACTIVE_SCHEMA_LIMIT: usize = 256 * 1024;
    const ACTIVE_TURN_LIMIT: usize = 1_024;
    const GLOBAL_CALL_LIMIT: usize = 4_096;
    const TURN_CALL_LIMIT: usize = 64;

    fn runtime_tool(native_name: impl Into<String>) -> McpRuntimeTool {
        McpRuntimeTool {
            native_name: native_name.into(),
            input_schema: json!({ "type": "object" }),
            enabled: true,
        }
    }

    fn remote_server(id: &str) -> McpRuntimeServer {
        McpRuntimeServer {
            id: id.to_owned(),
            name: format!("Serveur {id}"),
            endpoint: format!("https://{id}.example.com/mcp"),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::None,
            timeout_ms: 15_000,
            enabled: true,
            builtin: false,
            tools: vec![runtime_tool("search")],
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
            tools: vec![
                runtime_tool("search"),
                runtime_tool("fetch_content"),
                runtime_tool("dangerous"),
            ],
        }
    }

    fn server_with_tool_count(id: &str, count: usize) -> McpRuntimeServer {
        let mut server = remote_server(id);
        server.tools = (0..count)
            .map(|index| runtime_tool(format!("tool_{index}")))
            .collect();
        server
    }

    fn server_with_active_schema_bytes(id: &str, target_bytes: usize) -> McpRuntimeServer {
        let mut schemas: Vec<Value> = (0..5)
            .map(|_| json!({ "type": "object", "description": "" }))
            .collect();
        let base_bytes = serde_json::to_vec(&schemas)
            .expect("tableau de schémas sérialisable")
            .len();
        let padding = target_bytes - base_bytes;
        let per_schema = padding / schemas.len();
        let remainder = padding % schemas.len();
        for (index, schema) in schemas.iter_mut().enumerate() {
            schema["description"] = json!("x".repeat(per_schema + usize::from(index < remainder)));
        }
        assert_eq!(
            serde_json::to_vec(&schemas)
                .expect("tableau de schémas sérialisable")
                .len(),
            target_bytes
        );

        let mut server = remote_server(id);
        server.tools = schemas
            .into_iter()
            .enumerate()
            .map(|(index, input_schema)| McpRuntimeTool {
                native_name: format!("tool_{index}"),
                input_schema,
                enabled: true,
            })
            .collect();
        server
    }

    fn generation(change: &ServerGenerationChange) -> u64 {
        change.current_generation.expect("génération courante")
    }

    fn active_call_count(state: &McpState) -> usize {
        state
            .turns
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .active_call_count
    }

    #[test]
    fn stale_revision_is_not_applied_validated_or_allowed_to_overwrite_newer_state() {
        let state = McpState::default();
        let current = remote_server("current");
        let applied = state
            .sync(2, vec![current.clone()])
            .expect("révision récente");
        assert!(applied.applied);
        assert_eq!(applied.revision, 2);

        let turn = state.begin_turn("turn").expect("tour actif");
        let permit = state
            .begin_call(&turn, "call", "current", "search", CallScope::Assistant)
            .expect("permis courant");
        let mut invalid_stale = remote_server("stale");
        invalid_stale.endpoint =
            "https://example.com/mcp?api_key=secret#fragment-interdit".to_owned();

        let stale = state
            .sync(1, vec![invalid_stale])
            .expect("révision obsolète ignorée avant validation");

        assert!(!stale.applied);
        assert!(stale.changed.is_empty());
        assert_eq!(stale.revision, 2);
        assert_eq!(state.server("current").expect("état récent"), current);
        assert!(!permit.token.is_cancelled());
        assert_eq!(
            state
                .server("stale")
                .expect_err("état obsolète absent")
                .kind,
            McpErrorKind::NotConfigured
        );
    }

    #[test]
    fn revision_and_generation_overflow_fail_closed() {
        let state = McpState::default();
        for revision in [0, MAX_SAFE_INTEGER + 1, u64::MAX] {
            assert_eq!(
                state
                    .sync(revision, vec![remote_server("overflow")])
                    .expect_err("révision invalide")
                    .kind,
                McpErrorKind::InvalidConfig
            );
        }

        let max_revision_state = McpState::default();
        let at_limit = max_revision_state
            .sync(MAX_SAFE_INTEGER, vec![remote_server("max-revision")])
            .expect("borne JS sûre acceptée");
        assert_eq!(at_limit.revision, MAX_SAFE_INTEGER);

        let original = remote_server("stable");
        state.sync(1, vec![original.clone()]).expect("état initial");
        state
            .registry
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .next_generation = MAX_SAFE_INTEGER;
        let mut changed = original.clone();
        changed.timeout_ms += 1;

        assert_eq!(
            state
                .sync(2, vec![changed])
                .expect_err("génération en overflow")
                .kind,
            McpErrorKind::InvalidConfig
        );
        assert_eq!(state.server("stable").expect("état préservé"), original);
        assert_eq!(
            state
                .registry
                .read()
                .unwrap_or_else(PoisonError::into_inner)
                .last_revision,
            1
        );

        let turn_state = McpState::default();
        turn_state
            .turns
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .next_turn_generation = MAX_SAFE_INTEGER;
        assert_eq!(
            turn_state
                .begin_turn("overflow-turn")
                .expect_err("génération de tour épuisée")
                .kind,
            McpErrorKind::InvalidConfig
        );
        assert!(
            turn_state
                .turns
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .turns
                .is_empty()
        );
    }

    #[test]
    fn sync_tracks_generations_for_add_change_name_only_and_removal() {
        let state = McpState::default();
        let original = remote_server("docs");
        let added = state.sync(1, vec![original.clone()]).expect("ajout");
        assert!(added.applied);
        assert_eq!(added.revision, 1);
        assert_eq!(added.changed.len(), 1);
        assert_eq!(added.changed[0].server_id, "docs");
        assert_eq!(added.changed[0].previous_generation, None);
        let first_generation = generation(&added.changed[0]);

        let serialized = serde_json::to_value(&added).expect("résultat sérialisable");
        assert_eq!(serialized["applied"], json!(true));
        assert_eq!(serialized["revision"], json!(1));
        assert_eq!(serialized["changed"][0]["serverId"], json!("docs"));
        assert_eq!(serialized["changed"][0]["previousGeneration"], Value::Null);
        assert_eq!(
            serialized["changed"][0]["currentGeneration"],
            json!(first_generation)
        );
        assert!(serialized["changed"][0].get("server_id").is_none());

        let mut renamed = original.clone();
        renamed.name = "Documentation renommée".to_owned();
        let name_only = state.sync(2, vec![renamed.clone()]).expect("renommage");
        assert!(name_only.applied);
        assert!(name_only.changed.is_empty());
        assert_eq!(state.server("docs").expect("nom publié"), renamed);

        let turn = state.begin_turn("generation-turn").expect("tour actif");
        let permit = state
            .begin_call(
                &turn,
                "name-only-call",
                "docs",
                "search",
                CallScope::Assistant,
            )
            .expect("permis après renommage");
        assert_eq!(permit.server_generation, first_generation);
        drop(permit);

        let mut timeout_changed = renamed;
        timeout_changed.timeout_ms += 1;
        let changed = state
            .sync(3, vec![timeout_changed])
            .expect("changement reconnectant");
        assert_eq!(changed.changed.len(), 1);
        assert_eq!(
            changed.changed[0].previous_generation,
            Some(first_generation)
        );
        let second_generation = generation(&changed.changed[0]);
        assert_ne!(second_generation, first_generation);

        let removed = state.sync(4, Vec::new()).expect("suppression");
        assert_eq!(
            removed.changed,
            vec![ServerGenerationChange {
                server_id: "docs".to_owned(),
                previous_generation: Some(second_generation),
                current_generation: None,
            }]
        );
    }

    #[test]
    fn sync_rotates_generation_for_binding_timeout_enabled_and_tools_changes() {
        let original = remote_server("generation-fields");
        let mut binding_changed = original.clone();
        binding_changed.endpoint = "https://other.example.com/mcp".to_owned();
        let mut timeout_changed = original.clone();
        timeout_changed.timeout_ms += 1;
        let mut enabled_changed = original.clone();
        enabled_changed.enabled = false;
        let mut tools_changed = original.clone();
        tools_changed.tools.push(runtime_tool("fetch"));

        for changed_server in [
            binding_changed,
            timeout_changed,
            enabled_changed,
            tools_changed,
        ] {
            let state = McpState::default();
            let added = state
                .sync(1, vec![original.clone()])
                .expect("génération initiale");
            let first_generation = generation(&added.changed[0]);

            let changed = state
                .sync(2, vec![changed_server])
                .expect("changement reconnectant");

            assert_eq!(changed.changed.len(), 1);
            assert_eq!(
                changed.changed[0].previous_generation,
                Some(first_generation)
            );
            assert_ne!(generation(&changed.changed[0]), first_generation);
        }
    }

    #[test]
    fn sync_sorts_generation_changes_by_server_id() {
        let state = McpState::default();
        let result = state
            .sync(1, vec![remote_server("zulu"), remote_server("alpha")])
            .expect("ajouts valides");

        assert_eq!(
            result
                .changed
                .iter()
                .map(|change| change.server_id.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "zulu"]
        );
    }

    #[test]
    fn sync_preserves_previous_state_on_validation_duplicates_and_global_limits() {
        let state = McpState::default();
        let stable = remote_server("stable");
        state.sync(1, vec![stable.clone()]).expect("état initial");

        let mut invalid = remote_server("invalid");
        invalid.endpoint = "https://secret.example.com/mcp#interdit".to_owned();
        let duplicate = remote_server("duplicate");
        let too_many = server_with_tool_count("too-many", 65);
        let too_large = server_with_active_schema_bytes("too-large", ACTIVE_SCHEMA_LIMIT + 1);

        for servers in [
            vec![invalid],
            vec![duplicate.clone(), duplicate],
            vec![too_many],
            vec![too_large],
        ] {
            let error = state.sync(2, servers).expect_err("sync rejetée");
            assert_eq!(error.kind, McpErrorKind::InvalidConfig);
            assert!(!error.message.contains("secret.example.com"));
            assert_eq!(state.server("stable").expect("état préservé"), stable);
        }

        let applied = state
            .sync(2, vec![stable])
            .expect("révision encore disponible");
        assert!(applied.applied);
    }

    #[test]
    fn sync_accepts_exact_catalog_boundaries_and_ignores_disabled_items() {
        let state = McpState::default();
        let exact_schema = server_with_active_schema_bytes("exact-schema", ACTIVE_SCHEMA_LIMIT);
        state.sync(1, vec![exact_schema]).expect("256 Kio acceptés");

        let exact_tools = server_with_tool_count("exact-tools", 64);
        state
            .sync(2, vec![exact_tools])
            .expect("64 outils acceptés");

        let mut one_disabled = server_with_tool_count("one-disabled", 65);
        one_disabled.tools[64].enabled = false;
        state
            .sync(3, vec![one_disabled])
            .expect("outil désactivé exclu");

        let mut server_disabled = server_with_tool_count("server-disabled", 65);
        server_disabled.enabled = false;
        state
            .sync(4, vec![server_disabled])
            .expect("serveur désactivé exclu");
    }

    #[test]
    fn sync_does_not_mutate_received_servers() {
        let state = McpState::default();
        let servers = vec![remote_server("immutable")];
        let before = servers.clone();

        state.sync(1, servers.clone()).expect("sync valide");

        assert_eq!(servers, before);
    }

    #[test]
    fn begin_turn_validates_ids_rejects_duplicates_and_allows_reuse_after_finish() {
        let state = McpState::default();
        let first = state.begin_turn("turn").expect("tour créé");
        assert_eq!(first.turn_id, "turn");
        assert!(first.generation > 0);
        assert_eq!(
            state.begin_turn("turn").expect_err("doublon refusé").kind,
            McpErrorKind::InvalidArguments
        );

        for invalid in ["", "turn\n", &"t".repeat(129)] {
            assert_eq!(
                state
                    .begin_turn(invalid)
                    .expect_err("identifiant invalide")
                    .kind,
                McpErrorKind::InvalidArguments
            );
        }
        let unicode_boundary = "é".repeat(128);
        let unicode = state
            .begin_turn(&unicode_boundary)
            .expect("128 caractères acceptés");
        state.finish_turn(&unicode);

        state.finish_turn(&first);
        let reused = state.begin_turn("turn").expect("identifiant réutilisable");
        assert!(reused.generation > first.generation);

        let serialized = serde_json::to_value(&reused).expect("handle sérialisable");
        assert_eq!(
            serialized,
            json!({ "turnId": "turn", "generation": reused.generation })
        );
        assert_eq!(
            serde_json::from_value::<TurnHandle>(serialized).expect("handle désérialisable"),
            reused
        );
    }

    #[test]
    fn active_turn_limit_is_enforced_and_released_by_finish() {
        let state = McpState::default();
        let mut handles = Vec::with_capacity(ACTIVE_TURN_LIMIT);
        for index in 0..ACTIVE_TURN_LIMIT {
            handles.push(
                state
                    .begin_turn(&format!("turn-{index}"))
                    .expect("tour dans la limite"),
            );
        }
        assert_eq!(
            state
                .begin_turn("overflow-turn")
                .expect_err("limite de tours")
                .kind,
            McpErrorKind::InvalidArguments
        );

        state.finish_turn(&handles[0]);
        state.begin_turn("replacement-turn").expect("place libérée");
    }

    #[test]
    fn cancellation_before_calls_keeps_every_late_child_cancelled_until_finish() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let turn = state.begin_turn("turn").expect("tour créé");
        state.cancel_turn(&turn);

        for call_id in ["late-1", "late-2"] {
            let permit = state
                .begin_call(&turn, call_id, "remote", "search", CallScope::Assistant)
                .expect("appel tardif enregistré");
            assert!(permit.token.is_cancelled());
        }

        state.finish_turn(&turn);
        let fresh_turn = state.begin_turn("turn").expect("nouveau tour");
        let fresh = state
            .begin_call(
                &fresh_turn,
                "fresh",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("appel frais");
        assert!(!fresh.token.is_cancelled());
    }

    #[test]
    fn cancel_turn_cancels_parent_and_all_registered_calls_without_removing_the_turn() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let turn = state.begin_turn("turn").expect("tour créé");
        let first = state
            .begin_call(&turn, "first", "remote", "search", CallScope::Assistant)
            .expect("premier appel");
        let second = state
            .begin_call(&turn, "second", "remote", "search", CallScope::Assistant)
            .expect("second appel");

        state.cancel_turn(&turn);

        assert!(first.token.is_cancelled());
        assert!(second.token.is_cancelled());
        let late = state
            .begin_call(&turn, "late", "remote", "search", CallScope::Assistant)
            .expect("tour conservé");
        assert!(late.token.is_cancelled());
    }

    #[test]
    fn begin_call_requires_a_turn_valid_ids_and_unique_call_id() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let missing = TurnHandle {
            turn_id: "missing-turn".to_owned(),
            generation: 1,
        };
        assert_eq!(
            state
                .begin_call(&missing, "call", "remote", "search", CallScope::Assistant,)
                .err()
                .expect("tour absent")
                .kind,
            McpErrorKind::Cancelled
        );
        let turn = state.begin_turn("turn").expect("tour créé");
        let permit = state
            .begin_call(&turn, "call", "remote", "search", CallScope::Assistant)
            .expect("appel enregistré");
        assert_eq!(
            state
                .begin_call(&turn, "call", "remote", "search", CallScope::Assistant)
                .err()
                .expect("doublon refusé")
                .kind,
            McpErrorKind::InvalidArguments
        );
        for call_id in ["", "bad\0id", &"c".repeat(129)] {
            assert_eq!(
                state
                    .begin_call(&turn, call_id, "remote", "search", CallScope::Assistant)
                    .err()
                    .expect("identifiant invalide")
                    .kind,
                McpErrorKind::InvalidArguments
            );
        }
        drop(permit);
        assert_eq!(active_call_count(&state), 0);
    }

    #[test]
    fn seen_call_ids_reject_sequential_duplicate_after_guard_drop() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let turn = state.begin_turn("turn").expect("tour créé");
        let first = state
            .begin_call(&turn, "same-call", "remote", "search", CallScope::Assistant)
            .expect("premier appel");
        drop(first);
        assert_eq!(active_call_count(&state), 0);

        assert_eq!(
            state
                .begin_call(&turn, "same-call", "remote", "search", CallScope::Assistant)
                .err()
                .expect("identifiant déjà vu")
                .kind,
            McpErrorKind::InvalidArguments
        );
        assert_eq!(active_call_count(&state), 0);
    }

    #[test]
    fn begin_call_enforces_assistant_manual_and_tinyfish_policies() {
        let state = McpState::default();
        let mut remote = remote_server("remote");
        remote.enabled = false;
        remote.tools[0].enabled = false;
        state.sync(1, vec![remote]).expect("registre distant");
        let turn = state.begin_turn("turn").expect("tour créé");
        assert_eq!(
            state
                .begin_call(&turn, "assistant", "remote", "search", CallScope::Assistant,)
                .err()
                .expect("assistant bloqué")
                .kind,
            McpErrorKind::ToolDenied
        );
        let manual = state
            .begin_call(&turn, "manual", "remote", "search", CallScope::Manual)
            .expect("manuel autorisé");
        assert!(!manual.token.is_cancelled());
        drop(manual);

        state
            .sync(2, vec![tinyfish_server()])
            .expect("registre TinyFish");
        for (index, scope) in [CallScope::Assistant, CallScope::Manual]
            .into_iter()
            .enumerate()
        {
            let allowed = state
                .begin_call(
                    &turn,
                    &format!("allowed-{index}"),
                    "tinyfish",
                    "search",
                    scope,
                )
                .expect("outil autorisé");
            drop(allowed);
            assert_eq!(
                state
                    .begin_call(
                        &turn,
                        &format!("denied-{index}"),
                        "tinyfish",
                        "dangerous",
                        scope,
                    )
                    .err()
                    .expect("outil hors allowlist")
                    .kind,
                McpErrorKind::ToolDenied
            );
        }
        assert_eq!(
            state
                .begin_call(
                    &turn,
                    "unknown",
                    "tinyfish",
                    "unknown-secret-tool",
                    CallScope::Manual,
                )
                .err()
                .expect("outil inconnu")
                .kind,
            McpErrorKind::ToolNotFound
        );
    }

    #[test]
    fn reconnecting_sync_revokes_old_permits_but_name_only_keeps_them_alive() {
        let state = McpState::default();
        let original = remote_server("remote");
        state
            .sync(1, vec![original.clone()])
            .expect("registre prêt");
        let turn = state.begin_turn("turn").expect("tour créé");
        let old_permit = state
            .begin_call(&turn, "old-call", "remote", "search", CallScope::Assistant)
            .expect("ancien permis");

        let mut renamed = original;
        renamed.name = "Nouveau nom".to_owned();
        let name_only = state.sync(2, vec![renamed.clone()]).expect("renommage");
        assert!(name_only.changed.is_empty());
        assert!(!old_permit.token.is_cancelled());

        renamed.enabled = false;
        let disabled = state.sync(3, vec![renamed]).expect("désactivation");
        assert_eq!(disabled.changed.len(), 1);
        assert!(old_permit.token.is_cancelled());
        assert_eq!(active_call_count(&state), 0);

        let manual = state
            .begin_call(
                &turn,
                "manual-fallback",
                "remote",
                "search",
                CallScope::Manual,
            )
            .expect("fallback manuel sur génération courante");
        assert!(!manual.token.is_cancelled());
        assert_ne!(manual.server_generation, old_permit.server_generation);

        state.sync(4, Vec::new()).expect("suppression");
        assert!(manual.token.is_cancelled());
    }

    #[test]
    fn stale_cancel_and_finish_handles_do_not_touch_reused_turn() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let first_turn = state.begin_turn("turn").expect("premier tour");
        state.finish_turn(&first_turn);
        let second_turn = state.begin_turn("turn").expect("second tour");
        assert!(second_turn.generation > first_turn.generation);
        let current = state
            .begin_call(
                &second_turn,
                "current",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("appel courant");

        state.cancel_turn(&first_turn);
        state.finish_turn(&first_turn);

        assert!(!current.token.is_cancelled());
        let another = state
            .begin_call(
                &second_turn,
                "another",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("second tour toujours actif");
        assert!(!another.token.is_cancelled());
    }

    #[test]
    fn stale_turn_handle_is_rejected_by_begin_call_without_mutation() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let stale = state.begin_turn("turn").expect("premier tour");
        state.finish_turn(&stale);
        let current = state.begin_turn("turn").expect("second tour");

        assert_eq!(
            state
                .begin_call(
                    &stale,
                    "stale-call",
                    "remote",
                    "search",
                    CallScope::Assistant,
                )
                .err()
                .expect("handle obsolète")
                .kind,
            McpErrorKind::Cancelled
        );
        assert_eq!(active_call_count(&state), 0);
        let permit = state
            .begin_call(
                &current,
                "current-call",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("handle courant");
        assert!(!permit.token.is_cancelled());
    }

    #[test]
    fn stale_guard_cannot_remove_a_reused_call_after_finish() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let first_turn = state.begin_turn("turn").expect("tour initial");
        let stale = state
            .begin_call(
                &first_turn,
                "call",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("appel initial");
        state.finish_turn(&first_turn);
        let second_turn = state.begin_turn("turn").expect("tour réutilisé");
        let replacement = state
            .begin_call(
                &second_turn,
                "call",
                "remote",
                "search",
                CallScope::Assistant,
            )
            .expect("appel réutilisé");

        drop(stale);

        assert!(!replacement.token.is_cancelled());
        assert_eq!(active_call_count(&state), 1);
        drop(replacement);
        assert_eq!(active_call_count(&state), 0);
    }

    #[test]
    fn per_turn_call_limit_counts_all_seen_ids_including_sequential_calls() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let turn = state.begin_turn("turn").expect("tour créé");
        for index in 0..TURN_CALL_LIMIT {
            let permit = state
                .begin_call(
                    &turn,
                    &format!("call-{index}"),
                    "remote",
                    "search",
                    CallScope::Assistant,
                )
                .expect("appel séquentiel dans la limite");
            drop(permit);
        }
        assert_eq!(active_call_count(&state), 0);
        assert_eq!(
            state
                .begin_call(&turn, "overflow", "remote", "search", CallScope::Assistant,)
                .err()
                .expect("65e identifiant refusé")
                .kind,
            McpErrorKind::InvalidArguments
        );
    }

    #[test]
    fn global_call_limit_is_enforced_across_turns() {
        let state = McpState::default();
        state
            .sync(1, vec![remote_server("remote")])
            .expect("registre prêt");
        let mut permits = Vec::with_capacity(GLOBAL_CALL_LIMIT);
        for turn_index in 0..64 {
            let turn_id = format!("turn-{turn_index}");
            let turn = state.begin_turn(&turn_id).expect("tour créé");
            for call_index in 0..TURN_CALL_LIMIT {
                permits.push(
                    state
                        .begin_call(
                            &turn,
                            &format!("call-{call_index}"),
                            "remote",
                            "search",
                            CallScope::Assistant,
                        )
                        .expect("appel dans la limite globale"),
                );
            }
        }
        assert_eq!(active_call_count(&state), GLOBAL_CALL_LIMIT);
        let overflow_turn = state
            .begin_turn("overflow-turn")
            .expect("tour supplémentaire");
        assert_eq!(
            state
                .begin_call(
                    &overflow_turn,
                    "overflow-call",
                    "remote",
                    "search",
                    CallScope::Assistant,
                )
                .err()
                .expect("limite globale")
                .kind,
            McpErrorKind::InvalidArguments
        );

        drop(permits);
        assert_eq!(active_call_count(&state), 0);
    }

    #[test]
    fn poisoned_registry_and_turn_locks_are_recovered_without_panicking() {
        let state = McpState::default();
        let server = remote_server("poison-safe");
        state.sync(1, vec![server.clone()]).expect("registre prêt");

        let registry_poison = catch_unwind(AssertUnwindSafe(|| {
            let _guard = state
                .registry
                .write()
                .unwrap_or_else(PoisonError::into_inner);
            panic!("empoisonnement volontaire du registre");
        }));
        assert!(registry_poison.is_err());
        assert_eq!(
            state.server("poison-safe").expect("lecture récupérée"),
            server
        );
        assert!(state.sync(2, vec![server]).is_ok());

        let turns_poison = catch_unwind(AssertUnwindSafe(|| {
            let _guard = state.turns.lock().unwrap_or_else(PoisonError::into_inner);
            panic!("empoisonnement volontaire des tours");
        }));
        assert!(turns_poison.is_err());
        let turn = state.begin_turn("poison-turn").expect("tour récupéré");
        let permit = state
            .begin_call(
                &turn,
                "poison-call",
                "poison-safe",
                "search",
                CallScope::Assistant,
            )
            .expect("appel récupéré");
        drop(permit);
        assert_eq!(active_call_count(&state), 0);
    }
}
