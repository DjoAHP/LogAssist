export const SCHEMA_VERSION = 11

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

// Migration V5 : seules les métadonnées des sources Web sont persistées.
// Le contenu brut récupéré via MCP reste en mémoire pendant le tour LLM.
export const SCHEMA_V5_STATEMENTS: string[] = [
  `ALTER TABLE messages ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'`,
]

export const SCHEMA_V6_STATEMENTS: string[] = [
  "ALTER TABLE messages ADD COLUMN first_token_ms INTEGER",
  "ALTER TABLE messages ADD COLUMN input_tokens INTEGER",
  "ALTER TABLE messages ADD COLUMN output_tokens INTEGER",
  "ALTER TABLE messages ADD COLUMN usage_source TEXT CHECK (usage_source IN ('provider','estimated'))",
  "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER",
]

export const SCHEMA_V7_STATEMENTS: string[] = [
  `UPDATE messages SET error = CASE WHEN error = '{"interrupted":true}' THEN '{"interrupted":true}' ELSE '{"kind":"unknown","message":""}' END WHERE error IS NOT NULL`,
]

// Migration V8 : réparation de développement pour une DB ayant exécuté
// l'ancienne V7. L'UPDATE est idempotent ; il privilégie un état d'erreur
// visible au risque de classer comme erreur une rare réponse réellement vide.
export const SCHEMA_V8_STATEMENTS: string[] = [
  `UPDATE messages SET error = '{"kind":"unknown","message":""}' WHERE role = 'assistant' AND content = '' AND error IS NULL`,
]

// Migration V9 : registre MCP distant et amorçage TinyFish. Aucun secret
// d'authentification n'est stocké en SQLite ; les inserts restent rejouables.
export const SCHEMA_V9_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport = 'streamable_http'),
  auth_type TEXT NOT NULL CHECK (auth_type IN ('none','bearer','api_key')),
  header_name TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 60000 CHECK (timeout_ms BETWEEN 5000 AND 300000),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (auth_type = 'api_key' AND header_name IS NOT NULL AND length(trim(header_name)) > 0)
    OR (auth_type IN ('none','bearer') AND header_name IS NULL)
  )
)`,
  `CREATE TABLE IF NOT EXISTS mcp_tools (
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  native_name TEXT NOT NULL,
  llm_name TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  input_schema TEXT NOT NULL,
  output_schema TEXT,
  annotations TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  approval_mode TEXT NOT NULL DEFAULT 'confirm' CHECK (approval_mode IN ('confirm','auto')),
  schema_hash TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (server_id, native_name)
)`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tools_enabled ON mcp_tools(server_id, enabled)`,
  `INSERT OR IGNORE INTO mcp_servers
   (id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin)
   VALUES (
     'tinyfish', 'TinyFish', 'https://agent.tinyfish.ai/mcp',
     'streamable_http', 'bearer', NULL, 60000,
     COALESCE((SELECT CASE value WHEN 'true' THEN 1 ELSE 0 END FROM settings WHERE key = 'web.enabled'), 0),
     1
   )`,
  `INSERT OR IGNORE INTO mcp_tools
   (server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at)
   VALUES (
     'tinyfish', 'search', 'tinyfish__search', 'Recherche Web',
     'Rechercher des informations récentes sur le Web.',
     '{"type":"object","additionalProperties":false,"properties":{"query":{"type":"string"},"purpose":{"type":"string"}},"required":["query"]}',
     NULL, '{"readOnlyHint":true,"destructiveHint":false}', 1, 'auto', 'builtin-v1', datetime('now')
   )`,
  `INSERT OR IGNORE INTO mcp_tools
   (server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at)
   VALUES (
     'tinyfish', 'fetch_content', 'tinyfish__fetch_content', 'Lecture Web',
     'Lire le contenu d''une à trois pages Web publiques.',
     '{"type":"object","additionalProperties":false,"properties":{"urls":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":3},"purpose":{"type":"string"}},"required":["urls"]}',
     NULL, '{"readOnlyHint":true,"destructiveHint":false}', 1, 'auto', 'builtin-v1', datetime('now')
   )`,
]

// Migration V10 : médias (image/audio) renvoyés par les outils MCP. Les octets
// sont validés et bornés côté Rust ; seule la ref (id) vit dans messages.media,
// même pattern que sources. Aucun payload non validé n'est persisté.
export const SCHEMA_V10_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS message_media (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','audio')),
  mime_type TEXT NOT NULL,
  tool_label TEXT NOT NULL DEFAULT '',
  base64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_message_media_message ON message_media(message_id)`,
  `ALTER TABLE messages ADD COLUMN media TEXT NOT NULL DEFAULT '[]'`,
]

// Migration V11 : corrections manuelles optionnelles du budget de contexte.
// NULL conserve la détection fournisseur et son repli prudent.
export const SCHEMA_V11_STATEMENTS: string[] = [
  "ALTER TABLE models ADD COLUMN context_window_override INTEGER CHECK (context_window_override IS NULL OR context_window_override BETWEEN 512 AND 2000000)",
  "ALTER TABLE models ADD COLUMN max_output_tokens_override INTEGER CHECK (max_output_tokens_override IS NULL OR max_output_tokens_override BETWEEN 1 AND 262144)",
]

export const SCHEMA_V1 = SCHEMA_V1_STATEMENTS.join(";\n")
