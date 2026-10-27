use keyring::Entry;
use tauri::command;

const SERVICE: &str = "LogAssist";

fn entry(secret_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, secret_ref).map_err(|e| e.to_string())
}

#[command]
pub fn set_secret(secret_ref: String, value: String) -> Result<(), String> {
    entry(&secret_ref)?.set_password(&value).map_err(|e| e.to_string())
}

#[command]
pub fn get_secret(secret_ref: String) -> Result<Option<String>, String> {
    match entry(&secret_ref)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[command]
pub fn delete_secret(secret_ref: String) -> Result<(), String> {
    match entry(&secret_ref)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}
