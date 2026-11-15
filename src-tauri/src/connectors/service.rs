// Service connecteur GitHub — état Tauri, registre d'annulation par turn_id.

use super::error::ConnectorError;
use super::github::{GithubClient, LineRange, RepoSummary};
use super::validation::{validate_name, validate_owner};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

const GITHUB_SECRET_REF: &str = "logassist/connectors/github";

// ---- Enveloppe versionnée du secret ----
#[derive(Clone, Serialize, Deserialize)]
struct SecretEnvelope {
    version: u32,
    token: String,
    #[serde(default)]
    login: Option<String>,
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
    credentials: Option<SecretEnvelope>,
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

    // Le login est stocké dans la même enveloppe Credential Manager que le
    // jeton. SQLite ne contient ainsi ni secret ni état désynchronisé.
    fn read_credentials(&self) -> Result<Option<SecretEnvelope>, ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let storage = storage.lock().unwrap();
            return Ok(storage.credentials.clone());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF)
            .map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        match entry.get_password() {
            Ok(val) => {
                let env: SecretEnvelope = serde_json::from_str(&val)
                    .map_err(|e| ConnectorError::Unknown(format!("secret invalide: {e}")))?;
                Ok(Some(env))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(ConnectorError::Unknown(format!("lecture secret: {e}"))),
        }
    }

    fn write_credentials(&self, token: &str, login: &str) -> Result<(), ConnectorError> {
        let envelope = SecretEnvelope {
            version: 1,
            token: token.to_string(),
            login: Some(login.to_string()),
        };
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.credentials = Some(envelope);
            return Ok(());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let json = serde_json::to_string(&envelope)
            .map_err(|e| ConnectorError::Unknown(format!("encodage secret: {e}")))?;
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF)
            .map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        entry
            .set_password(&json)
            .map_err(|e| ConnectorError::Unknown(format!("écriture secret: {e}")))?;
        Ok(())
    }

    fn delete_credentials(&self) -> Result<(), ConnectorError> {
        #[cfg(test)]
        if let Some(storage) = &self.test_storage {
            let mut storage = storage.lock().unwrap();
            storage.credentials = None;
            return Ok(());
        }
        use keyring::Entry;
        const SERVICE: &str = "LogAssist";
        let entry = Entry::new(SERVICE, GITHUB_SECRET_REF)
            .map_err(|e| ConnectorError::Unknown(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // idempotent
            Err(e) => Err(ConnectorError::Unknown(format!("suppression secret: {e}"))),
        }
    }

    fn require_token(&self) -> Result<String, ConnectorError> {
        self.read_credentials()?
            .map(|credentials| credentials.token)
            .ok_or_else(|| ConnectorError::NotConfigured("GitHub non configuré".into()))
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
        if !token.bytes().all(|byte| byte.is_ascii_graphic()) {
            return Err(ConnectorError::InvalidArguments(
                "token contient des caractères non autorisés".into(),
            ));
        }
        let login = self.github.verify_token(&token).await?;
        self.write_credentials(&token, &login)?;
        Ok(ConfigureResult {
            configured: true,
            login,
        })
    }

    /// Statut du connecteur (sans jamais retourner le token).
    pub async fn status(&self) -> Result<StatusResult, ConnectorError> {
        let credentials = self.read_credentials()?;
        Ok(StatusResult {
            configured: credentials.is_some(),
            login: credentials.and_then(|value| value.login),
        })
    }

    /// Supprime le token et le login.
    pub async fn delete(&self) -> Result<(), ConnectorError> {
        self.delete_credentials()
    }

    /// Liste les dépôts (page 1-50).
    pub async fn list_repos(&self, page: u32) -> Result<ListReposResult, ConnectorError> {
        let token = self.require_token()?;
        if page == 0 || page > 50 {
            return Err(ConnectorError::InvalidArguments(
                "page invalide (1-50)".into(),
            ));
        }
        let repos = self.github.list_repos(&token, page).await?;
        let has_more = repos.len() == 50;
        Ok(ListReposResult {
            repos,
            page,
            has_more,
        })
    }

    /// Liste les branches d'un dépôt (max 100).
    pub async fn list_branches(
        &self,
        owner: String,
        name: String,
    ) -> Result<Vec<String>, ConnectorError> {
        let token = self.require_token()?;
        validate_owner(&owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(&name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        let branches = self.github.list_branches(&token, &owner, &name).await?;
        Ok(branches)
    }

    /// Appelle un outil (repo_map, read_file, search_code) avec annulation par turn_id.
    pub async fn call_tool(&self, args: CallToolArgs) -> Result<CallToolResult, ConnectorError> {
        let token = self.require_token()?;

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
                        let (content, truncated) = self
                            .github
                            .get_file_content(
                                &token,
                                &owner,
                                &name,
                                path,
                                &ref_,
                                LineRange {
                                    start: start_line,
                                    end: end_line,
                                },
                            )
                            .await?;
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

impl Default for ConnectorGithubService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_envelope_accepts_legacy_values_without_login() {
        let envelope: SecretEnvelope =
            serde_json::from_str(r#"{"version":1,"token":"github_pat_test"}"#).unwrap();

        assert_eq!(envelope.token, "github_pat_test");
        assert_eq!(envelope.login, None);
    }

    #[test]
    fn secret_envelope_round_trip_keeps_login_with_token() {
        let serialized = serde_json::to_string(&SecretEnvelope {
            version: 1,
            token: "github_pat_test".to_string(),
            login: Some("octocat".to_string()),
        })
        .unwrap();
        let envelope: SecretEnvelope = serde_json::from_str(&serialized).unwrap();

        assert_eq!(envelope.token, "github_pat_test");
        assert_eq!(envelope.login.as_deref(), Some("octocat"));
    }

    #[tokio::test]
    async fn configure_rejects_control_characters_before_building_headers() {
        let service = ConnectorGithubService::for_test_default();

        let result = service.configure("github_pat_test\r\nInjected: value".into()).await;

        assert!(matches!(result, Err(ConnectorError::InvalidArguments(_))));
    }

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
