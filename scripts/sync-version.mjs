// Synchronise la version de package.json (source de vérité) vers les fichiers
// que Tauri utilise pour le build natif Windows : src-tauri/tauri.conf.json
// (version du bundle .exe) et src-tauri/Cargo.toml (version du crate Rust).
// Lancé dans beforeBuildCommand (tauri.conf.json) avant chaque `tauri build`.
// Idempotent : ne réécrit un fichier que si sa version change. Cargo.toml est
// modifié par remplacement d'une seule ligne → ses fins de ligne CRLF sont
// préservées ; tauri.conf.json est réécrit en détectant le style du fichier.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const version = pkg.version;

function lineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// tauri.conf.json — version du bundle (.exe, installateur)
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConfRaw = fs.readFileSync(tauriConfPath, "utf-8");
const tauriConf = JSON.parse(tauriConfRaw);
if (tauriConf.version !== version) {
  tauriConf.version = version;
  const eol = lineEnding(tauriConfRaw);
  const rewritten = JSON.stringify(tauriConf, null, 2).replace(/\n/g, eol) + eol;
  fs.writeFileSync(tauriConfPath, rewritten);
  console.log(`sync-version: tauri.conf.json -> ${version}`);
} else {
  console.log(`sync-version: tauri.conf.json déjà à ${version}`);
}

// Cargo.toml — remplacement de la première ligne `version = "…"` du [package]
// (seule la ligne change : les fins de ligne CRLF du reste sont intactes)
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf-8");
const cargoRegex = /^version\s*=\s*"[^"]*"/m;
if (!cargoRegex.test(cargo)) {
  console.error("sync-version: champ `version` introuvable dans Cargo.toml");
  process.exit(1);
}
fs.writeFileSync(cargoPath, cargo.replace(cargoRegex, `version = "${version}"`));
console.log(`sync-version: Cargo.toml -> ${version}`);
