// Tests d'intégration pour les commandes du connecteur GitHub.
// Utilise un faux serveur axum pour simuler l'API GitHub.

use crate::connectors::github::GithubClient;
use crate::connectors::service::ConnectorGithubService;
use axum::{routing::get, Json, Router};
use base64::Engine;
use serde_json::json;
use tokio::net::TcpListener;

async fn spawn_fake_github() -> (String, tokio::task::JoinHandle<()>) {
    let app = {
        Router::new()
            // GET /user - verification token
            .route("/user", get(|| async { Json(json!({ "login": "octocat" })) }))
            // GET /user/repos - pagination
            .route("/user/repos", get(|axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>| async move {
                let page: usize = params.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
                let per_page: usize = params.get("per_page").and_then(|p| p.parse().ok()).unwrap_or(50);
                let mut repos = Vec::new();
                for i in 0..per_page {
                    let idx = (page.saturating_sub(1)) * per_page + i + 1;
                    if idx > 120 { break; } // total 120 repos
                    repos.push(json!({
                        "full_name": format!("octocat/Repo-{}", idx),
                        "private": idx % 3 == 0,
                        "default_branch": "main",
                        "updated_at": "2024-01-01T00:00:00Z"
                    }));
                }
                Json(repos)
            }))
            // GET /repos/{owner}/{repo}/branches
            .route("/repos/octocat/Hello-World/branches", get(|| async {
                Json(vec![
                    json!({ "name": "main" }),
                    json!({ "name": "dev" }),
                    json!({ "name": "feature/x" }),
                ])
            }))
            // Branches pour un repo privé
            .route("/repos/octocat/private-repo/branches", get(|| async {
                Json(vec![json!({ "name": "main" })])
            }))
            // GET /repos/{owner}/{repo} - default branch
            .route("/repos/octocat/Hello-World", get(|| async {
                Json(json!({ "default_branch": "main" }))
            }))
            .route("/repos/octocat/private-repo", get(|| async {
                Json(json!({ "default_branch": "main" }))
            }))
            // GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1
            .route("/repos/octocat/Hello-World/git/trees/main", get(|| async {
                Json(json!({
                    "tree": [
                        { "path": "src/main.rs", "mode": "100644", "type": "blob", "sha": "abc123", "size": 100 },
                        { "path": "README.md", "mode": "100644", "type": "blob", "sha": "def456", "size": 200 },
                        { "path": ".git/config", "mode": "100644", "type": "blob", "sha": "ghi789", "size": 50 },
                        { "path": "node_modules/index.js", "mode": "100644", "type": "blob", "sha": "jjj", "size": 1000 },
                        { "path": "dist/bundle.js", "mode": "100644", "type": "blob", "sha": "kkk", "size": 5000 },
                    ],
                    "truncated": false
                }))
            }))
            // GET /repos/{owner}/{repo}/contents/{path}
            .route("/repos/octocat/Hello-World/contents/src/main.rs", get(|| async {
                let content = base64::engine::general_purpose::STANDARD.encode("fn main() {\n    println!(\"hello\");\n}");
                Json(json!({
                    "content": content,
                    "encoding": "base64",
                    "size": 40,
                    "download_url": "https://raw.githubusercontent.com/octocat/Hello-World/main/src/main.rs"
                }))
            }))
            // Fichier binaire
            .route("/repos/octocat/Hello-World/contents/binary.dat", get(|| async {
                let content = base64::engine::general_purpose::STANDARD.encode(&[0u8, 1, 2, 3, 255, 254, 0, 0, 0, 0]);
                Json(json!({
                    "content": content,
                    "encoding": "base64",
                    "size": 100,
                    "download_url": "https://raw.githubusercontent.com/octocat/Hello-World/main/binary.dat"
                }))
            }))
            // Fichier .env (refusé)
            .route("/repos/octocat/Hello-World/contents/.env", get(|| async {
                let content = base64::engine::general_purpose::STANDARD.encode("SECRET=123");
                Json(json!({
                    "content": content,
                    "encoding": "base64",
                    "size": 10,
                    "download_url": "https://raw.githubusercontent.com/octocat/Hello-World/main/.env"
                }))
            }))
            // GET /search/code
            .route("/search/code", get(|axum::extract::Query(_params): axum::extract::Query<std::collections::HashMap<String, String>>| async move {
                Json(json!({
                    "total_count": 5,
                    "incomplete_results": false,
                    "items": [
                        { "path": "src/main.rs", "name": "main.rs", "sha": "abc123", "url": "https://api.github.com/repos/octocat/Hello-World/contents/src/main.rs", "html_url": "https://github.com/octocat/Hello-World/blob/main/src/main.rs", "repository": { "full_name": "octocat/Hello-World" }, "text_matches": [] },
                        { "path": "src/lib.rs", "name": "lib.rs", "sha": "def456", "url": "https://api.github.com/repos/octocat/Hello-World/contents/src/lib.rs", "html_url": "https://github.com/octocat/Hello-World/blob/main/src/lib.rs", "repository": { "full_name": "octocat/Hello-World" }, "text_matches": [] },
                        { "path": "tests/test.rs", "name": "test.rs", "sha": "ghi789", "url": "https://api.github.com/repos/octocat/Hello-World/contents/tests/test.rs", "html_url": "https://github.com/octocat/Hello-World/blob/main/tests/test.rs", "repository": { "full_name": "octocat/Hello-World" }, "text_matches": [] },
                    ]
                }))
            }))
    };

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
async fn test_service_list_repos_pagination() {
    let (base_url, _handle) = spawn_fake_github().await;
    let client = GithubClient::for_test(base_url);
    let service = ConnectorGithubService::for_test(client);

    // Configurer le token d'abord
    service.configure("fake-token".into()).await.unwrap();

    // Page 1
    let res = service.list_repos(1).await.unwrap();
    assert_eq!(res.repos.len(), 50);
    assert_eq!(res.page, 1);
    assert!(res.has_more);

    // Page 2
    let res = service.list_repos(2).await.unwrap();
    assert_eq!(res.repos.len(), 50);
    assert!(res.has_more);

    // Page 3 (dernière, 20 repos restants sur 120)
    let res = service.list_repos(3).await.unwrap();
    assert_eq!(res.repos.len(), 20);
    assert!(!res.has_more);

    // Page invalide
    let err = service.list_repos(0).await.unwrap_err();
    assert!(matches!(err, crate::connectors::error::ConnectorError::InvalidArguments(_)));
}

#[tokio::test]
async fn test_service_list_branches() {
    let (base_url, _handle) = spawn_fake_github().await;
    let client = GithubClient::for_test(base_url);
    let service = ConnectorGithubService::for_test(client);

    // Configurer le token d'abord
    service.configure("fake-token".into()).await.unwrap();

    let branches = service.list_branches("octocat".into(), "Hello-World".into()).await.unwrap();
    assert_eq!(branches.len(), 3);
    assert!(branches.contains(&"main".to_string()));
    assert!(branches.contains(&"dev".to_string()));
}

#[tokio::test]
async fn test_service_configure_status_delete() {
    let (base_url, _handle) = spawn_fake_github().await;
    let client = GithubClient::for_test(base_url);
    let service = ConnectorGithubService::for_test(client);

    // Au début: non configuré
    let status = service.status().await.unwrap();
    assert!(!status.configured);
    assert!(status.login.is_none());

    // Configurer
    let cfg = service.configure("fake-token".into()).await.unwrap();
    assert!(cfg.configured);
    assert_eq!(cfg.login, "octocat");

    // Statut après config
    let status = service.status().await.unwrap();
    assert!(status.configured);
    assert_eq!(status.login, Some("octocat".into()));

    // Supprimer
    service.delete().await.unwrap();

    // Statut après suppression
    let status = service.status().await.unwrap();
    assert!(!status.configured);
    assert!(status.login.is_none());
}