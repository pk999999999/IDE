use crate::protocol::{event, Events};
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Model {
    pub provider: String,
    pub model: String,
}

// Byte-oriented SSE decoder: network chunks can split CRLF, events and UTF-8 codepoints.
#[derive(Default)]
pub struct Sse {
    buffer: Vec<u8>,
    data: Vec<String>,
}
impl Sse {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() > 2 * 1024 * 1024 {
            bail!("Provider stream frame too large");
        }
        let mut out = Vec::new();
        while let Some(end) = self.buffer.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=end).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line)?;
            if line.is_empty() {
                if !self.data.is_empty() {
                    out.push(self.data.join("\n"));
                    self.data.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).into());
            }
            if self.data.iter().map(String::len).sum::<usize>() > 2 * 1024 * 1024 {
                bail!("Provider event too large");
            }
        }
        Ok(out)
    }
}

pub async fn generate(
    model: &Model,
    system: &str,
    prompt: &str,
    tx: &Events,
    cancel: CancellationToken,
) -> Result<String> {
    if model.model.is_empty()
        || model.model.len() > 120
        || !model
            .model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c))
    {
        bail!("Invalid model ID");
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()?;
    let request = match model.provider.as_str() {
        "openai" => client.post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(key("OPENAI_API_KEY")?)
            .json(&json!({"model":model.model,"stream":true,"messages":[{"role":"system","content":system},{"role":"user","content":prompt}]})),
        "anthropic" => client.post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key("ANTHROPIC_API_KEY")?).header("anthropic-version", "2023-06-01")
            .json(&json!({"model":model.model,"max_tokens":16000,"stream":true,"system":system,"messages":[{"role":"user","content":prompt}]})),
        "gemini" => client.post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse", model.model))
            .header("x-goog-api-key", key("GEMINI_API_KEY")?)
            .json(&json!({"systemInstruction":{"parts":[{"text":system}]},"contents":[{"role":"user","parts":[{"text":prompt}]}]})),
        _ => bail!("Unsupported provider"),
    };
    let response = tokio::select! { _ = cancel.cancelled() => bail!("Cancelled"), response = request.send() => response? };
    if !response.status().is_success() {
        bail!(
            "Provider returned HTTP {}. Check your key, model access and quota.",
            response.status().as_u16()
        );
    }
    let mut stream = response.bytes_stream();
    let mut decoder = Sse::default();
    let mut result = String::new();
    loop {
        let item = tokio::select! { _ = cancel.cancelled() => bail!("Cancelled"), next = stream.next() => next };
        let Some(item) = item else {
            break;
        };
        for data in decoder.push(&item?)? {
            if data == "[DONE]" {
                continue;
            }
            let value: Value = serde_json::from_str(&data).context("Invalid provider SSE JSON")?;
            if value.get("error").is_some() || value["type"] == "error" {
                bail!("Provider reported a stream error");
            }
            let delta = match model.provider.as_str() {
                "openai" => value["choices"][0]["delta"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned(),
                "anthropic" => value["delta"]["text"].as_str().unwrap_or("").to_owned(),
                _ => value["candidates"][0]["content"]["parts"]
                    .as_array()
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| p["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default(),
            };
            result.push_str(&delta);
            if result.len() > 2 * 1024 * 1024 {
                bail!("Model output exceeds 2 MiB limit");
            }
            if !delta.is_empty() {
                event(tx, "agent.delta", json!({"text":delta})).await;
            }
        }
    }
    if result.trim().is_empty() {
        bail!("Provider returned no text");
    }
    Ok(result)
}
fn key(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .with_context(|| format!("Configure {name} in Settings"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_unicode_and_multiline() {
        let bytes = "data: héllo\r\ndata: world\r\n\r\ndata: [DONE]\n\n".as_bytes();
        let mut s = Sse::default();
        let mut events = Vec::new();
        for byte in bytes {
            events.extend(s.push(&[*byte]).unwrap());
        }
        assert_eq!(events, vec!["héllo\nworld", "[DONE]"]);
    }
}
