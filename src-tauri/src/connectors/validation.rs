// Validation des entrées pour le connecteur GitHub.
// Toutes les validations sont côté Rust — jamais déléguées à React.

use once_cell::sync::Lazy;
use regex::Regex;
use std::borrow::Cow;
use url::Url;

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("owner invalide : {0}")]
    Owner(String),
    #[error("nom de dépôt invalide : {0}")]
    Name(String),
    #[error("ref invalide : {0}")]
    Ref(String),
    #[error("chemin invalide : {0}")]
    Path(String),
    #[error("requête de recherche invalide : {0}")]
    Query(String),
}

// ---- Owner GitHub : ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ----
static OWNER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}$").unwrap());

pub fn validate_owner(owner: &str) -> Result<(), ValidationError> {
    if owner.is_empty() {
        return Err(ValidationError::Owner("ne peut pas être vide".into()));
    }
    if owner.len() > 39 {
        return Err(ValidationError::Owner("trop long (max 39)".into()));
    }
    if !OWNER_RE.is_match(owner) {
        return Err(ValidationError::Owner("caractères non autorisés (alphanum + tiret, sans tiret initial)".into()));
    }
    Ok(())
}

// ---- Nom de dépôt : ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ (ne commence pas par . ni -) ----
static NAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$").unwrap());

pub fn validate_name(name: &str) -> Result<(), ValidationError> {
    if name.is_empty() {
        return Err(ValidationError::Name("ne peut pas être vide".into()));
    }
    if name.len() > 100 {
        return Err(ValidationError::Name("trop long (max 100)".into()));
    }
    if !NAME_RE.is_match(name) {
        return Err(ValidationError::Name("caractères non autorisés ou commence par . / - / _".into()));
    }
    // Interdire ".." et noms réservés
    if name == "." || name == ".." || name.contains("..") {
        return Err(ValidationError::Name("nom réservé ou invalide".into()));
    }
    Ok(())
}

// ---- Ref (branche/tag/commit) : ≤255, pas de "..", pas de contrôle, pas de / en début/fin ----
pub fn validate_ref(ref_: &str) -> Result<(), ValidationError> {
    if ref_.is_empty() {
        return Err(ValidationError::Ref("ne peut pas être vide".into()));
    }
    if ref_.len() > 255 {
        return Err(ValidationError::Ref("trop long (max 255)".into()));
    }
    if ref_.contains("..") {
        return Err(ValidationError::Ref("contient '..'".into()));
    }
    if ref_.chars().any(|c| c.is_control()) {
        return Err(ValidationError::Ref("contient des caractères de contrôle".into()));
    }
    if ref_.starts_with('/') || ref_.ends_with('/') {
        return Err(ValidationError::Ref("ne doit pas commencer ou finir par '/'".into()));
    }
    Ok(())
}

// ---- Path fichier : relatif, sans "..", sans "\", sans NUL, ≤512, segments URL-encodés ----
const DENIED_EXACT_PATHS: &[&str] = &[
    ".env",
    ".npmrc",
    ".pypirc",
    "credentials",
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    "id_ecdsa",
];

const DENIED_PREFIX_PATHS: &[&str] = &[
    ".env.",
    ".npmrc.",
    ".pypirc.",
    "credentials.",
];

const DENIED_EXTS: &[&str] = &[".pem", ".key", ".p12", ".pfx"];

pub fn validate_path(path: &str) -> Result<(), ValidationError> {
    if path.is_empty() {
        return Err(ValidationError::Path("ne peut pas être vide".into()));
    }
    if path.len() > 512 {
        return Err(ValidationError::Path("trop long (max 512)".into()));
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(ValidationError::Path("chemin absolu interdit".into()));
    }
    if path.contains("..") {
        return Err(ValidationError::Path("contient '..'".into()));
    }
    if path.contains('\\') {
        return Err(ValidationError::Path("antislash interdit".into()));
    }
    if path.contains('\0') {
        return Err(ValidationError::Path("NUL interdit".into()));
    }
    // Rejeter espaces non encodés
    if path.contains(' ') {
        return Err(ValidationError::Path("espace non encodé (utilisez %20)".into()));
    }
    // Vérifier les segments encodés via Url (construction factice)
    let dummy = format!("https://example.com/{}", path);
    if Url::parse(&dummy).is_err() {
        return Err(ValidationError::Path("segments non valides (encodage URL requis)".into()));
    }
    // Fichiers sensibles (basename)
    let basename = path.split('/').last().unwrap_or("");
    let lower = basename.to_lowercase();
    // Correspondances exactes interdites
    if DENIED_EXACT_PATHS.iter().any(|d| lower == *d) {
        return Err(ValidationError::Path("fichier refusé pour raisons de sécurité".into()));
    }
    // Préfixes interdits (.env.local, .env.production, etc.) MAIS on autorise .env.example et .env.sample
    if DENIED_PREFIX_PATHS.iter().any(|d| lower.starts_with(d)) {
        // Exception pour les templates autorisés
        if !(lower == ".env.example" || lower == ".env.sample") {
            return Err(ValidationError::Path("fichier refusé pour raisons de sécurité".into()));
        }
    }
    // Extensions interdites
    if DENIED_EXTS.iter().any(|e| lower.ends_with(e)) {
        return Err(ValidationError::Path("fichier refusé pour raisons de sécurité".into()));
    }
    Ok(())
}

// ---- Query recherche code : ≤256, au moins un terme hors qualificateur "mot:" ----
// Qualificateurs GitHub Code Search reconnus (liste non exhaustive)
const QUALIFIERS: &[&str] = &[
    "repo", "language", "user", "org", "path", "filename", "extension", "in", "size",
    "created", "pushed", "archived", "mirror", "fork", "visibility", "license", "topic",
    "stars", "forks", "followers", "repos", "location",
];

fn is_qualifier(term: &str) -> bool {
    term.split(':').next().map_or(false, |q| QUALIFIERS.contains(&q))
}

pub fn validate_query(query: &str) -> Result<(), ValidationError> {
    if query.is_empty() {
        return Err(ValidationError::Query("ne peut pas être vide".into()));
    }
    if query.len() > 256 {
        return Err(ValidationError::Query("trop long (max 256)".into()));
    }
    // Au moins un terme sans "qualifier:" (terme nu)
    let has_bare_term = query.split_whitespace().any(|term| !term.contains(':') || !is_qualifier(term));
    if !has_bare_term {
        return Err(ValidationError::Query("au moins un terme de recherche requis (hors qualificateurs)".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_valid() {
        assert!(validate_owner("DjoAHP").is_ok());
        assert!(validate_owner("github").is_ok());
        assert!(validate_owner("a").is_ok());
        assert!(validate_owner("A1-b2").is_ok());
        assert!(validate_owner(&"a".repeat(39)).is_ok());
    }

    #[test]
    fn owner_invalid() {
        assert!(validate_owner("").is_err());
        assert!(validate_owner("-abc").is_err());
        assert!(validate_owner("a.b").is_err()); // point interdit
        assert!(validate_owner("a_b").is_err()); // underscore interdit
        assert!(validate_owner(&"a".repeat(40)).is_err()); // trop long
        assert!(validate_owner("123abc").is_ok()); // commence par chiffre OK
    }

    #[test]
    fn name_valid() {
        assert!(validate_name("LogAssist").is_ok());
        assert!(validate_name("repo.name-1").is_ok());
        assert!(validate_name("my_repo").is_ok());
        assert!(validate_name(&"a".repeat(100)).is_ok());
    }

    #[test]
    fn name_invalid() {
        assert!(validate_name("").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name(".hidden").is_err()); // commence par point -> contient ".." ? non, mais nom invalide selon GitHub
        assert!(validate_name("a b").is_err()); // espace
        assert!(validate_name(&"a".repeat(101)).is_err());
        assert!(validate_name("a..b").is_err()); // contient ..
    }

    #[test]
    fn ref_valid() {
        assert!(validate_ref("main").is_ok());
        assert!(validate_ref("feature/x-1").is_ok());
        assert!(validate_ref("v1.0.0").is_ok());
        assert!(validate_ref("refs/heads/main").is_ok());
    }

    #[test]
    fn ref_invalid() {
        assert!(validate_ref("").is_err());
        assert!(validate_ref("a..b").is_err());
        assert!(validate_ref("a\0b").is_err());
        assert!(validate_ref("/lead").is_err());
        assert!(validate_ref("trail/").is_err());
        assert!(validate_ref(&"a".repeat(256)).is_err());
    }

    #[test]
    fn path_valid() {
        assert!(validate_path("src/main.rs").is_ok());
        assert!(validate_path("README.md").is_ok());
        assert!(validate_path("dir/subdir/file.txt").is_ok());
        assert!(validate_path(".env.example").is_ok());
        assert!(validate_path(".env.sample").is_ok());
        assert!(validate_path(&"a".repeat(512)).is_ok());
    }

    #[test]
    fn path_invalid() {
        assert!(validate_path("").is_err());
        assert!(validate_path("a/../b").is_err());
        assert!(validate_path("a\\b").is_err());
        assert!(validate_path("a\0b").is_err());
        assert!(validate_path(&"a".repeat(513)).is_err());
        assert!(validate_path("/absolute").is_err());
        // Fichiers refusés
        assert!(validate_path(".env").is_err());
        assert!(validate_path(".env.local").is_err());
        assert!(validate_path("config/.env").is_err());
        assert!(validate_path("server.pem").is_err());
        assert!(validate_path("id_rsa").is_err());
        assert!(validate_path("id_ed25519").is_err());
        assert!(validate_path("credentials.json").is_err());
        assert!(validate_path(".npmrc").is_err());
        assert!(validate_path(".pypirc").is_err());
        // Encodage
        assert!(validate_path("a/b c").is_err()); // espace non encodé
    }

    #[test]
    fn query_valid() {
        assert!(validate_query("function main").is_ok());
        assert!(validate_query("TODO FIXME").is_ok());
        assert!(validate_query("repo:owner/name function").is_ok());
        assert!(validate_query(&"a".repeat(256)).is_ok());
    }

    #[test]
    fn query_invalid() {
        assert!(validate_query("").is_err());
        assert!(validate_query(&"a".repeat(257)).is_err());
        assert!(validate_query("language:go").is_err()); // aucun terme nu
        assert!(validate_query("repo:owner/name").is_err()); // aucun terme nu
        assert!(validate_query("in:file").is_err());
    }
}