// Module connecteurs — implémentation native Rust (non-MCP) pour GitHub, etc.
pub mod validation;
pub mod error;
pub mod github;
pub mod service;

#[cfg(test)]
mod service_integration_test;