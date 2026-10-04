mod agent;
mod context;
mod peer;
mod process;
mod protocol;
mod providers;
mod terminal;
mod workspace;

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use notify::Watcher;
use protocol::{event, Events, Request, MAX_FRAME};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    sync::{mpsc, Mutex, Semaphore},
};
use tokio_util::{
    codec::{FramedRead, LinesCodec},
    sync::CancellationToken,
};

struct Engine {
    workspace: workspace::Workspace,
    terminals: Mutex<terminal::Terminals>,
    agent: Mutex<agent::Agent>,
    // All engine-owned filesystem mutations serialize; stale content is checked immediately before writes.
    mutations: Mutex<()>,
    agent_busy: Semaphore,
    jobs: Mutex<HashMap<String, CancellationToken>>,
    peers: Mutex<HashMap<String, Arc<peer::Peer>>>,
    tx: Events,
}

fn field<T: DeserializeOwned>(v: &Value, name: &str) -> Result<T> {
    serde_json::from_value(
        v.get(name)
            .cloned()
            .with_context(|| format!("Missing {name}"))?,
    )
    .with_context(|| format!("Invalid {name}"))
}

impl Engine {
    async fn handle(&self, method: &str, p: Value, cancel: CancellationToken) -> Result<Value> {
        let w = &self.workspace;
        match method {
            "engine.info" => {
                Ok(json!({"version":env!("CARGO_PKG_VERSION"),"root":w.root,"protocol":1}))
            }
            "fs.list" => {
                let w = w.clone();
                Ok(serde_json::to_value(
                    tokio::task::spawn_blocking(move || w.entries()).await?,
                )?)
            }
            "fs.read" => Ok(json!({"content":w.read(&field::<String>(&p,"path")?)?})),
            "fs.write" => {
                let _guard = self.mutations.lock().await;
                let path: String = field(&p, "path")?;
                let expected: Option<String> = field(&p, "expected")?;
                anyhow::ensure!(
                    w.optional_read(&path)? == expected,
                    "File changed on disk; reopen it before saving"
                );
                w.write(&path, &field::<String>(&p, "content")?)?;
                Ok(json!({}))
            }
            "fs.rename" => {
                let _guard = self.mutations.lock().await;
                w.rename(&field::<String>(&p, "from")?, &field::<String>(&p, "to")?)?;
                Ok(json!({}))
            }
            "fs.delete" => {
                let _guard = self.mutations.lock().await;
                w.delete(&field::<String>(&p, "path")?)?;
                Ok(json!({}))
            }
            "fs.search" => {
                let query: String = field(&p, "query")?;
                anyhow::ensure!(!query.is_empty() && query.len() <= 1000, "Invalid search");
                let w = w.clone();
                Ok(tokio::task::spawn_blocking(move || {
                    let mut matches = Vec::new();
                    for file in w.entries() { if !workspace::context_safe(&file.path) { continue; } if let Ok(text) = w.read(&file.path) {
                        for (line, value) in text.lines().enumerate() { if value.to_lowercase().contains(&query.to_lowercase()) { matches.push(json!({"path":file.path,"line":line+1,"text":value.chars().take(240).collect::<String>()})); if matches.len() >= 500 { return json!(matches); } } }
                    } } json!(matches)
                }).await?)
            }
            "context.search" => {
                let w = w.clone();
                let query: String = field(&p, "query")?;
                Ok(tokio::task::spawn_blocking(move || {
                    json!(context::retrieve(&context::index(&w), &query, 8))
                })
                .await?)
            }
            "pty.create" => Ok(
                json!({"id":self.terminals.lock().await.create(&w.root,field(&p,"cols")?,field(&p,"rows")?,self.tx.clone())?}),
            ),
            "pty.write" => {
                self.terminals
                    .lock()
                    .await
                    .write(&field::<String>(&p, "id")?, &field::<String>(&p, "text")?)?;
                Ok(json!({}))
            }
            "pty.resize" => {
                self.terminals.lock().await.resize(
                    &field::<String>(&p, "id")?,
                    field(&p, "cols")?,
                    field(&p, "rows")?,
                )?;
                Ok(json!({}))
            }
            "pty.close" => {
                self.terminals
                    .lock()
                    .await
                    .close(&field::<String>(&p, "id")?)?;
                Ok(json!({}))
            }
            "git.run" => {
                let _guard = self.mutations.lock().await;
                process::git(w, &field::<String>(&p, "action")?, &p).await
            }
            "agent.plan" => {
                let _permit = self
                    .agent_busy
                    .try_acquire()
                    .context("An agent request is already running")?;
                let model: providers::Model = field(&p, "model")?;
                let prompt: String = field(&p, "prompt")?;
                anyhow::ensure!(
                    !prompt.trim().is_empty() && prompt.len() <= 40_000,
                    "Invalid prompt"
                );
                let plan = agent::plan(w, &model, &prompt, &self.tx, cancel).await?;
                Ok(serde_json::to_value(self.agent.lock().await.insert(plan)?)?)
            }
            "agent.stage" => Ok(json!(self
                .agent
                .lock()
                .await
                .stage(&field::<String>(&p, "id")?)?)),
            "agent.apply" => {
                let _guard = self.mutations.lock().await;
                Ok(json!(self.agent.lock().await.apply(
                    w,
                    &field::<String>(&p, "id")?,
                    &field::<Vec<String>>(&p, "paths")?
                )?))
            }
            "agent.reject" | "agent.rollback" => {
                let _guard = self.mutations.lock().await;
                Ok(json!(self.agent.lock().await.resolve(
                    w,
                    &field::<String>(&p, "id")?,
                    p["path"].as_str(),
                    method == "agent.rollback"
                )?))
            }
            "agent.verify" => {
                let _permit = self.agent_busy.try_acquire().context("Agent busy")?;
                let id: String = field(&p, "id")?;
                let plan = self
                    .agent
                    .lock()
                    .await
                    .plans
                    .get(&id)
                    .cloned()
                    .context("Unknown plan")?;
                anyhow::ensure!(
                    plan.status == "approved"
                        && plan
                            .changes
                            .iter()
                            .all(|c| c.state == "applied" || c.state == "rejected"),
                    "Resolve all diffs before verification"
                );
                anyhow::ensure!(
                    !plan.verification.is_empty(),
                    "Plan has no verification commands"
                );
                process::verify(w, &plan.verification, &self.tx, cancel).await
            }
            "mcp.start" | "lsp.start" => {
                let lsp = method == "lsp.start";
                let kind = if lsp { "lsp" } else { "mcp" };
                let mut peers = self.peers.lock().await;
                if let Some(old) = peers.remove(kind) {
                    old.stop().await;
                }
                let server = Arc::new(
                    peer::Peer::start(
                        &w.root,
                        &field::<String>(&p, "command")?,
                        &field::<Vec<String>>(&p, "args")?,
                        lsp,
                        self.tx.clone(),
                    )
                    .await?,
                );
                if !lsp {
                    let result = server.request("initialize",json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"degravity-studio","version":"0.1.0"}})).await?;
                    anyhow::ensure!(
                        ["2024-11-05", "2025-03-26", "2025-06-18"]
                            .contains(&result["protocolVersion"].as_str().unwrap_or("")),
                        "MCP server requires an unsupported protocol revision"
                    );
                    server
                        .notify("notifications/initialized", json!({}))
                        .await?;
                }
                peers.insert(kind.into(), server);
                Ok(json!({"connected":true}))
            }
            "mcp.stop" | "lsp.stop" => {
                if let Some(peer) = self
                    .peers
                    .lock()
                    .await
                    .remove(method.split('.').next().unwrap())
                {
                    peer.stop().await;
                }
                Ok(json!({}))
            }
            "mcp.tools" | "mcp.call" | "lsp.request" | "lsp.notify" => {
                let kind = if method.starts_with("lsp") {
                    "lsp"
                } else {
                    "mcp"
                };
                let peer = self
                    .peers
                    .lock()
                    .await
                    .get(kind)
                    .cloned()
                    .context("Server not connected")?;
                match method {
                    "mcp.tools" => peer.request("tools/list", json!({})).await,
                    "mcp.call" => {
                        peer.request(
                            "tools/call",
                            json!({"name":field::<String>(&p,"name")?,"arguments":p["arguments"]}),
                        )
                        .await
                    }
                    "lsp.request" => {
                        peer.request(&field::<String>(&p, "method")?, p["params"].clone())
                            .await
                    }
                    _ => {
                        peer.notify(&field::<String>(&p, "method")?, p["params"].clone())
                            .await?;
                        Ok(json!({}))
                    }
                }
            }
            _ => bail!("Unknown method: {method}"),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    anyhow::ensure!(
        args.next().as_deref() == Some("--workspace"),
        "Usage: antigravity-engine --workspace PATH"
    );
    let workspace =
        workspace::Workspace::new(PathBuf::from(args.next().context("Workspace required")?))?;
    let (tx, mut rx) = mpsc::channel::<Value>(256);
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(message) = rx.recv().await {
            let mut line = serde_json::to_vec(&message).unwrap();
            line.push(b'\n');
            if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });
    let engine = Arc::new(Engine {
        workspace: workspace.clone(),
        terminals: Mutex::new(terminal::Terminals::default()),
        agent: Mutex::new(agent::Agent::default()),
        mutations: Mutex::new(()),
        agent_busy: Semaphore::new(1),
        jobs: Mutex::new(HashMap::new()),
        peers: Mutex::new(HashMap::new()),
        tx: tx.clone(),
    });
    let watch_tx = tx.clone();
    let (dirty_tx, mut dirty_rx) = mpsc::channel::<()>(1);
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(e) = result {
            if !matches!(e.kind, notify::EventKind::Access(_)) {
                let _ = dirty_tx.try_send(());
            }
        }
    })?;
    watcher.watch(&workspace.root, notify::RecursiveMode::Recursive)?;
    tokio::spawn(async move {
        while dirty_rx.recv().await.is_some() {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            while dirty_rx.try_recv().is_ok() {}
            event(&watch_tx, "workspace.changed", json!({})).await;
        }
    });
    event(
        &tx,
        "engine.ready",
        json!({"root":workspace.root,"protocol":1}),
    )
    .await;
    let mut lines = FramedRead::new(
        BufReader::new(tokio::io::stdin()),
        LinesCodec::new_with_max_length(MAX_FRAME),
    );
    let concurrency = Arc::new(Semaphore::new(32));
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(line) = lines.next().await {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("IPC transport closed: {error}");
                break;
            }
        };
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(_) => {
                event(&tx, "engine.error", json!({"message":"Malformed request"})).await;
                continue;
            }
        };
        if request.method == "engine.cancel" {
            if let Some(id) = request.params["id"].as_str() {
                if let Some(token) = engine.jobs.lock().await.get(id) {
                    token.cancel();
                }
            }
            let _ = tx.send(json!({"id":request.id,"result":{}})).await;
            continue;
        }
        let permit = match concurrency.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => {
                let _ = tx
                    .send(json!({"id":request.id,"error":{"message":"Engine is busy"}}))
                    .await;
                continue;
            }
        };
        let token = CancellationToken::new();
        {
            let mut jobs = engine.jobs.lock().await;
            if jobs.contains_key(&request.id) {
                continue;
            }
            jobs.insert(request.id.clone(), token.clone());
        }
        let e = engine.clone();
        let tx = tx.clone();
        tasks.spawn(async move {
            let _permit = permit;
            let result = e.handle(&request.method, request.params, token).await;
            e.jobs.lock().await.remove(&request.id);
            let response = match result {
                Ok(result) => json!({"id":request.id,"result":result}),
                Err(error) => json!({"id":request.id,"error":{"message":format!("{error:#}")}}),
            };
            let _ = tx.send(response).await;
        });
        while tasks.try_join_next().is_some() {}
    }
    for token in engine.jobs.lock().await.values() {
        token.cancel();
    }
    // Let verification clean up Docker containers before aborting unrelated server requests.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(12), async {
        while tasks.join_next().await.is_some() {}
    })
    .await;
    tasks.abort_all();
    for peer in engine.peers.lock().await.values() {
        peer.stop().await;
    }
    *engine.terminals.lock().await = terminal::Terminals::default();
    drop(watcher);
    drop(engine);
    drop(tx);
    writer.abort();
    Ok(())
}
