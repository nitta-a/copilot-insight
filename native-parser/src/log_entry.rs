use serde::Deserialize;

/// Minimal shape used to deserialise Copilot JSON log entries.
/// Only the fields we aggregate are declared; unknown fields are ignored.
#[derive(Deserialize)]
pub(crate) struct LogEntry {
    pub(crate) event: Option<String>,
    #[serde(rename = "eventName")]
    pub(crate) event_name: Option<String>,
    pub(crate) model: Option<String>,
    #[serde(rename = "modelId")]
    pub(crate) model_id: Option<String>,
    /// Some log sources use snake_case.
    pub(crate) model_name: Option<String>,
    #[serde(rename = "engineId")]
    pub(crate) engine_id: Option<String>,
    #[serde(rename = "engineName")]
    pub(crate) engine_name: Option<String>,
    pub(crate) engine: Option<String>,
    /// ISO-8601 timestamp of the event (also accepted as "timestamp").
    #[serde(alias = "timestamp")]
    pub(crate) time: Option<String>,
    /// Inline-completion latency in milliseconds.
    #[serde(rename = "latencyMs")]
    pub(crate) latency_ms: Option<u32>,
    /// Context source identifier (e.g. "vscodePrompt", "activeDocument").
    pub(crate) context_source: Option<String>,
    /// User prompt text for prompt-length tracking.
    #[serde(alias = "query")]
    #[serde(rename = "userMessage")]
    pub(crate) prompt_text: Option<String>,
    /// Prompt token count from various field name conventions.
    #[serde(alias = "prompt_tokens", alias = "numPromptTokens", alias = "numTokens", alias = "tokenCount")]
    #[serde(rename = "promptTokens")]
    pub(crate) prompt_tokens: Option<u32>,
    /// Completion token count from various field name conventions.
    #[serde(alias = "completion_tokens", alias = "numCompletionTokens")]
    #[serde(rename = "completionTokens")]
    pub(crate) completion_tokens: Option<u32>,
    /// Total token count used as a fallback when no per-role split is present.
    #[serde(alias = "total_tokens")]
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: Option<u32>,
}
