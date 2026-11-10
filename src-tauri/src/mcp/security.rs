use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use http::HeaderName;
use serde_json::{Value, json};
use url::{Host, Url};

use super::types::{JsonObject, McpAuthConfig, McpErrorKind, McpErrorPayload, McpRuntimeServer};

pub const MAX_FETCH_URLS: usize = 3;
pub const MAX_ARGUMENT_BYTES: usize = 64 * 1024;
pub const MAX_ARGUMENT_DEPTH: usize = 32;
pub const MAX_RESULT_CHARS: usize = 100_000;
pub const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;
pub const MAX_TOOLS_PER_SERVER: usize = 256;
pub const MAX_CATALOG_BYTES: usize = 1024 * 1024;
/// Base64 max par média : ≈ 6,7 Mo de texte = 5 Mo binaire décodé.
pub const MAX_MEDIA_BASE64_CHARS: usize = 6_700_000;
/// Médias max normalisés par résultat d'outil ; au-delà, marqueur texte.
pub const MAX_MEDIA_PER_RESULT: usize = 8;
/// MIME autorisés : liste fermée, tout le reste est réduit au marqueur texte.
pub const ALLOWED_MEDIA_MIME_TYPES: [&str; 7] = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
];
const MAX_QUERY_CHARS: usize = 2_000;
const MAX_PURPOSE_CHARS: usize = 500;
const MAX_ENDPOINT_CHARS: usize = 2_048;
const MAX_SCHEMA_DEPTH: usize = 32;
const MAX_SCHEMA_NODES: usize = 4_096;
const MAX_SCHEMA_PATTERNS: usize = 128;
const MAX_SCHEMA_PATTERN_CHARS: usize = 1_024;

/// Endpoint du serveur MCP intégré (TinyFish) : l'identifiant interne fixe
/// `tinyfish` et cet endpoint doivent voyager ensemble (échec sinon).
const BUILTIN_ENDPOINT: &str = "https://agent.tinyfish.ai/mcp";

/// Valeurs canoniques du produit imposées aux arguments TinyFish.
/// Source unique : transport.rs et client.rs n'en redéfinissent aucune.
pub const SEARCH_RESULT_LIMIT: u32 = 5;
pub const SEARCH_LANGUAGE: &str = "fr";
pub const SEARCH_DOMAIN_TYPE: &str = "web";
pub const FETCH_FORMAT: &str = "markdown";

fn invalid_config(message: &'static str) -> McpErrorPayload {
    McpErrorPayload::new(McpErrorKind::InvalidConfig, message)
}

fn invalid_arguments(message: &'static str) -> McpErrorPayload {
    McpErrorPayload::new(McpErrorKind::InvalidArguments, message)
}

fn has_forbidden_raw_url_character(value: &str) -> bool {
    value
        .chars()
        .any(|character| character == ' ' || character.is_control())
}

/// Valide la forme statique d'un endpoint sans effectuer de résolution DNS.
/// La valeur reçue n'est jamais incluse dans une erreur afin d'éviter de
/// recopier d'éventuels secrets encodés dans une URL malformée.
pub fn validate_endpoint_static(value: &str) -> Result<Url, McpErrorPayload> {
    let raw_chars = value.chars().count();
    if raw_chars == 0 || raw_chars > MAX_ENDPOINT_CHARS {
        return Err(invalid_config("Longueur d'endpoint MCP invalide"));
    }
    if has_forbidden_raw_url_character(value) {
        return Err(invalid_config("Caractère interdit dans l'endpoint MCP"));
    }

    let scheme_length = if value
        .get(.."http://".len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("http://"))
    {
        "http://".len()
    } else if value
        .get(.."https://".len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
    {
        "https://".len()
    } else {
        return Err(invalid_config("Schéma d'endpoint MCP non autorisé"));
    };

    let remainder = &value[scheme_length..];
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let authority = &remainder[..authority_end];
    if authority.is_empty() || authority.contains('@') {
        return Err(invalid_config("Autorité d'endpoint MCP invalide"));
    }

    let url = Url::parse(value).map_err(|_| invalid_config("Endpoint MCP invalide"))?;
    if url.as_str().chars().count() > MAX_ENDPOINT_CHARS {
        return Err(invalid_config("Longueur d'endpoint MCP invalide"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid_config("Identifiants interdits dans l'endpoint MCP"));
    }
    if url.fragment().is_some() {
        return Err(invalid_config("Fragment interdit dans l'endpoint MCP"));
    }

    let host = url
        .host()
        .ok_or_else(|| invalid_config("Hôte d'endpoint MCP manquant"))?;
    match (url.scheme(), host) {
        (_, Host::Domain(domain)) if domain.ends_with('.') => {
            return Err(invalid_config(
                "Point terminal interdit dans l'endpoint MCP",
            ));
        }
        ("http", Host::Domain(domain)) if domain.eq_ignore_ascii_case("localhost") => {}
        ("http", Host::Ipv4(ip)) if ip.is_loopback() => {}
        ("http", Host::Ipv6(ip)) if ip.is_loopback() => {}
        ("http", _) => {
            return Err(invalid_config(
                "HTTP est réservé aux endpoints MCP de bouclage",
            ));
        }
        ("https", Host::Ipv4(ip)) if ip.is_loopback() => {}
        ("https", Host::Ipv6(ip)) if ip.is_loopback() => {}
        ("https", Host::Ipv4(ip)) => validate_public_ip(IpAddr::V4(ip))
            .map_err(|_| invalid_config("Adresse IP d'endpoint MCP non publique"))?,
        ("https", Host::Ipv6(ip)) => validate_public_ip(IpAddr::V6(ip))
            .map_err(|_| invalid_config("Adresse IP d'endpoint MCP non publique"))?,
        ("https", Host::Domain(_)) => {}
        _ => return Err(invalid_config("Schéma d'endpoint MCP non autorisé")),
    }

    Ok(url)
}

/// Parse le nom avec `http` pour appliquer sa grammaire stricte, puis bloque
/// les en-têtes capables de modifier l'authentification ou le transport HTTP.
pub fn validate_api_key_header(value: &str) -> Result<HeaderName, McpErrorPayload> {
    let header = HeaderName::from_bytes(value.as_bytes())
        .map_err(|_| invalid_config("Nom d'en-tête API Key invalide"))?;
    let normalized = header.as_str();
    const RESERVED: [&str; 18] = [
        "authorization",
        "host",
        "content-length",
        "connection",
        "transfer-encoding",
        "cookie",
        "set-cookie",
        "origin",
        "referer",
        "mcp-session-id",
        "te",
        "trailer",
        "upgrade",
        "keep-alive",
        "accept",
        "content-type",
        "last-event-id",
        "mcp-protocol-version",
    ];
    if RESERVED.contains(&normalized)
        || normalized.starts_with("mcp-")
        || normalized.starts_with("proxy-")
        || normalized.starts_with("sec-")
    {
        return Err(invalid_config("En-tête API Key réservé"));
    }
    Ok(header)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaRefusal {
    /// MIME vide, hors liste fermée, ou incompatible avec le bloc d'origine
    /// (un bloc Image portant un MIME audio n'est jamais reclassé).
    DisallowedMime,
    /// Base64 vide, longueur non multiple de 4, ou hors alphabet RFC 4648.
    InvalidBase64,
    /// Base64 syntaxiquement valide mais au-delà de la borne de taille.
    TooLarge,
}

/// Valide un bloc média selon la politique bornée. `expected_kind` provient du
/// bloc MCP d'origine ("image" ou "audio") : un serveur mentant sur son aspect
/// est refusé plutôt que reclassé. La validation du base64 est volontairement
/// sans dépendance (alphabet standard + longueur multiple de 4) : la sécurité
/// repose sur la liste fermée de MIME et la borne de taille, pas sur le décodage.
pub fn validate_media_block(
    expected_kind: &str,
    mime_type: &str,
    base64: &str,
) -> Result<(), MediaRefusal> {
    let kind_prefix_ok = mime_type.len() > expected_kind.len()
        && mime_type.as_bytes()[expected_kind.len()] == b'/'
        && mime_type.starts_with(expected_kind);
    if !kind_prefix_ok || !ALLOWED_MEDIA_MIME_TYPES.contains(&mime_type) {
        return Err(MediaRefusal::DisallowedMime);
    }
    if base64.is_empty()
        || base64.len() % 4 != 0
        || !base64
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        return Err(MediaRefusal::InvalidBase64);
    }
    if base64.len() > MAX_MEDIA_BASE64_CHARS {
        return Err(MediaRefusal::TooLarge);
    }
    Ok(())
}

#[derive(Default)]
struct SchemaBudget {
    nodes: usize,
    patterns: usize,
}

fn consume_schema_pattern(pattern: &str, budget: &mut SchemaBudget) -> Result<(), McpErrorPayload> {
    if pattern.chars().take(MAX_SCHEMA_PATTERN_CHARS + 1).count() > MAX_SCHEMA_PATTERN_CHARS {
        return Err(invalid_config("Pattern JSON Schema trop long"));
    }
    budget.patterns = budget
        .patterns
        .checked_add(1)
        .ok_or_else(|| invalid_config("Trop de patterns JSON Schema"))?;
    if budget.patterns > MAX_SCHEMA_PATTERNS {
        return Err(invalid_config("Trop de patterns JSON Schema"));
    }
    Ok(())
}

fn visit_schema_node(
    schema: &Value,
    depth: usize,
    budget: &mut SchemaBudget,
) -> Result<(), McpErrorPayload> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(invalid_config("JSON Schema trop profondément imbriqué"));
    }
    budget.nodes = budget
        .nodes
        .checked_add(1)
        .ok_or_else(|| invalid_config("JSON Schema trop complexe"))?;
    if budget.nodes > MAX_SCHEMA_NODES {
        return Err(invalid_config("JSON Schema trop complexe"));
    }

    let Value::Object(object) = schema else {
        return if schema.is_boolean() {
            Ok(())
        } else {
            Err(invalid_config("Sous-schéma JSON invalide"))
        };
    };

    for reference_keyword in ["$ref", "$dynamicRef"] {
        if let Some(reference) = object.get(reference_keyword)
            && !matches!(reference, Value::String(value) if value.starts_with('#'))
        {
            return Err(invalid_config("Référence JSON Schema non locale interdite"));
        }
    }

    if let Some(pattern) = object.get("pattern") {
        let pattern = pattern
            .as_str()
            .ok_or_else(|| invalid_config("Pattern JSON Schema invalide"))?;
        consume_schema_pattern(pattern, budget)?;
    }

    for keyword in [
        "$defs",
        "definitions",
        "properties",
        "patternProperties",
        "dependentSchemas",
    ] {
        let Some(value) = object.get(keyword) else {
            continue;
        };
        let schemas = value
            .as_object()
            .ok_or_else(|| invalid_config("Map de sous-schémas invalide"))?;
        for (name, child) in schemas {
            if keyword == "patternProperties" {
                consume_schema_pattern(name, budget)?;
            }
            visit_schema_node(child, depth + 1, budget)?;
        }
    }

    for keyword in ["prefixItems", "allOf", "anyOf", "oneOf"] {
        let Some(value) = object.get(keyword) else {
            continue;
        };
        let schemas = value
            .as_array()
            .ok_or_else(|| invalid_config("Liste de sous-schémas invalide"))?;
        for child in schemas {
            visit_schema_node(child, depth + 1, budget)?;
        }
    }

    for keyword in [
        "additionalProperties",
        "unevaluatedProperties",
        "additionalItems",
        "unevaluatedItems",
        "propertyNames",
        "contains",
        "items",
        "not",
        "if",
        "then",
        "else",
        "contentSchema",
    ] {
        if let Some(child) = object.get(keyword) {
            visit_schema_node(child, depth + 1, budget)?;
        }
    }

    Ok(())
}

fn validate_schema_structure(schema: &Value) -> Result<(), McpErrorPayload> {
    visit_schema_node(schema, 1, &mut SchemaBudget::default())
}

/// Contrôle uniquement la structure physique reçue : aucune `$ref` n'est
/// suivie et aucune sémantique JSON Schema n'est exécutée localement.
pub fn validate_tool_schema(schema: &Value) -> Result<(), McpErrorPayload> {
    if !schema.is_object() {
        return Err(invalid_config("Le schéma d'entrée MCP doit être un objet"));
    }
    let serialized = serde_json::to_vec(schema)
        .map_err(|_| invalid_config("Schéma d'entrée MCP non sérialisable"))?;
    if serialized.len() > MAX_ARGUMENT_BYTES {
        return Err(invalid_config("Schéma d'entrée MCP trop volumineux"));
    }
    validate_schema_structure(schema)
}

/// Calcule la profondeur des conteneurs et renvoie `None` immédiatement dès
/// qu'une branche dépasse la limite. Les frères restants ne sont alors jamais
/// parcourus, ce qui borne le travail sur une entrée profondément imbriquée.
fn json_depth(value: &Value, limit: usize) -> Option<usize> {
    fn visit(value: &Value, current: usize, limit: usize) -> Option<usize> {
        let depth = current.checked_add(1)?;
        if depth > limit {
            return None;
        }

        let mut deepest = depth;
        match value {
            Value::Array(values) => {
                for child in values {
                    deepest = deepest.max(visit(child, depth, limit)?);
                }
            }
            Value::Object(values) => {
                for child in values.values() {
                    deepest = deepest.max(visit(child, depth, limit)?);
                }
            }
            _ => {}
        }
        Some(deepest)
    }

    visit(value, 0, limit)
}

fn validate_argument_object(arguments: &Value) -> Result<&JsonObject, McpErrorPayload> {
    let object = arguments
        .as_object()
        .ok_or_else(|| invalid_arguments("Les arguments MCP doivent être un objet"))?;
    if json_depth(arguments, MAX_ARGUMENT_DEPTH).is_none() {
        return Err(invalid_arguments(
            "Arguments MCP trop profondément imbriqués",
        ));
    }
    let serialized = serde_json::to_vec(arguments)
        .map_err(|_| invalid_arguments("Arguments MCP non sérialisables"))?;
    if serialized.len() > MAX_ARGUMENT_BYTES {
        return Err(invalid_arguments("Arguments MCP trop volumineux"));
    }
    Ok(object)
}

/// Borne l'enveloppe locale sans interpréter le contrat métier du serveur.
pub fn validate_tool_arguments(schema: &Value, arguments: &Value) -> Result<(), McpErrorPayload> {
    validate_tool_schema(schema)?;
    validate_argument_object(arguments)?;
    // Invariant : le serveur MCP est l'autorité sémantique pour required,
    // type, pattern et les autres mots-clés du schéma distant.
    Ok(())
}

fn bounded_argument<'a>(
    object: &'a JsonObject,
    name: &str,
    maximum: usize,
) -> Result<&'a str, McpErrorPayload> {
    let value = object
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_arguments("Argument texte MCP manquant ou invalide"))?;
    if value.trim().is_empty() || value.chars().count() > maximum {
        return Err(invalid_arguments("Argument texte MCP hors limites"));
    }
    Ok(value)
}

fn optional_purpose(object: &JsonObject) -> Result<Option<&str>, McpErrorPayload> {
    match object.get("purpose") {
        None => Ok(None),
        Some(Value::String(value))
            if !value.trim().is_empty() && value.chars().count() <= MAX_PURPOSE_CHARS =>
        {
            Ok(Some(value))
        }
        Some(_) => Err(invalid_arguments("But de recherche invalide")),
    }
}

/// Reconstruit une liste blanche d'arguments TinyFish. Les options de coût et
/// de collecte sont imposées ici plutôt que recopiées depuis l'objet appelant.
pub fn tinyfish_arguments(
    native_name: &str,
    arguments: &Value,
) -> Result<JsonObject, McpErrorPayload> {
    match native_name {
        "search" => {
            let object = validate_argument_object(arguments)?;
            let query = bounded_argument(object, "query", MAX_QUERY_CHARS)?;
            let purpose = optional_purpose(object)?;
            let mut output = JsonObject::new();
            output.insert("query".to_owned(), json!(query));
            output.insert("result_limit".to_owned(), json!(SEARCH_RESULT_LIMIT));
            output.insert("language".to_owned(), json!(SEARCH_LANGUAGE));
            output.insert("domain_type".to_owned(), json!(SEARCH_DOMAIN_TYPE));
            if let Some(purpose) = purpose {
                output.insert("purpose".to_owned(), json!(purpose));
            }
            Ok(output)
        }
        "fetch_content" => {
            let object = validate_argument_object(arguments)?;
            let urls = object
                .get("urls")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid_arguments("Liste d'URL TinyFish invalide"))?;
            if urls.is_empty() || urls.len() > MAX_FETCH_URLS {
                return Err(invalid_arguments("Nombre d'URL TinyFish invalide"));
            }
            let mut safe_urls = Vec::with_capacity(urls.len());
            for value in urls {
                let url = value
                    .as_str()
                    .ok_or_else(|| invalid_arguments("URL TinyFish invalide"))?;
                validate_public_web_url(url)?;
                safe_urls.push(url.to_owned());
            }
            let purpose = optional_purpose(object)?;
            let mut output = JsonObject::new();
            output.insert("urls".to_owned(), json!(safe_urls));
            output.insert("format".to_owned(), json!(FETCH_FORMAT));
            output.insert("links".to_owned(), json!(true));
            output.insert("image_links".to_owned(), json!(false));
            output.insert("iframe_links".to_owned(), json!(false));
            output.insert("page_metadata".to_owned(), json!(false));
            if let Some(purpose) = purpose {
                output.insert("purpose".to_owned(), json!(purpose));
            }
            Ok(output)
        }
        _ => Err(McpErrorPayload::tool_denied("Outil TinyFish non autorisé")),
    }
}

/// Valide les invariants qui peuvent être contrôlés sans accès réseau. La
/// résolution DNS des domaines HTTPS reste une seconde barrière au transport.
pub fn validate_server_config(server: &McpRuntimeServer) -> Result<(), McpErrorPayload> {
    let id = server.id.as_bytes();
    if id.is_empty()
        || id.len() > 48
        || !id[0].is_ascii_lowercase()
        || !id[1..]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(byte))
    {
        return Err(invalid_config("Identifiant de serveur MCP invalide"));
    }

    let name_chars = server.name.chars().count();
    if name_chars == 0
        || name_chars > 80
        || server.name.trim().is_empty()
        || server.name.chars().any(char::is_control)
    {
        return Err(invalid_config("Nom de serveur MCP invalide"));
    }

    let endpoint = validate_endpoint_static(&server.endpoint)?;
    if !(5_000..=300_000).contains(&server.timeout_ms) {
        return Err(invalid_config("Délai d'attente MCP invalide"));
    }

    let is_tinyfish = server.id == "tinyfish";
    if server.builtin != is_tinyfish {
        return Err(invalid_config("Serveur MCP intégré invalide"));
    }
    if is_tinyfish {
        if endpoint.as_str() != BUILTIN_ENDPOINT {
            return Err(invalid_config("Endpoint TinyFish invalide"));
        }
        if !matches!(&server.auth, McpAuthConfig::Bearer) {
            return Err(invalid_config("Authentification TinyFish invalide"));
        }
    } else if let McpAuthConfig::ApiKey { header } = &server.auth {
        validate_api_key_header(header)?;
    }

    if server.tools.len() > MAX_TOOLS_PER_SERVER {
        return Err(invalid_config("Trop d'outils pour le serveur MCP"));
    }
    let catalog = serde_json::to_vec(&server.tools)
        .map_err(|_| invalid_config("Catalogue d'outils MCP non sérialisable"))?;
    if catalog.len() > MAX_CATALOG_BYTES {
        return Err(invalid_config("Catalogue d'outils MCP trop volumineux"));
    }

    let mut names = HashSet::with_capacity(server.tools.len());
    for tool in &server.tools {
        let name_chars = tool.native_name.chars().count();
        if name_chars == 0
            || name_chars > 128
            || tool.native_name.trim().is_empty()
            || tool.native_name.chars().any(char::is_control)
        {
            return Err(invalid_config("Nom d'outil MCP invalide"));
        }
        if !names.insert(tool.native_name.as_str()) {
            return Err(invalid_config("Nom d'outil MCP dupliqué"));
        }
    }

    for tool in &server.tools {
        validate_tool_schema(&tool.input_schema)?;
    }

    Ok(())
}

pub(crate) fn validate_public_web_url(value: &str) -> Result<(), McpErrorPayload> {
    if has_forbidden_raw_url_character(value) {
        return Err(McpErrorPayload::tool_denied(
            "Caractère interdit dans l'URL",
        ));
    }
    let url = Url::parse(value).map_err(|_| McpErrorPayload::tool_denied("URL invalide"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(McpErrorPayload::tool_denied("Schéma d'URL non autorisé"));
    }

    let host = url
        .host()
        .ok_or_else(|| McpErrorPayload::tool_denied("Hôte URL manquant"))?;
    match host {
        Host::Domain(domain) => {
            let domain = domain.to_ascii_lowercase();
            if domain.ends_with('.') {
                return Err(McpErrorPayload::tool_denied(
                    "Point terminal interdit dans l'hôte URL",
                ));
            }
            if domain == "localhost" || domain.ends_with(".localhost") || domain.ends_with(".local")
            {
                return Err(McpErrorPayload::tool_denied("Hôte local non autorisé"));
            }
        }
        Host::Ipv4(ip) => validate_public_ip(IpAddr::V4(ip))?,
        Host::Ipv6(ip) => validate_public_ip(IpAddr::V6(ip))?,
    }
    Ok(())
}

pub(crate) fn validate_public_ip(ip: IpAddr) -> Result<(), McpErrorPayload> {
    let is_public = match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    };
    if !is_public {
        return Err(McpErrorPayload::tool_denied(
            "Adresse réseau privée ou locale non autorisée",
        ));
    }
    Ok(())
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0 && !matches!(octets[3], 9 | 10))
        || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
        || octets[0] >= 240
        || ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation())
}

fn has_ipv6_prefix(ip: Ipv6Addr, prefix: Ipv6Addr, prefix_length: u32) -> bool {
    match prefix_length {
        0 => true,
        1..=128 => {
            let shift = 128 - prefix_length;
            (u128::from(ip) >> shift) == (u128::from(prefix) >> shift)
        }
        _ => false,
    }
}

fn is_global_ietf_protocol_exception(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    ip == Ipv6Addr::new(0x2001, 0x0001, 0, 0, 0, 0, 0, 1)
        || ip == Ipv6Addr::new(0x2001, 0x0001, 0, 0, 0, 0, 0, 2)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x2001, 0x0003, 0, 0, 0, 0, 0, 0), 32)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x2001, 0x0004, 0x0112, 0, 0, 0, 0, 0), 48)
        || (segments[0] == 0x2001 && (0x0020..=0x003f).contains(&segments[1]))
}

// Suit la classification IANA/Rust 1.99 ; les tests verrouillent les
// exceptions globales sans introduire de dépendance réseau.
fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }

    let reserved_ietf_protocol_assignment =
        has_ipv6_prefix(ip, Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23)
            && !is_global_ietf_protocol_exception(ip);
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || has_ipv6_prefix(ip, Ipv6Addr::UNSPECIFIED, 96)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x0064, 0xff9b, 0x0001, 0, 0, 0, 0, 0), 48)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x0100, 0, 0, 0, 0, 0, 0, 0), 64)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x0100, 0, 0, 1, 0, 0, 0, 0), 64)
        || reserved_ietf_protocol_assignment
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0), 32)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20)
        || has_ipv6_prefix(ip, Ipv6Addr::new(0x5f00, 0, 0, 0, 0, 0, 0, 0), 16)
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || has_ipv6_prefix(ip, Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 0), 10))
}

#[cfg(test)]
mod tests {
    use std::net::IpAddr;

    use url::Url;

    use super::{
        MAX_ARGUMENT_BYTES, MAX_ARGUMENT_DEPTH, MAX_CATALOG_BYTES, MAX_FETCH_URLS,
        MAX_RESULT_CHARS, MAX_SSE_EVENT_BYTES, MAX_TOOLS_PER_SERVER, tinyfish_arguments,
        validate_api_key_header, validate_endpoint_static, validate_public_ip,
        validate_server_config, validate_tool_arguments, validate_tool_schema,
    };
    use crate::mcp::types::{
        McpAuthConfig, McpErrorKind, McpRuntimeServer, McpRuntimeTool, McpTransportKind,
        WebToolName,
    };
    use serde_json::json;

    fn runtime_tool(native_name: &str) -> McpRuntimeTool {
        McpRuntimeTool {
            native_name: native_name.to_owned(),
            input_schema: json!({
                "type": "object",
                "properties": { "query": { "type": "string" } }
            }),
            enabled: true,
        }
    }

    fn remote_server() -> McpRuntimeServer {
        McpRuntimeServer {
            id: "remote-docs".to_owned(),
            name: "Documentation distante".to_owned(),
            endpoint: "https://mcp.example.com/rpc".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned(),
            },
            timeout_ms: 15_000,
            enabled: true,
            builtin: false,
            tools: vec![runtime_tool("search_docs")],
        }
    }

    fn tinyfish_server() -> McpRuntimeServer {
        McpRuntimeServer {
            id: "tinyfish".to_owned(),
            name: "TinyFish".to_owned(),
            endpoint: "https://agent.tinyfish.ai/mcp".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::Bearer,
            timeout_ms: 30_000,
            enabled: true,
            builtin: true,
            tools: vec![runtime_tool("search"), runtime_tool("fetch_content")],
        }
    }

    fn nested_object(depth: usize) -> serde_json::Value {
        let mut value = json!(null);
        for _ in 0..depth {
            value = json!({ "nested": value });
        }
        value
    }

    #[test]
    fn accepts_bounded_search_and_public_web_urls() {
        assert!(
            tinyfish_arguments("search", &json!({ "query": "documentation Tauri v2" })).is_ok()
        );
        assert!(
            tinyfish_arguments(
                "fetch_content",
                &json!({ "urls": ["https://docs.rs/rmcp"] })
            )
            .is_ok()
        );
        assert!(
            tinyfish_arguments(
                "fetch_content",
                &json!({ "urls": ["http://example.com/tutorial"] })
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_local_private_and_non_web_urls_before_network() {
        for url in [
            "http://localhost:3000",
            "https://printer.local/status",
            "http://127.0.0.1",
            "http://10.0.0.4",
            "http://172.16.0.1",
            "http://192.168.1.1",
            "http://169.254.1.1",
            "http://0.1.2.3",
            "http://100.64.0.1",
            "http://198.18.0.1",
            "http://240.0.0.1",
            "http://[::1]",
            "http://[fe80::1]",
            "http://[2001:db8::1]",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert_eq!(
                tinyfish_arguments("fetch_content", &json!({ "urls": [url] }))
                    .unwrap_err()
                    .kind,
                McpErrorKind::ToolDenied,
                "{url}"
            );
        }
    }

    #[test]
    fn rejects_empty_or_oversized_arguments() {
        // Requête vide ou trop longue : le nouveau chemin borne
        // via tinyfish_arguments (InvalidArguments, pas ToolDenied).
        assert_eq!(
            tinyfish_arguments("search", &json!({ "query": "  " }))
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidArguments
        );
        assert_eq!(
            tinyfish_arguments("search", &json!({ "query": "x".repeat(2_001) }))
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidArguments
        );
        assert_eq!(
            tinyfish_arguments(
                "search",
                &json!({ "query": "docs", "purpose": "x".repeat(501) })
            )
            .unwrap_err()
            .kind,
            McpErrorKind::InvalidArguments
        );
        // Liste d'URL vide ou dépassant MAX_FETCH_URLS.
        assert_eq!(
            tinyfish_arguments("fetch_content", &json!({ "urls": [] }))
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidArguments
        );
        assert_eq!(
            tinyfish_arguments(
                "fetch_content",
                &json!({ "urls": [
                    "https://one.example",
                    "https://two.example",
                    "https://three.example",
                    "https://four.example",
                ] })
            )
            .unwrap_err()
            .kind,
            McpErrorKind::InvalidArguments
        );
    }

    #[test]
    fn web_tool_name_keeps_its_serde_contract() {
        assert_eq!(
            serde_json::from_value::<WebToolName>(json!("fetch_content")).expect("outil connu"),
            WebToolName::FetchContent
        );
        assert!(serde_json::from_value::<WebToolName>(json!("delete_all")).is_err());
    }

    #[test]
    fn exposes_the_static_security_limits() {
        assert_eq!(MAX_ARGUMENT_BYTES, 64 * 1024);
        assert_eq!(MAX_ARGUMENT_DEPTH, 32);
        assert_eq!(MAX_RESULT_CHARS, 100_000);
        assert_eq!(MAX_SSE_EVENT_BYTES, 1024 * 1024);
        assert_eq!(MAX_TOOLS_PER_SERVER, 256);
        assert_eq!(MAX_CATALOG_BYTES, 1024 * 1024);
        assert_eq!(MAX_FETCH_URLS, 3);
    }

    #[test]
    fn endpoint_accepts_normalized_https_and_http_loopbacks_only() {
        let cases = [
            ("HTTPS://Example.COM/mcp", "https://example.com/mcp"),
            ("https://8.8.8.8/mcp", "https://8.8.8.8/mcp"),
            ("http://localhost:3000/mcp", "http://localhost:3000/mcp"),
            ("http://127.0.0.2/mcp", "http://127.0.0.2/mcp"),
            ("http://[::1]/mcp", "http://[::1]/mcp"),
            ("https://127.0.0.2/mcp", "https://127.0.0.2/mcp"),
            ("https://[::1]/mcp", "https://[::1]/mcp"),
        ];

        for (raw, normalized) in cases {
            assert_eq!(
                validate_endpoint_static(raw)
                    .unwrap_or_else(|error| panic!("{raw}: {}", error.message))
                    .as_str(),
                normalized
            );
        }
    }

    #[test]
    fn endpoint_rejects_ambiguous_syntax_controls_userinfo_and_fragments() {
        for raw in [
            "",
            " https://example.com/mcp",
            "https://example.com/mcp ",
            "https:\n//example.com/mcp",
            "https:@example.com",
            "https://@example.com",
            "https://user@example.com",
            "https://user:password@example.com",
            "https://example.com/mcp#fragment",
            "https://example.com/\u{7f}",
            "https://example.com/\u{85}",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            let error = validate_endpoint_static(raw).expect_err(raw);
            assert_eq!(error.kind, McpErrorKind::InvalidConfig, "{raw}");
            if !raw.is_empty() {
                assert!(!error.message.contains(raw), "l'entrée ne doit pas fuiter");
            }
        }
    }

    #[test]
    fn endpoint_rejects_remote_http_and_non_public_https_ip_literals() {
        for raw in [
            "http://example.com/mcp",
            "http://8.8.8.8/mcp",
            "https://10.0.0.1/mcp",
            "https://172.16.0.1/mcp",
            "https://192.168.0.1/mcp",
            "https://169.254.1.1/mcp",
            "https://100.64.0.1/mcp",
            "https://198.18.0.1/mcp",
            "https://[fe80::1]/mcp",
            "https://[2001:db8::1]/mcp",
        ] {
            assert_eq!(
                validate_endpoint_static(raw).expect_err(raw).kind,
                McpErrorKind::InvalidConfig,
                "{raw}"
            );
        }
    }

    #[test]
    fn url_boundaries_reject_domains_with_a_normalized_trailing_dot() {
        for raw in [
            "https://localhost./mcp",
            "https://api.localhost./mcp",
            "https://printer.local./status",
            "https://example.com。/mcp",
            "https://example.com%E3%80%82/mcp",
        ] {
            let normalized = Url::parse(raw).expect("URL IDNA valide");
            assert!(
                normalized
                    .host_str()
                    .is_some_and(|host| host.ends_with('.')),
                "{raw}"
            );
            assert_eq!(
                tinyfish_arguments("fetch_content", &json!({ "urls": [raw] }))
                    .unwrap_err()
                    .kind,
                McpErrorKind::ToolDenied,
                "{raw}"
            );
        }

        assert!(
            tinyfish_arguments(
                "fetch_content",
                &json!({ "urls": ["https://example.com/mcp"] })
            )
            .is_ok()
        );
        assert_eq!(
            validate_endpoint_static("https://example.com./mcp")
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn url_boundaries_reject_c1_controls_before_normalization() {
        let raw = "https://example.com/\u{85}";
        assert_eq!(
            validate_endpoint_static(raw).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
        assert_eq!(
            tinyfish_arguments("fetch_content", &json!({ "urls": [raw] }))
                .unwrap_err()
                .kind,
            McpErrorKind::ToolDenied
        );
    }

    #[test]
    fn public_ip_rejects_every_required_non_public_ipv6_prefix() {
        for raw in [
            "::192.0.2.1",
            "64:ff9b:1::1",
            "100::1",
            "100:0:0:1::1",
            "2001:2::1",
            "2001:5::1",
            "2001:10::1",
            "2001:1::3",
            "2001:4:113::1",
            "2001:40::1",
            "2002::1",
            "3fff::1",
            "5f00::1",
            "2001:db8::1",
            "fec0::1",
            "::1",
            "::",
            "ff02::1",
            "fd00::1",
            "fe80::1",
        ] {
            let ip = raw.parse::<IpAddr>().expect("adresse IPv6 de test valide");
            assert_eq!(
                validate_public_ip(ip).expect_err(raw).kind,
                McpErrorKind::ToolDenied,
                "{raw}"
            );
        }
    }

    #[test]
    fn public_ip_accepts_global_ipv6_and_classifies_ipv4_mapped_addresses() {
        for raw in [
            "2001:1::1",
            "2001:1::2",
            "2001:3::1",
            "2001:4:112::1",
            "2001:20::1",
            "2001:3f:ffff::1",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
            "::ffff:8.8.8.8",
        ] {
            let ip = raw.parse::<IpAddr>().expect("adresse publique valide");
            assert!(validate_public_ip(ip).is_ok(), "{raw}");
        }

        let mapped_private = "::ffff:10.0.0.1"
            .parse::<IpAddr>()
            .expect("adresse mapped valide");
        assert_eq!(
            validate_public_ip(mapped_private).unwrap_err().kind,
            McpErrorKind::ToolDenied
        );
    }

    #[test]
    fn public_ip_classifies_ipv4_special_ranges_like_rust_1_99() {
        for raw in ["192.88.99.1", "192.88.99.2", "192.88.99.255"] {
            let ip = raw.parse::<IpAddr>().expect("adresse IPv4 de test valide");
            assert_eq!(
                validate_public_ip(ip).expect_err(raw).kind,
                McpErrorKind::ToolDenied,
                "{raw}"
            );
        }

        for raw in ["192.88.98.1", "192.0.0.9", "192.0.0.10"] {
            let ip = raw.parse::<IpAddr>().expect("adresse IPv4 globale valide");
            assert!(validate_public_ip(ip).is_ok(), "{raw}");
        }
    }

    #[test]
    fn endpoint_enforces_raw_and_normalized_character_limits() {
        let oversized_raw = format!("https://example.com/{}", "a".repeat(2_049));
        assert_eq!(
            validate_endpoint_static(&oversized_raw).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let normalization_expands_past_limit = format!("https://example.com/{}", "é".repeat(400));
        assert!(normalization_expands_past_limit.chars().count() < 2_048);
        assert_eq!(
            validate_endpoint_static(&normalization_expands_past_limit)
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn api_key_header_is_parsed_and_normalized_by_http() {
        let header = validate_api_key_header("X-API-Key").expect("header autorisé");
        assert_eq!(header.as_str(), "x-api-key");
    }

    #[test]
    fn api_key_header_rejects_reserved_names_and_prefixes() {
        for raw in [
            "Authorization",
            "Host",
            "Content-Length",
            "Connection",
            "Transfer-Encoding",
            "Cookie",
            "Set-Cookie",
            "Origin",
            "Referer",
            "MCP-Session-ID",
            "Proxy-Authorization",
            "Sec-Fetch-Site",
            "tE",
            "TrAiLeR",
            "UpGrAdE",
            "KEEP-ALIVE",
            "AcCePt",
            "CONTENT-TYPE",
            "Last-Event-ID",
            "Mcp-Protocol-Version",
            "MCP-Method",
            "mCp-NaMe",
            "Mcp-Param",
        ] {
            assert_eq!(
                validate_api_key_header(raw).expect_err(raw).kind,
                McpErrorKind::InvalidConfig,
                "{raw}"
            );
        }
    }

    #[test]
    fn api_key_header_rejects_invalid_http_tokens() {
        for raw in ["", "X API Key", "X-API-Key\n"] {
            assert_eq!(
                validate_api_key_header(raw).expect_err(raw).kind,
                McpErrorKind::InvalidConfig,
                "{raw:?}"
            );
        }
    }

    #[test]
    fn server_config_accepts_valid_remote_and_immutable_tinyfish_values() {
        assert!(validate_server_config(&remote_server()).is_ok());

        let tinyfish = tinyfish_server();
        let before = tinyfish.clone();
        assert!(validate_server_config(&tinyfish).is_ok());
        assert_eq!(tinyfish, before);

        let mut normalized = tinyfish_server();
        // L'hôte est insensible à la casse : l'endpoint rejeté si non
        // normalisé conserve exactement l'autorité du serveur intégré.
        normalized.endpoint = "HTTPS://Agent.Tinyfish.AI/mcp".to_owned();
        assert!(validate_server_config(&normalized).is_ok());
    }

    #[test]
    fn server_config_enforces_id_name_timeout_and_api_key_header() {
        for invalid_id in [
            "",
            "Remote",
            "1remote",
            "remote.docs",
            "remote docs",
            &"a".repeat(49),
        ] {
            let mut server = remote_server();
            server.id = invalid_id.to_owned();
            assert_eq!(
                validate_server_config(&server).unwrap_err().kind,
                McpErrorKind::InvalidConfig,
                "{invalid_id:?}"
            );
        }

        for invalid_name in ["", "   ", &"n".repeat(81), "nom\ninterdit"] {
            let mut server = remote_server();
            server.name = invalid_name.to_owned();
            assert_eq!(
                validate_server_config(&server).unwrap_err().kind,
                McpErrorKind::InvalidConfig,
                "{invalid_name:?}"
            );
        }

        for invalid_timeout in [4_999, 300_001] {
            let mut server = remote_server();
            server.timeout_ms = invalid_timeout;
            assert_eq!(
                validate_server_config(&server).unwrap_err().kind,
                McpErrorKind::InvalidConfig
            );
        }

        for boundary in [5_000, 300_000] {
            let mut server = remote_server();
            server.timeout_ms = boundary;
            assert!(validate_server_config(&server).is_ok());
        }

        let mut reserved_header = remote_server();
        reserved_header.auth = McpAuthConfig::ApiKey {
            header: "Authorization".to_owned(),
        };
        assert_eq!(
            validate_server_config(&reserved_header).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn server_config_keeps_builtin_and_tinyfish_identity_closed() {
        let mut remote_builtin = remote_server();
        remote_builtin.builtin = true;
        assert_eq!(
            validate_server_config(&remote_builtin).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let mut not_builtin = tinyfish_server();
        not_builtin.builtin = false;
        assert_eq!(
            validate_server_config(&not_builtin).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let mut wrong_endpoint = tinyfish_server();
        wrong_endpoint.endpoint = "https://agent.tinyfish.ai/mcp/".to_owned();
        assert_eq!(
            validate_server_config(&wrong_endpoint).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let mut wrong_auth = tinyfish_server();
        wrong_auth.auth = McpAuthConfig::None;
        assert_eq!(
            validate_server_config(&wrong_auth).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn server_config_rejects_invalid_duplicate_and_excess_tool_names() {
        for invalid_name in ["", "   ", "bad\ntool", &"t".repeat(129)] {
            let mut server = remote_server();
            server.tools = vec![runtime_tool(invalid_name)];
            assert_eq!(
                validate_server_config(&server).unwrap_err().kind,
                McpErrorKind::InvalidConfig,
                "{invalid_name:?}"
            );
        }

        let mut duplicates = remote_server();
        duplicates.tools = vec![runtime_tool("search"), runtime_tool("search")];
        assert_eq!(
            validate_server_config(&duplicates).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let mut excessive = remote_server();
        excessive.tools = (0..=MAX_TOOLS_PER_SERVER)
            .map(|index| runtime_tool(&format!("tool_{index}")))
            .collect();
        assert_eq!(
            validate_server_config(&excessive).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn server_config_rejects_a_catalog_larger_than_one_mebibyte() {
        let mut server = remote_server();
        server.tools = (0..17)
            .map(|index| McpRuntimeTool {
                native_name: format!("tool_{index}"),
                input_schema: json!({
                    "type": "object",
                    "description": "x".repeat(62_000)
                }),
                enabled: true,
            })
            .collect();

        assert_eq!(
            validate_server_config(&server).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn server_config_counts_the_serialized_catalog_array_overhead() {
        let mut exact_limit_schema = json!({
            "type": "object",
            "description": ""
        });
        let empty_size = serde_json::to_vec(&exact_limit_schema)
            .expect("schéma sérialisable")
            .len();
        exact_limit_schema["description"] = json!("x".repeat(MAX_ARGUMENT_BYTES - empty_size));
        assert_eq!(
            serde_json::to_vec(&exact_limit_schema)
                .expect("schéma sérialisable")
                .len(),
            MAX_ARGUMENT_BYTES
        );

        let mut server = remote_server();
        server.tools = (0..16)
            .map(|index| McpRuntimeTool {
                native_name: format!("tool_{index}"),
                input_schema: exact_limit_schema.clone(),
                enabled: true,
            })
            .collect();

        assert_eq!(
            validate_server_config(&server).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn server_config_counts_names_flags_and_tool_envelopes_in_catalog_size() {
        let mut exact_schema = json!({
            "type": "object",
            "description": ""
        });
        let empty_size = serde_json::to_vec(&exact_schema)
            .expect("schéma sérialisable")
            .len();
        exact_schema["description"] = json!("x".repeat(4_000 - empty_size));
        let schema_size = serde_json::to_vec(&exact_schema)
            .expect("schéma sérialisable")
            .len();

        let mut server = remote_server();
        server.tools = (0..MAX_TOOLS_PER_SERVER)
            .map(|index| {
                let suffix = format!("{index:03}");
                McpRuntimeTool {
                    native_name: format!("{}{}", "n".repeat(128 - suffix.len()), suffix),
                    input_schema: exact_schema.clone(),
                    enabled: index % 2 == 0,
                }
            })
            .collect();

        assert!(schema_size * server.tools.len() < MAX_CATALOG_BYTES);
        assert!(
            serde_json::to_vec(&server.tools)
                .expect("catalogue sérialisable")
                .len()
                > MAX_CATALOG_BYTES
        );
        let error = validate_server_config(&server).unwrap_err();
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
        assert!(error.message.contains("Catalogue"));
    }

    #[test]
    fn server_config_accepts_a_full_tool_catalog_exactly_at_the_byte_limit() {
        let mut tools: Vec<McpRuntimeTool> = (0..17)
            .map(|index| McpRuntimeTool {
                native_name: format!("tool_{index}"),
                input_schema: json!({
                    "type": "object",
                    "description": ""
                }),
                enabled: index % 2 == 0,
            })
            .collect();
        let base_size = serde_json::to_vec(&tools)
            .expect("catalogue sérialisable")
            .len();
        let padding = MAX_CATALOG_BYTES - base_size;
        let per_tool = padding / tools.len();
        let remainder = padding % tools.len();
        for (index, tool) in tools.iter_mut().enumerate() {
            tool.input_schema["description"] =
                json!("x".repeat(per_tool + usize::from(index < remainder)));
            assert!(
                serde_json::to_vec(&tool.input_schema)
                    .expect("schéma sérialisable")
                    .len()
                    <= MAX_ARGUMENT_BYTES
            );
        }
        assert_eq!(
            serde_json::to_vec(&tools)
                .expect("catalogue sérialisable")
                .len(),
            MAX_CATALOG_BYTES
        );

        let mut server = remote_server();
        server.tools = tools;
        assert!(validate_server_config(&server).is_ok());
    }

    #[test]
    fn input_schema_must_be_an_offline_object_within_the_byte_limit() {
        for scalar in [json!(true), json!("object"), json!([])] {
            assert_eq!(
                validate_tool_schema(&scalar).unwrap_err().kind,
                McpErrorKind::InvalidConfig
            );
        }

        let oversized = json!({
            "type": "object",
            "description": "x".repeat(MAX_ARGUMENT_BYTES)
        });
        assert_eq!(
            validate_tool_schema(&oversized).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let remote_ref = json!({
            "type": "object",
            "properties": {
                "query": { "$ref": "https://example.com/query.schema.json" }
            }
        });
        assert_eq!(
            validate_tool_schema(&remote_ref).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn input_schema_accepts_draft_2020_12_local_references_offline() {
        let schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "$defs": {
                "query": { "type": "string", "minLength": 1 }
            },
            "properties": {
                "query": { "$ref": "#/$defs/query" }
            },
            "required": ["query"]
        });

        assert!(validate_tool_schema(&schema).is_ok());
    }

    #[test]
    fn tool_schema_accepts_json_pointer_and_anchor_local_references() {
        let pointer = json!({
            "type": "object",
            "defs": {
                "x": { "type": "string" }
            },
            "properties": {
                "value": { "$ref": "#/defs/x" }
            }
        });
        let anchor = json!({
            "type": "object",
            "$defs": {
                "anchored": {
                    "$anchor": "anchor",
                    "type": "string"
                }
            },
            "properties": {
                "value": { "$ref": "#anchor" }
            }
        });

        assert!(validate_tool_schema(&pointer).is_ok());
        assert!(validate_tool_schema(&anchor).is_ok());
    }

    #[test]
    fn tool_schema_rejects_every_non_local_or_non_string_reference_recursively() {
        for schema in [
            json!({
                "properties": {
                    "value": { "$ref": "https://attacker.example/schema" }
                }
            }),
            json!({
                "$defs": {
                    "value": { "$ref": "file:///tmp/schema.json" }
                }
            }),
            json!({ "allOf": [{ "$ref": "urn:example:schema" }] }),
            json!({
                "dependentSchemas": {
                    "value": { "$ref": "other.json#/$defs/x" }
                }
            }),
            json!({ "prefixItems": [{ "$ref": 42 }] }),
            json!({ "not": { "$dynamicRef": "https://attacker.example/dynamic" } }),
        ] {
            assert_eq!(
                validate_tool_schema(&schema).unwrap_err().kind,
                McpErrorKind::InvalidConfig
            );
        }
    }

    #[test]
    fn tool_schema_does_not_interpret_data_values_as_subschemas() {
        let schema = json!({
            "const": { "$ref": "literal" },
            "enum": [{ "$dynamicRef": "also-literal" }],
            "default": { "$ref": 42 },
            "examples": [{ "$ref": "file:///still-data" }]
        });

        assert!(validate_tool_schema(&schema).is_ok());
    }

    #[test]
    fn tool_schema_enforces_depth_and_subschema_node_budgets() {
        let mut depth_32 = json!({});
        for _ in 1..32 {
            depth_32 = json!({ "not": depth_32 });
        }
        let depth_33 = json!({ "not": depth_32.clone() });
        assert!(validate_tool_schema(&depth_32).is_ok());
        assert_eq!(
            validate_tool_schema(&depth_33).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        let nodes_4096 = json!({ "allOf": vec![json!(true); 4_095] });
        let nodes_4097 = json!({ "allOf": vec![json!(true); 4_096] });
        assert!(validate_tool_schema(&nodes_4096).is_ok());
        assert_eq!(
            validate_tool_schema(&nodes_4097).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );
    }

    #[test]
    fn tool_schema_enforces_pattern_count_and_character_budgets() {
        let patterns = |count| {
            json!({
                "allOf": (0..count)
                    .map(|index| json!({ "pattern": format!("^value-{index}$") }))
                    .collect::<Vec<_>>()
            })
        };
        assert!(validate_tool_schema(&patterns(128)).is_ok());
        assert_eq!(
            validate_tool_schema(&patterns(129)).unwrap_err().kind,
            McpErrorKind::InvalidConfig
        );

        for schema in [
            json!({ "pattern": "a".repeat(1_025) }),
            json!({ "patternProperties": { "a".repeat(1_025): true } }),
        ] {
            assert_eq!(
                validate_tool_schema(&schema).unwrap_err().kind,
                McpErrorKind::InvalidConfig
            );
        }
    }

    #[test]
    fn tool_schema_treats_bounded_patterns_as_opaque_strings() {
        assert!(validate_tool_schema(&json!({ "pattern": "^[a-z]+$" })).is_ok());
        for pattern in [r"^(a+)\1$", r"^(?=a)a$"] {
            assert!(
                validate_tool_schema(&json!({ "pattern": pattern })).is_ok(),
                "{pattern}"
            );
        }
    }

    #[test]
    fn tool_schema_does_not_expand_local_reference_graphs() {
        let mut definitions = serde_json::Map::new();
        definitions.insert("node_0".to_owned(), json!({ "type": "string" }));
        for index in 1..=20 {
            let previous = format!("#/$defs/node_{}", index - 1);
            definitions.insert(
                format!("node_{index}"),
                json!({
                    "allOf": [
                        { "$ref": previous },
                        { "$ref": format!("#/$defs/node_{}", index - 1) }
                    ]
                }),
            );
        }
        let schema = json!({
            "$defs": definitions,
            "$ref": "#/$defs/node_20"
        });

        assert!(validate_tool_schema(&schema).is_ok());
    }

    #[test]
    fn arguments_must_be_an_object_within_byte_and_depth_limits() {
        let schema = json!({});
        for scalar in [json!(null), json!("query"), json!([])] {
            assert_eq!(
                validate_tool_arguments(&schema, &scalar).unwrap_err().kind,
                McpErrorKind::InvalidArguments
            );
        }

        let oversized = json!({ "payload": "x".repeat(MAX_ARGUMENT_BYTES) });
        assert_eq!(
            validate_tool_arguments(&schema, &oversized)
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidArguments
        );

        assert!(validate_tool_arguments(&schema, &nested_object(MAX_ARGUMENT_DEPTH - 1)).is_ok());
        assert_eq!(
            validate_tool_arguments(&schema, &nested_object(MAX_ARGUMENT_DEPTH))
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidArguments
        );
    }

    #[test]
    fn arguments_leave_semantic_validation_to_the_mcp_server() {
        let schema = json!({
            "type": "object",
            "properties": {
                "q": { "type": "string" }
            },
            "required": ["q"],
            "additionalProperties": false
        });

        // Le serveur MCP valide required, type et les propriétés supplémentaires.
        for arguments in [
            json!({}),
            json!({ "q": 123 }),
            json!({ "q": "ok", "extra": true }),
        ] {
            assert!(validate_tool_arguments(&schema, &arguments).is_ok());
        }
    }

    #[test]
    fn arguments_report_structurally_invalid_schemas_without_mutation() {
        let schema = json!({ "$ref": "https://attacker.example/schema" });
        let arguments = json!({ "query": "Tauri" });
        let schema_before = schema.clone();
        let arguments_before = arguments.clone();

        assert_eq!(
            validate_tool_arguments(&schema, &arguments)
                .unwrap_err()
                .kind,
            McpErrorKind::InvalidConfig
        );
        assert_eq!(schema, schema_before);
        assert_eq!(arguments, arguments_before);
    }

    #[test]
    fn tinyfish_search_uses_fixed_native_arguments_without_mutating_input() {
        let input = json!({
            "query": "documentation Tauri",
            "purpose": "apprendre",
            "result_limit": 999,
            "language": "en",
            "domain_type": "news",
            "ignored": true
        });
        let before = input.clone();

        let output = tinyfish_arguments("search", &input).expect("arguments valides");

        assert_eq!(
            serde_json::Value::Object(output),
            json!({
                "query": "documentation Tauri",
                "result_limit": 5,
                "language": "fr",
                "domain_type": "web",
                "purpose": "apprendre"
            })
        );
        assert_eq!(input, before);
    }

    #[test]
    fn tinyfish_fetch_uses_fixed_native_arguments_without_mutating_input() {
        let input = json!({
            "urls": ["https://example.com/guide", "http://example.org/docs"],
            "purpose": "résumer",
            "format": "html",
            "links": false,
            "image_links": true,
            "iframe_links": true,
            "page_metadata": true
        });
        let before = input.clone();

        let output = tinyfish_arguments("fetch_content", &input).expect("arguments valides");

        assert_eq!(
            serde_json::Value::Object(output),
            json!({
                "urls": ["https://example.com/guide", "http://example.org/docs"],
                "format": "markdown",
                "links": true,
                "image_links": false,
                "iframe_links": false,
                "page_metadata": false,
                "purpose": "résumer"
            })
        );
        assert_eq!(input, before);
    }

    #[test]
    fn tinyfish_rejects_invalid_purpose_and_search_query() {
        for purpose in [json!(""), json!("   "), json!("x".repeat(501)), json!(42)] {
            let arguments = json!({ "query": "Tauri", "purpose": purpose });
            assert!(tinyfish_arguments("search", &arguments).is_err());
        }

        for query in [
            json!(""),
            json!("   "),
            json!("x".repeat(2_001)),
            json!(42),
            json!(null),
        ] {
            let arguments = json!({ "query": query });
            assert!(tinyfish_arguments("search", &arguments).is_err());
        }
        assert!(tinyfish_arguments("search", &json!({})).is_err());
    }

    #[test]
    fn tinyfish_rejects_invalid_fetch_url_counts_types_and_private_targets() {
        for urls in [
            json!([]),
            json!([
                "https://one.example",
                "https://two.example",
                "https://three.example",
                "https://four.example"
            ]),
            json!(["https://example.com", 42]),
            json!("https://example.com"),
        ] {
            assert!(tinyfish_arguments("fetch_content", &json!({ "urls": urls })).is_err());
        }

        for url in [
            "http://localhost:3000",
            "https://127.0.0.1",
            "https://10.0.0.1",
            "https://192.168.1.1",
            "http://[::1]",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(
                tinyfish_arguments("fetch_content", &json!({ "urls": [url] })).is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn tinyfish_rejects_non_object_arguments_and_unknown_tools() {
        assert_eq!(
            tinyfish_arguments("search", &json!([])).unwrap_err().kind,
            McpErrorKind::InvalidArguments
        );
        assert_eq!(
            tinyfish_arguments("delete_all", &json!({}))
                .unwrap_err()
                .kind,
            McpErrorKind::ToolDenied
        );
    }
}

#[cfg(test)]
mod media_validation_tests {
    use super::*;

    #[test]
    fn accepts_canonical_image_and_audio_blocks() {
        assert_eq!(validate_media_block("image", "image/png", "AAEB"), Ok(()));
        assert_eq!(validate_media_block("audio", "audio/mpeg", "AQID"), Ok(()));
    }

    #[test]
    fn refuses_a_mime_outside_the_closed_list() {
        assert_eq!(
            validate_media_block("image", "image/heic", "AAEB"),
            Err(MediaRefusal::DisallowedMime)
        );
        assert_eq!(
            validate_media_block("audio", "video/mp4", "AAEB"),
            Err(MediaRefusal::DisallowedMime)
        );
        assert_eq!(
            validate_media_block("image", "", "AAEB"),
            Err(MediaRefusal::DisallowedMime)
        );
    }

    #[test]
    fn refuses_a_server_lying_about_its_block_kind() {
        assert_eq!(
            validate_media_block("image", "audio/mpeg", "AAEB"),
            Err(MediaRefusal::DisallowedMime)
        );
        assert_eq!(
            validate_media_block("audio", "image/png", "AAEB"),
            Err(MediaRefusal::DisallowedMime)
        );
    }

    #[test]
    fn refuses_an_empty_or_malformed_base64() {
        assert_eq!(
            validate_media_block("image", "image/png", ""),
            Err(MediaRefusal::InvalidBase64)
        );
        // La longueur doit être un multiple de 4.
        assert_eq!(
            validate_media_block("image", "image/png", "AAA"),
            Err(MediaRefusal::InvalidBase64)
        );
        // Caractère hors alphabet RFC 4648.
        assert_eq!(
            validate_media_block("image", "image/png", "AAEB!"),
            Err(MediaRefusal::InvalidBase64)
        );
    }

    #[test]
    fn refuses_a_base64_beyond_the_size_bound() {
        let oversized = "A".repeat(MAX_MEDIA_BASE64_CHARS + 1);
        assert_eq!(
            validate_media_block("image", "image/png", &oversized),
            Err(MediaRefusal::TooLarge)
        );
    }
}
