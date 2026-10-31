export const SCHEMA_VERSION = 4

// Chaque statement est un item distinct : audit-able, et exécution séquentielle
// garantie (sqlx rejette le multi-statement dans un seul execute).
export const SCHEMA_V1_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_family TEXT NOT NULL CHECK (api_family IN ('openai','gemini')),
  base_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  supports_images INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  model_label TEXT,
  latency_ms INTEGER,
  error TEXT
)`,
  `CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  software TEXT NOT NULL DEFAULT '',
  software_version TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  context_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions_md TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id)`,
]

// Migration V2 : ajouter contrainte UNIQUE sur providers.name + dédoublonnage
// SQLite ne supporte pas ALTER TABLE ADD UNIQUE → recréation de table avec dédoublonnage.
// On désactive les FK le temps de la migration.
export const SCHEMA_V2_STATEMENTS: string[] = [
  `PRAGMA foreign_keys = OFF`,
  // 1. Créer nouvelle table providers avec UNIQUE
  `CREATE TABLE providers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_family TEXT NOT NULL CHECK (api_family IN ('openai','gemini')),
  base_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  // 2. Copier en dédoublonnant : garde le plus ancien par nom
  `INSERT INTO providers_new (id, name, api_family, base_url, created_at)
   SELECT id, name, api_family, base_url, created_at
   FROM (
     SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) as rn
     FROM providers
   ) WHERE rn = 1`,
  // 3. Créer nouvelle table models avec FK vers providers_new
  `CREATE TABLE models_new (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers_new(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  supports_images INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
)`,
  // 4. Copier models en remappant les provider_id vers les providers dédoublonnés
  // Pour chaque model, trouver le provider_new correspondant au même nom
  `INSERT INTO models_new (id, provider_id, model_id, supports_images, is_default)
   SELECT m.id, pn.id, m.model_id, m.supports_images, m.is_default
   FROM models m
   JOIN providers p ON m.provider_id = p.id
   JOIN providers_new pn ON pn.name = p.name`,
  // 5. Supprimer anciennes tables
  `DROP TABLE models`,
  `DROP TABLE providers`,
  // 6. Renommer
  `ALTER TABLE providers_new RENAME TO providers`,
  `ALTER TABLE models_new RENAME TO models`,
  // 7. Recréer les index
  `CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id)`,
  `PRAGMA foreign_keys = ON`,
]

// Migration V3 : table knowledge — bibliothèque de connaissances .md
// (nom + markdown), activables/désactivables au fil du travail utilisateur.
export const SCHEMA_V3_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_enabled ON knowledge(enabled)`,
]

// Migration V4 : épinglage de conversations, ordre manuel des connaissances
// et activations par conversation (overrides). ALTER idempotents impossible
// en SQLite : les statements ne s'exécutent qu'une fois (user_version gate).
export const SCHEMA_V4_STATEMENTS: string[] = [
  `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE knowledge ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS conversation_knowledge (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, knowledge_id)
)`,
]

export const SCHEMA_V1 = SCHEMA_V1_STATEMENTS.join(";\n")