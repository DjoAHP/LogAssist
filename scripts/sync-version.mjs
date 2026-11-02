// Synchronise la version de package.json (source de vérité) vers les fichiers
// que Tauri utilise pour le build natif Windows : src-tauri/tauri.conf.json
// (version du bundle .exe) et src-tauri/Cargo.toml (version du crate Rust).
// Lancé dans beforeBuildCommand (tauri.conf.json) avant chaque `tauri build`.
// Idempotent : ne réécrit un fichier que si sa version change. Cargo.toml est
// modifié par remplacement d'une seule ligne → ses fins de ligne CRLF sont
// préservées ; tauri.conf.json est réécrit en détectant le style du fichier.
import fs from "node:fs";
import path from "node:path";

// Couture de test : LOGASSIST_ROOT EST la racine du projet (fixture temporaire
// des tests src/syncVersion.test.ts). En usage réel : parent de scripts/.
const root = process.env.LOGASSIST_ROOT
  ? path.resolve(process.env.LOGASSIST_ROOT)
  : path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const version = pkg.version;

function lineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// tauri.conf.json — version du bundle (.exe, installateur) + titre de la
// fenêtre native « Produit vX » (suffixe version, même source de vérité).
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConfRaw = fs.readFileSync(tauriConfPath, "utf-8");
// Invariant : JSON.parse refuse le BOM UTF-8 (U+FEFF) que les outils Windows
// (PowerShell 5.1 Out-File/Set-Content) ajoutent par défaut — on le strip toujours.
const tauriConf = JSON.parse(tauriConfRaw.replace(/^\uFEFF/, ""));
const desiredTitle = `${tauriConf.productName} v${version}`;
const needsWrite = tauriConf.version !== version || tauriConf.app.windows[0].title !== desiredTitle;
if (needsWrite) {
  tauriConf.version = version;
  for (const w of tauriConf.app.windows) w.title = desiredTitle;
  const eol = lineEnding(tauriConfRaw);
  const rewritten = JSON.stringify(tauriConf, null, 2).replace(/\n/g, eol) + eol;
  fs.writeFileSync(tauriConfPath, rewritten);
  console.log(`sync-version: tauri.conf.json -> ${version} / titre « ${desiredTitle} »`);
} else {
  console.log(`sync-version: tauri.conf.json déjà à ${version} / titre « ${desiredTitle} »`);
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
