// Module connecteurs — implémentation native Rust (non-MCP) pour GitHub, etc.
pub mod validation;
pub mod error;
pub mod github;
pub mod service;

#[cfg(test)]
mod tests {
    use super::validation::*;

    #[test]
    fn validation_owner_smoke() {
        assert!(validate_owner("DjoAHP").is_ok());
        assert!(validate_owner("-invalid").is_err());
    }

    #[test]
    fn validation_name_smoke() {
        assert!(validate_name("repo").is_ok());
        assert!(validate_name("..").is_err());
    }

    #[test]
    fn validation_ref_smoke() {
        assert!(validate_ref("main").is_ok());
        assert!(validate_ref("a..b").is_err());
    }

    #[test]
    fn validation_path_smoke() {
        assert!(validate_path("src/main.rs").is_ok());
        assert!(validate_path(".env").is_err());
    }

    #[test]
    fn validation_query_smoke() {
        assert!(validate_query("function test").is_ok());
        assert!(validate_query("language:go").is_err());
    }
}