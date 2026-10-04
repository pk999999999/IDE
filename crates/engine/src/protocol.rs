use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

pub const MAX_FRAME: usize = 8 * 1024 * 1024;
pub type Events = mpsc::Sender<Value>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub async fn event(tx: &Events, name: &str, data: Value) {
    let _ = tx.send(json!({"event": name, "data": data})).await;
}

pub fn child_environment() -> Vec<(String, String)> {
    // Never leak provider credentials into terminals, Git hooks, MCP, LSP or Docker.
    const ALLOWED: &[&str] = &[
        "PATH",
        "HOME",
        "USERPROFILE",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SHELL",
        "TERM",
        "PATHEXT",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
    ];
    std::env::vars()
        .filter(|(key, _)| ALLOWED.contains(&key.to_uppercase().as_str()))
        .collect()
}
