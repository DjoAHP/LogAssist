// Service connecteur GitHub — état Tauri, registre d'annulation par turn_id.

use super::error::ConnectorError;
use super::github::{GithubClient, RepoSummary, TreeEntry, SearchCodeItem};
use super::validation::{validate_owner, validate_name, validate_ref, validate_path};
use crate::connectors::validation::validate_query;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

const GITHUB_SECRET_REF: &str = "logassist/connectors/github";
const GITHUB_LOGIN_KEY: &str = "connectors.github.login";

// ---- Enveloppe versionnée du secret ----
#[derive(Serialize, Deserialize)]
struct SecretEnvelope {
    version: u32,
    token: String,
}

// ---- DTOs commandes ----
#[derive(Serialize, Deserialize, Debug)]
pub struct ConfigureResult {
    pub configured: bool,
    pub login: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct StatusResult {
    pub configured: bool,
    pub login: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ListReposResult {
    pub repos: Vec<RepoSummary>,
    pub page: u32,
    pub has_more: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CallToolResult {
    pub text: String,
    pub truncated: bool,
}

#[derive(Deserialize, Debug)]
pub struct CallToolArgs {
    pub owner: String,
    pub name: String,
    pub ref_: Option<String>,
    pub tool: String,
    pub args: serde_json::Value,
    pub turn_id: String,
}

// ---- Service géré par Tauri ----
pub struct ConnectorGithubService {
    github: GithubClient,
    // turn_id -> liste de canaux d'annulation
    cancellations: Arc<Mutex<HashMap<String, Vec<oneshot::Sender<()>>>>>,
    // Mode test : stockage en mémoire au lieu du Credential Manager
    #[cfg(test)]
    test_storage: Option<Arc<Mutex<TestStorage>>>,
}

#[cfg(test)]
#[derive(Default)]
struct TestStorage {
    token: Option<String>,
    login: Option<String>,
}

impl ConnectorGithubService {
    pub fn new() -> Self {
        Self {
            github: GithubClient::production(),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(test)]
            test_storage: None,
        }
    }

    /// Constructeur pour tests — injecte un client GitHub (ex: faux serveur axum)
    #[cfg(test)]
    pub fn for_test(github: GithubClient) -> Self {
        Self {
            github,
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            test_storage: Some(Arc::new(Mutex::new(TestStorage::default()))),
        }
    }

    /// Constructeur pour tests sans client (utilise le client de production)
    #[cfg(test)]
    pub fn for_test_default() -> Self {
        Self {
            github: GithubClient::production(),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            test_storage: Some(Arc::new(Mutex::new(TestStorage::default()))),
        }
    }

    // Lecture du secret (Credential Manager) — appelle keyring directement pour éviter les problèmes d'inférence de type.
    fn read_token(&self) -> Result<Option<String>, ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let storage = storage.lock().unwrap();
            return Ok(storage.token.clone());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF).map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        match entry.get_password() {
            Ok(val) => {
                let env: SecretEnvelope = serde_json::from_str(&val)
                    .map_err(|e| ConnectorError::Unknown(format!("secret invalide: {e}")))?;
                Ok(Some(env.token))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(ConnectorError::Unknown(format!("lecture secret: {e}"))),
        }
    }

    // Écriture du secret (Credential Manager)
    fn write_token(&self, token: &str) -> Result<(), ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.token = Some(token.to_string());
            return Ok(());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let env = SecretEnvelope { version: 1, token: token.to_string() };
        let json = serde_json::to_string(&env).unwrap();
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF).map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        entry.set_password(&json).map_err(|e| ConnectorError::Unknown(format!("écriture secret: {e}")))?;
        Ok(())
    }

    // Suppression du secret
    fn delete_token(&self) -> Result<(), ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.token = None;
            return Ok(());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF).map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // idempotent
            Err(e) => Err(ConnectorError::Unknown(format!("suppression secret: {e}"))),
        }
    }

    // Lecture du login stocké (table settings)
    async fn read_login(&self) -> Result<Option<String>, ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let storage = storage.lock().unwrap();
            return Ok(storage.login.clone());
        }
        // Utiliser le pool SQL via tauri_plugin_sql
        // Pour l'instant, on passe par une commande Rust existante si dispo
        // TODO: implémenter la lecture directe via le pool SQLite
        Ok(None)
    }

    // Écriture du login
    async fn write_login(&self, login: &str) -> Result<(), ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.login = Some(login.to_string());
            return Ok(());
        }
        // TODO: implémenter via pool SQLite
        Ok(())
    }

    // Suppression du login
    async fn delete_login(&self) -> Result<(), ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.login = None;
            return Ok(());
        }
        // TODO: implémenter via pool SQLite
        Ok(())
    }

    // Enregistrement d'un turn pour annulation
    pub fn register_turn(&self, turn_id: String) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        let mut map = self.cancellations.lock().unwrap();
        map.entry(turn_id).or_default().push(tx);
        rx
    }

    // Annulation de tous les appels d'un turn
    pub fn cancel_turn(&self, turn_id: &str) {
        let mut map = self.cancellations.lock().unwrap();
        if let Some(senders) = map.remove(turn_id) {
            for tx in senders {
                let _ = tx.send(());
            }
        }
    }

    // Nettoyage après fin de turn
    pub fn finish_turn(&self, turn_id: &str) {
        self.cancellations.lock().unwrap().remove(turn_id);
    }

    // ===== Commandes publiques =====

    /// Configure le token : test GET /user, puis stockage si succès.
    pub async fn configure(&self, token: String) -> Result<ConfigureResult, ConnectorError> {
        if token.trim().is_empty() {
            return Err(ConnectorError::InvalidArguments("token vide".into()));
        }
        if token.len() > 255 {
            return Err(ConnectorError::InvalidArguments("token trop long".into()));
        }
        let login = self.github.verify_token(&token).await?;
        self.write_token(&token)?;
        self.write_login(&login).await?;
        Ok(ConfigureResult { configured: true, login })
    }

    /// Statut du connecteur (sans jamais retourner le token).
    pub async fn status(&self) -> Result<StatusResult, ConnectorError> {
        let token = self.read_token()?;
        let login = self.read_login().await?;
        Ok(StatusResult {
            configured: token.is_some(),
            login,
        })
    }

    /// Supprime le token et le login.
    pub async fn delete(&self) -> Result<(), ConnectorError> {
        self.delete_token()?;
        self.delete_login().await?;
        Ok(())
    }

    /// Liste les dépôts (page 1-50).
    pub async fn list_repos(&self, page: u32) -> Result<ListReposResult, ConnectorError> {
        let token = self.read_token()?.ok_or(ConnectorError::NotConfigured("GitHub non configuré".into()))?;
        if page == 0 || page > 50 {
            return Err(ConnectorError::InvalidArguments("page invalide (1-50)".into()));
        }
        let repos = self.github.list_repos(&token, page).await?;
        let has_more = repos.len() == 50;
        Ok(ListReposResult { repos, page, has_more })
    }

    /// Liste les branches d'un dépôt (max 100).
    pub async fn list_branches(&self, owner: String, name: String) -> Result<Vec<String>, ConnectorError> {
        let token = self.read_token()?.ok_or(ConnectorError::NotConfigured("GitHub non configuré".into()))?;
        validate_owner(&owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(&name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        let branches = self.github.list_branches(&token, &owner, &name).await?;
        Ok(branches)
    }

    /// Appelle un outil (repo_map, read_file, search_code) avec annulation par turn_id.
    pub async fn call_tool(&self, args: CallToolArgs) -> Result<CallToolResult, ConnectorError> {
        let token = self.read_token()?.ok_or(ConnectorError::NotConfigured("GitHub non configuré".into()))?;

        let owner = args.owner;
        let name = args.name;
        let ref_ = args.ref_.unwrap_or_else(|| "main".to_string());
        let tool = args.tool;
        let tool_args = args.args;
        let turn_id = args.turn_id;

        // Enregistrement pour annulation
        let cancel_rx = self.register_turn(turn_id.clone());
        tokio::pin!(cancel_rx);

        let result = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                return Err(ConnectorError::Timeout("annulé par l'utilisateur".into()));
            }
            res = async {
                match tool.as_str() {
                    "repo_map" => {
                        let path = tool_args.get("path").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let depth = tool_args.get("depth").and_then(|v| v.as_u64()).map(|d| d as usize);
                        let (entries, truncated) = self.github.get_tree(&token, &owner, &name, &ref_, path.as_deref(), depth).await?;
                        let text = serde_json::to_string_pretty(&entries).unwrap();
                        Ok(CallToolResult { text, truncated })
                    }
                    "read_file" => {
                        let path = tool_args.get("path").and_then(|v| v.as_str()).ok_or(ConnectorError::InvalidArguments("path requis".into()))?;
                        let start_line = tool_args.get("start_line").and_then(|v| v.as_u64()).map(|v| v as usize);
                        let end_line = tool_args.get("end_line").and_then(|v| v.as_u64()).map(|v| v as usize);
                        let (content, truncated) = self.github.get_file_content(&token, &owner, &name, path, &ref_, start_line, end_line).await?;
                        Ok(CallToolResult { text: content, truncated })
                    }
                    "search_code" => {
                        let query = tool_args.get("query").and_then(|v| v.as_str()).ok_or(ConnectorError::InvalidArguments("query requis".into()))?;
                        let (items, ref_differs, incomplete) = self.github.search_code(&token, &owner, &name, &ref_, query).await?;
                        let mut text = serde_json::to_string_pretty(&items).unwrap();
                        if ref_differs {
                            text = format!("⚠ Recherche limitée à la branche par défaut (la liaison pointe sur '{}').\n\n{}", ref_, text);
                        }
                        if incomplete {
                            text.push_str("\n\n[Résultats incomplets — timeout de l'API GitHub]");
                        }
                        Ok(CallToolResult { text, truncated: false })
                    }
                    _ => Err(ConnectorError::InvalidArguments(format!("outil inconnu: {}", tool))),
                }
            } => res
        };

        self.finish_turn(&turn_id);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::github::GithubClient;

    #[tokio::test]
    async fn test_service_register_cancel() {
        let service = ConnectorGithubService::new();
        let turn_id = "test-turn-1";
        let _rx = service.register_turn(turn_id.to_string());
        service.cancel_turn(turn_id);
        // Deuxième cancel ne doit pas paniquer
        service.cancel_turn(turn_id);
    }

    #[tokio::test]
    async fn test_service_finish_turn() {
        let service = ConnectorGithubService::new();
        let turn_id = "test-turn-2";
        let _rx = service.register_turn(turn_id.to_string());
        service.finish_turn(turn_id);
        // finish_turn idempotent
        service.finish_turn(turn_id);
    }
}