mod applock;
mod database;
mod mcp;
mod secrets;

pub use applock::{applock_configured, remove_applock_secret, set_applock_secret, verify_applock_secret};
pub use database::execute_transaction;
pub use mcp::{
    CredentialStore, ProductionMcpService, mcp_auth_status, mcp_call_tool, mcp_cancel_turn,
    mcp_configure_auth, mcp_connect_and_list_tools, mcp_delete_secret, mcp_disconnect,
    mcp_finish_turn, mcp_sync_registry, mcp_test_tool, mcp_validate_configs,
};
pub use secrets::{delete_secret, get_secret, set_secret};
