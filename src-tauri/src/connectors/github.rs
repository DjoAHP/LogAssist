// Client HTTP GitHub — hôte fixe, timeouts, tailles bornées, headers obligatoires.
// Redirections désactivées (Policy::none()), lecture bornée, classification d'erreurs.

use super::error::{classify_reqwest_error, ConnectorError, ConnectorErrorKind};
use super::validation::{validate_owner, validate_name, validate_ref, validate_path};
use crate::connectors::validation::validate_query;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GITHUB_API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("LogAssist/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const CONFIGURE_TIMEOUT: Duration = Duration::from_secs(15);

const MAX_TREE_SIZE: usize = 8 * 1024 * 1024; // 8 MiB (GitHub max 7 MiB récursif)
const MAX_FILE_SIZE: usize = 512 * 1024; // 512 KiB
const MAX_JSON_SIZE: usize = 256 * 1024; // 256 KiB pour réponses JSON simples

fn connector_error_from_kind(kind: ConnectorErrorKind, msg: String) -> ConnectorError {
    use ConnectorErrorKind::*;
    match kind {
        NotConfigured => ConnectorError::NotConfigured(msg),
        Auth => ConnectorError::Auth(msg),
        Forbidden => ConnectorError::Forbidden(msg),
        RateLimit => ConnectorError::RateLimit(msg),
        NotFound => ConnectorError::NotFound(msg),
        TooLarge => ConnectorError::TooLarge(msg),
        Binary => ConnectorError::Binary(msg),
        DeniedPath => ConnectorError::DeniedPath(msg),
        Offline => ConnectorError::Offline(msg),
        Timeout => ConnectorError::Timeout(msg),
        InvalidArguments => ConnectorError::InvalidArguments(msg),
        Unknown => ConnectorError::Unknown(msg),
    }
}

// ===== Types de réponse (niveau module pour accessibilité aux tests) =====

#[derive(Deserialize)]
pub struct GitHubUser {
    pub login: String,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct RepoSummary {
    pub full_name: String,
    pub private: bool,
    pub default_branch: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
pub struct BranchShort {
    pub name: String,
}

#[derive(Deserialize)]
pub struct TreeResponse {
    pub tree: Vec<TreeEntry>,
    pub truncated: bool,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct TreeEntry {
    pub path: String,
    pub mode: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub sha: String,
    pub size: Option<u64>,
}

const FILTERED_DIRS: &[&str] = &[
    ".git", "node_modules", "dist", "build", "target", "vendor", ".venv", "__pycache__"
];

#[derive(Deserialize)]
pub struct ContentResponse {
    pub content: Option<String>,
    pub encoding: Option<String>,
    pub size: u64,
    pub download_url: Option<String>,
}

#[derive(Deserialize)]
pub struct SearchCodeResponse {
    pub total_count: u32,
    pub incomplete_results: bool,
    pub items: Vec<SearchCodeItem>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct SearchCodeItem {
    pub path: String,
    pub name: String,
    pub sha: String,
    pub url: String,
    pub html_url: String,
    pub repository: SearchCodeRepo,
    pub text_matches: Option<Vec<SearchTextMatch>>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct SearchCodeRepo {
    pub full_name: String,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct SearchTextMatch {
    pub fragment: String,
    pub matches: Vec<SearchMatchIndices>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct SearchMatchIndices {
    pub text: String,
    pub indices: Vec<u32>,
}

#[derive(Deserialize)]
pub struct RepoInfo {
    pub default_branch: String,
}

// ===== Client =====

#[derive(Debug, Clone)]
pub struct GithubClient {
    base_url: String,
    http: Client,
}

impl GithubClient {
    /// Client de production — hôte FIGÉ à api.github.com
    pub fn production() -> Self {
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .build()
            .expect("reqwest client");
        Self {
            base_url: GITHUB_API_BASE.to_string(),
            http,
        }
    }

    /// Client pour tests — hôte injectable (faux serveur axum)
    pub fn for_test(base_url: String) -> Self {
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .build()
            .expect("reqwest client");
        Self { base_url, http }
    }

    fn auth_headers(&self, token: &str) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(USER_AGENT),
        );
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            "X-GitHub-Api-Version",
            reqwest::header::HeaderValue::from_static("2022-11-28"),
        );
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }

    async fn get_bounded(&self, url: &str, token: &str, max_bytes: usize) -> Result<Vec<u8>, ConnectorError> {
        let resp = self
            .http
            .get(url)
            .headers(self.auth_headers(token))
            .send()
            .await
            .map_err(|e| ConnectorError::Unknown(format!("erreur réseau: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let kind = classify_reqwest_error(&reqwest::Error::from(resp.error_for_status().unwrap_err()));
            return Err(connector_error_from_kind(kind, format!("HTTP {}", status)));
        }

        let content_len = resp.content_length().unwrap_or(0) as usize;
        if content_len > max_bytes {
            return Err(ConnectorError::TooLarge(format!(
                "réponse {} octets > limite {}",
                content_len, max_bytes
            )));
        }

        let mut body = Vec::with_capacity(content_len.min(max_bytes));
        let mut stream = resp.bytes_stream();
        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| ConnectorError::Unknown(format!("lecture flux: {e}")))?;
            if body.len() + chunk.len() > max_bytes {
                return Err(ConnectorError::TooLarge("réponse tronquée (limite dépassée)".into()));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    // ---- GET /user (test de validité du token) ----
    pub async fn verify_token(&self, token: &str) -> Result<String, ConnectorError> {
        let url = format!("{}/user", self.base_url);
        let body = self.get_bounded(&url, token, MAX_JSON_SIZE).await?;
        let user: GitHubUser = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide /user: {e}")))?;
        Ok(user.login)
    }

    // ---- GET /user/repos (liste dépôts, tri activité récente) ----
    pub async fn list_repos(&self, token: &str, page: u32) -> Result<Vec<RepoSummary>, ConnectorError> {
        if page == 0 || page > 50 {
            return Err(ConnectorError::InvalidArguments("page invalide (1-50)".into()));
        }
        let url = format!(
            "{}/user/repos?sort=pushed&direction=desc&per_page=50&page={}",
            self.base_url, page
        );
        let body = self.get_bounded(&url, token, MAX_JSON_SIZE).await?;
        let repos: Vec<RepoSummary> = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide /user/repos: {e}")))?;
        Ok(repos)
    }

    // ---- GET /repos/{owner}/{repo}/branches (max 100) ----
    pub async fn list_branches(&self, token: &str, owner: &str, name: &str) -> Result<Vec<String>, ConnectorError> {
        validate_owner(owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;

        let url = format!("{}/repos/{}/{}/branches?per_page=100", self.base_url, owner, name);
        let body = self.get_bounded(&url, token, MAX_JSON_SIZE).await?;
        let branches: Vec<BranchShort> = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide branches: {e}")))?;
        Ok(branches.into_iter().map(|b| b.name).take(100).collect())
    }

    // ---- GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1 (repo_map) ----
    pub async fn get_tree(
        &self,
        token: &str,
        owner: &str,
        name: &str,
        ref_: &str,
        path_prefix: Option<&str>,
        depth: Option<usize>,
    ) -> Result<(Vec<TreeEntry>, bool), ConnectorError> {
        validate_owner(owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_ref(ref_).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        if let Some(p) = path_prefix {
            validate_path(p).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        }

        let mut url = format!("{}/repos/{}/{}/git/trees/{}?recursive=1", self.base_url, owner, name, ref_);
        if let Some(p) = path_prefix {
            url.push_str(&format!("&path={}", p));
        }
        let body = self.get_bounded(&url, token, MAX_TREE_SIZE).await?;
        let resp: TreeResponse = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide tree: {e}")))?;

        let mut entries = resp.tree;
        entries.retain(|e| {
            !FILTERED_DIRS.iter().any(|d| e.path.starts_with(&format!("{}/", d)) || e.path == *d)
        });
        if let Some(d) = depth {
            entries.retain(|e| e.path.matches('/').count() < d);
        }
        if let Some(p) = path_prefix {
            entries.retain(|e| e.path.starts_with(p));
        }

        const MAX_ENTRIES: usize = 400;
        const MAX_CHARS: usize = 30_000;
        let mut char_count = 0;
        let mut truncated = resp.truncated;
        entries = entries
            .into_iter()
            .take_while(|e| {
                char_count += e.path.len() + 2;
                if char_count > MAX_CHARS {
                    truncated = true;
                    false
                } else {
                    true
                }
            })
            .take(MAX_ENTRIES)
            .collect();
        if entries.len() == MAX_ENTRIES {
            truncated = true;
        }

        Ok((entries, truncated))
    }

    // ---- GET /repos/{owner}/{repo}/contents/{path}?ref={ref} (read_file) ----
    pub async fn get_file_content(
        &self,
        token: &str,
        owner: &str,
        name: &str,
        path: &str,
        ref_: &str,
        start_line: Option<usize>,
        end_line: Option<usize>,
    ) -> Result<(String, bool), ConnectorError> {
        validate_owner(owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_path(path).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_ref(ref_).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;

        let url = format!("{}/repos/{}/{}/contents/{}?ref={}", self.base_url, owner, name, path, ref_);
        let body = self.get_bounded(&url, token, MAX_FILE_SIZE).await?;
        let content: ContentResponse = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide contents: {e}")))?;

        if content.encoding.as_deref() != Some("base64") {
            return Err(ConnectorError::InvalidArguments("encodage non base64".into()));
        }
        let raw = content.content.unwrap_or_default();
        let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, raw)
            .map_err(|e| ConnectorError::InvalidArguments(format!("base64 invalide: {e}")))?;
        
        let check_len = decoded.len().min(8192);
        if decoded[..check_len].contains(&0) {
            return Err(ConnectorError::Binary("fichier binaire détecté (NUL)".into()));
        }

        let text = String::from_utf8(decoded)
            .map_err(|_| ConnectorError::Binary("contenu non UTF-8".into()))?;

        let lines: Vec<&str> = text.lines().collect();
        let total_lines = lines.len();
        
        let start = start_line.unwrap_or(1).min(total_lines + 1);
        let end = end_line.unwrap_or(total_lines).min(total_lines);
        if start > end {
            return Err(ConnectorError::InvalidArguments("start_line > end_line".into()));
        }

        let mut result = String::new();
        for (i, line) in lines[start - 1..end].iter().enumerate() {
            result.push_str(&format!("{}|{}\n", start + i, line));
        }
        let truncated = total_lines > 400 || result.len() > 24_000;
        if total_lines > 400 {
            result.push_str(&format!("\n[... total {} lignes, continue avec start_line={} ...]", total_lines, end + 1));
        } else if result.len() > 24_000 {
            result.push_str(&format!("\n[... tronqué à 24k car, continue avec start_line={} ...]", end + 1));
        }

        Ok((result, truncated))
    }

    // ---- GET /search/code?q={query}+repo:{owner}/{name} (search_code) ----
    pub async fn search_code(
        &self,
        token: &str,
        owner: &str,
        name: &str,
        ref_: &str,
        query: &str,
    ) -> Result<(Vec<SearchCodeItem>, bool, bool), ConnectorError> {
        validate_owner(owner).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_name(name).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_ref(ref_).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;
        validate_query(query).map_err(|e| ConnectorError::InvalidArguments(e.to_string()))?;

        let full_query = format!("{} repo:{}/{}", query, owner, name);
        let encoded_query = urlencoding::encode(&full_query);
        let url = format!("{}/search/code?q={}&per_page=20", self.base_url, encoded_query);
        
        let body = self.get_bounded(&url, token, MAX_JSON_SIZE).await?;
        let resp: SearchCodeResponse = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide search: {e}")))?;

        let default_branch = self.get_default_branch(token, owner, name).await?;
        let ref_differs = ref_ != default_branch;

        let mut items = resp.items;
        items.truncate(20);
        
        Ok((items, ref_differs, resp.incomplete_results))
    }

    async fn get_default_branch(&self, token: &str, owner: &str, name: &str) -> Result<String, ConnectorError> {
        let url = format!("{}/repos/{}/{}", self.base_url, owner, name);
        let body = self.get_bounded(&url, token, MAX_JSON_SIZE).await?;
        let info: RepoInfo = serde_json::from_slice(&body)
            .map_err(|e| ConnectorError::InvalidArguments(format!("JSON invalide repo: {e}")))?;
        Ok(info.default_branch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use tokio::net::TcpListener;

    async fn spawn_fake_github() -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new()
            .route("/user", get(|| async { Json(serde_json::json!({ "login": "octocat" })) }))
            .route("/user/repos", get(|| async {
                Json(vec![
                    serde_json::json!({
                        "full_name": "octocat/Hello-World",
                        "private": false,
                        "default_branch": "main",
                        "updated_at": "2024-01-01T00:00:00Z"
                    })
                ])
            }))
            .route("/repos/octocat/Hello-World/branches", get(|| async {
                Json(vec![serde_json::json!({ "name": "main" }), serde_json::json!({ "name": "dev" })])
            }))
            .route("/repos/octocat/Hello-World/git/trees/main", get(|| async {
                Json(serde_json::json!({
                    "tree": [
                        { "path": "src/main.rs", "mode": "100644", "type": "blob", "sha": "abc123", "size": 100 },
                        { "path": "README.md", "mode": "100644", "type": "blob", "sha": "def456", "size": 200 },
                        { "path": ".git/config", "mode": "100644", "type": "blob", "sha": "ghi789", "size": 50 }
                    ],
                    "truncated": false
                }))
            }))
            .route("/repos/octocat/Hello-World/contents/src/main.rs", get(|| async {
                let content = base64::engine::general_purpose::STANDARD.encode("fn main() {\n    println!(\"hello\");\n}");
                Json(serde_json::json!({
                    "content": content,
                    "encoding": "base64",
                    "size": 40,
                    "download_url": "https://raw.githubusercontent.com/octocat/Hello-World/main/src/main.rs"
                }))
            }))
            .route("/repos/octocat/Hello-World", get(|| async {
                Json(serde_json::json!({ "default_branch": "main" }))
            }))
            .route("/search/code", get(|axum::extract::Query(_params): axum::extract::Query<std::collections::HashMap<String, String>>| async move {
                Json(serde_json::json!({
                    "total_count": 1,
                    "incomplete_results": false,
                    "items": [{
                        "path": "src/main.rs",
                        "name": "main.rs",
                        "sha": "abc123",
                        "url": "https://api.github.com/repos/octocat/Hello-World/contents/src/main.rs",
                        "html_url": "https://github.com/octocat/Hello-World/blob/main/src/main.rs",
                        "repository": { "full_name": "octocat/Hello-World" },
                        "text_matches": []
                    }]
                }))
            }));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{}", addr);
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        (base_url, handle)
    }

    #[tokio::test]
    async fn test_verify_token_success() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let login = client.verify_token("fake-token").await.unwrap();
        assert_eq!(login, "octocat");
    }

    #[tokio::test]
    async fn test_list_repos() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let repos = client.list_repos("fake-token", 1).await.unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].full_name, "octocat/Hello-World");
        assert!(!repos[0].private);
    }

    #[tokio::test]
    async fn test_list_branches() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let branches = client.list_branches("fake-token", "octocat", "Hello-World").await.unwrap();
        assert_eq!(branches.len(), 2);
        assert!(branches.contains(&"main".to_string()));
    }

    #[tokio::test]
    async fn test_get_tree_filters_git() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let (entries, truncated) = client.get_tree("fake-token", "octocat", "Hello-World", "main", None, None).await.unwrap();
        assert!(!truncated);
        assert!(!entries.iter().any(|e| e.path.starts_with(".git/")));
        assert!(entries.iter().any(|e| e.path == "src/main.rs"));
    }

    #[tokio::test]
    async fn test_get_file_content() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let (content, truncated) = client.get_file_content("fake-token", "octocat", "Hello-World", "src/main.rs", "main", None, None).await.unwrap();
        assert!(!truncated);
        assert!(content.contains("fn main()"));
        assert!(content.contains("1|fn main()"));
    }

    #[tokio::test]
    async fn test_search_code() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let (items, ref_differs, incomplete) = client.search_code("fake-token", "octocat", "Hello-World", "main", "function").await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "src/main.rs");
        assert!(!ref_differs);
        assert!(!incomplete);
    }

    #[tokio::test]
    async fn test_validate_owner_rejects_invalid() {
        let (base_url, _handle) = spawn_fake_github().await;
        let client = GithubClient::for_test(base_url);
        let result = client.list_branches("fake-token", "-invalid", "repo").await;
        assert!(result.is_err());
    }
}