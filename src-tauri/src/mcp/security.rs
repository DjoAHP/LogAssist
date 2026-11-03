use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use super::types::{
    McpErrorPayload, McpServerDefinition, McpServerId, WebToolName, WebToolRequest,
};

pub const MAX_FETCH_URLS: usize = 3;
pub const MAX_RESULT_CHARS: usize = 100_000;
const MAX_QUERY_CHARS: usize = 2_000;
const MAX_PURPOSE_CHARS: usize = 500;

static TINYFISH: McpServerDefinition = McpServerDefinition {
    id: McpServerId::Tinyfish,
    endpoint: "https://agent.tinyfish.ai/mcp",
    allowed_tools: &[WebToolName::Search, WebToolName::FetchContent],
};

pub fn server_definition(server_id: McpServerId) -> &'static McpServerDefinition {
    match server_id {
        McpServerId::Tinyfish => &TINYFISH,
    }
}

pub fn validate_request(
    server: &McpServerDefinition,
    request: &WebToolRequest,
) -> Result<(), McpErrorPayload> {
    if !server.allowed_tools.contains(&request.tool_name()) {
        return Err(McpErrorPayload::tool_denied("Outil MCP non autorisé"));
    }

    match request {
        WebToolRequest::Search { query, purpose } => {
            validate_text(query, MAX_QUERY_CHARS, "Requête de recherche invalide")?;
            validate_purpose(purpose)
        }
        WebToolRequest::FetchContent { urls, purpose } => {
            if urls.is_empty() || urls.len() > MAX_FETCH_URLS {
                return Err(McpErrorPayload::tool_denied(
                    "Le nombre d'URL doit être compris entre 1 et 3",
                ));
            }
            for value in urls {
                validate_public_web_url(value)?;
            }
            validate_purpose(purpose)
        }
    }
}

fn validate_purpose(purpose: &Option<String>) -> Result<(), McpErrorPayload> {
    if let Some(value) = purpose {
        validate_text(value, MAX_PURPOSE_CHARS, "But de recherche invalide")?;
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize, message: &str) -> Result<(), McpErrorPayload> {
    if value.trim().is_empty() || value.chars().count() > max_chars {
        return Err(McpErrorPayload::tool_denied(message));
    }
    Ok(())
}

pub(crate) fn validate_public_web_url(value: &str) -> Result<(), McpErrorPayload> {
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

fn validate_public_ip(ip: IpAddr) -> Result<(), McpErrorPayload> {
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
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
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

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let segments = ip.segments();
    !(segments[0] == 0x2001 && segments[1] == 0x0db8
        || (segments[0] & 0xffc0) == 0xfec0
        || ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_unique_local()
        || ip.is_unicast_link_local())
}

#[cfg(test)]
mod tests {
    use super::{server_definition, validate_request};
    use crate::mcp::types::{McpErrorKind, McpServerId, WebToolRequest};

    fn search(query: &str) -> WebToolRequest {
        WebToolRequest::Search {
            query: query.to_owned(),
            purpose: None,
        }
    }

    fn fetch(urls: &[&str]) -> WebToolRequest {
        WebToolRequest::FetchContent {
            urls: urls.iter().map(|url| (*url).to_owned()).collect(),
            purpose: None,
        }
    }

    fn validate(request: &WebToolRequest) -> Result<(), crate::mcp::types::McpErrorPayload> {
        validate_request(server_definition(McpServerId::Tinyfish), request)
    }

    #[test]
    fn accepts_bounded_search_and_public_web_urls() {
        assert!(validate(&search("documentation Tauri v2")).is_ok());
        assert!(validate(&fetch(&["https://docs.rs/rmcp"])).is_ok());
        assert!(validate(&fetch(&["http://example.com/tutorial"])).is_ok());
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
                validate(&fetch(&[url])).unwrap_err().kind,
                McpErrorKind::ToolDenied,
                "{url}"
            );
        }
    }

    #[test]
    fn rejects_empty_or_oversized_arguments() {
        assert_eq!(
            validate(&search("  ")).unwrap_err().kind,
            McpErrorKind::ToolDenied
        );
        assert_eq!(
            validate(&search(&"x".repeat(2_001))).unwrap_err().kind,
            McpErrorKind::ToolDenied
        );
        assert_eq!(
            validate(&fetch(&[])).unwrap_err().kind,
            McpErrorKind::ToolDenied
        );
        assert_eq!(
            validate(&fetch(&[
                "https://one.example",
                "https://two.example",
                "https://three.example",
                "https://four.example",
            ]))
            .unwrap_err()
            .kind,
            McpErrorKind::ToolDenied,
        );

        let request = WebToolRequest::Search {
            query: "Tauri".to_owned(),
            purpose: Some("x".repeat(501)),
        };
        assert_eq!(
            validate(&request).unwrap_err().kind,
            McpErrorKind::ToolDenied
        );
    }

    #[test]
    fn serde_rejects_unknown_server_and_tool_names() {
        assert!(serde_json::from_str::<McpServerId>(r#""other""#).is_err());
        assert!(
            serde_json::from_str::<WebToolRequest>(
                r#"{"tool":"run_web_automation","arguments":{}}"#,
            )
            .is_err()
        );
    }
}
