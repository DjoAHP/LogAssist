// Verrou de confort au démarrage : le mot de passe est haché (argon2) côté
// Rust et seul le HASH vit dans le Credential Manager sous logassist/lock.
// SQLite ne contient que le flag lock.enabled — jamais le hash ni le mot de
// passe en clair. Le hachage est un KDF lent : SHA-2 seul est inadapté.
use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use tauri::command;

pub(crate) const APPLOCK_SECRET_REF: &str = "logassist/lock";

fn hash_password(password: &str) -> Result<String, String> {
    if password.trim().is_empty() {
        return Err("Mot de passe vide".to_string());
    }
    // Sel aléatoire par entrée : deux hash du même mot de passe diffèrent.
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}

fn verify_password(candidate: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(candidate.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false, // hash corrompu → refus, jamais de panic
    }
}

#[command]
pub fn set_applock_secret(password: String) -> Result<(), String> {
    let hash = hash_password(&password)?;
    super::secrets::write_secret(APPLOCK_SECRET_REF, &hash)
}

#[command]
pub fn verify_applock_secret(candidate: String) -> Result<bool, String> {
    match super::secrets::read_secret(APPLOCK_SECRET_REF)? {
        Some(hash) => Ok(verify_password(&candidate, &hash)),
        None => Ok(false),
    }
}

// Distinction « pas de hash » / « mauvais mot de passe » : la gate React
// utilise false de isLockActive pour son fail-open.
#[command]
pub fn applock_configured() -> Result<bool, String> {
    Ok(super::secrets::read_secret(APPLOCK_SECRET_REF)?.is_some())
}

#[command]
pub fn remove_applock_secret() -> Result<(), String> {
    super::secrets::remove_secret(APPLOCK_SECRET_REF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_puis_verify_accepte_le_bon_mot_de_passe() {
        let hash = hash_password("mot-de-passe-sûr").expect("hash");
        assert!(verify_password("mot-de-passe-sûr", &hash));
    }

    #[test]
    fn verify_rejette_un_mauvais_mot_de_passe() {
        let hash = hash_password("correct horse").expect("hash");
        assert!(!verify_password("incorrect", &hash));
    }

    #[test]
    fn hash_refuse_une_chaine_vide_ou_blanche() {
        assert!(hash_password("").is_err());
        assert!(hash_password("   ").is_err());
    }

    #[test]
    fn verify_rejette_un_hash_invalide_sans_paniquer() {
        assert!(!verify_password("x", "pas-un-hash"));
    }

    #[test]
    fn deux_hash_du_meme_mdp_differrent_par_le_sel() {
        let a = hash_password("même-mot-de-passe").expect("hash");
        let b = hash_password("même-mot-de-passe").expect("hash");
        assert_ne!(a, b);
    }
}
