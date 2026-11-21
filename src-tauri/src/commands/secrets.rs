use keyring::Entry;
use tauri::command;

// Le service fait partie de la clé d'une entrée du Credential Manager : deux
// éditions qui partageraient le même service se voleraient leurs secrets.
// L'édition portable utilise donc un espace strictement distinct.
#[cfg(feature = "portable")]
const SERVICE: &str = "LogAssistPortable";
#[cfg(not(feature = "portable"))]
const SERVICE: &str = "LogAssist";

fn entry(secret_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, secret_ref).map_err(|e| e.to_string())
}

// Helpers internes (MCP) : le secret_ref vient du registre Rust, jamais de React.
pub(crate) fn read_secret(secret_ref: &str) -> Result<Option<String>, String> {
    match entry(secret_ref)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn write_secret(secret_ref: &str, value: &str) -> Result<(), String> {
    entry(secret_ref)?
        .set_password(value)
        .map_err(|e| e.to_string())
}

pub(crate) fn remove_secret(secret_ref: &str) -> Result<(), String> {
    match entry(secret_ref)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}

#[command]
pub fn set_secret(secret_ref: String, value: String) -> Result<(), String> {
    write_secret(&secret_ref, &value)
}

#[command]
pub fn get_secret(secret_ref: String) -> Result<Option<String>, String> {
    read_secret(&secret_ref)
}

#[command]
pub fn delete_secret(secret_ref: String) -> Result<(), String> {
    remove_secret(&secret_ref)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "portable")]
    #[test]
    fn le_service_portable_ne_partage_rien_avec_le_bureau() {
        assert_eq!(SERVICE, "LogAssistPortable");
    }

    #[cfg(not(feature = "portable"))]
    #[test]
    fn le_service_bureau_reste_inchange() {
        assert_eq!(SERVICE, "LogAssist");
    }
}
