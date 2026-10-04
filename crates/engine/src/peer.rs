use crate::{
    process::command,
    protocol::{event, Events, MAX_FRAME},
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::{oneshot, Mutex},
};

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;
pub struct Peer {
    writer: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next: AtomicU64,
    child: Mutex<Child>,
    lsp: bool,
}
impl Peer {
    pub async fn start(
        root: &Path,
        executable: &str,
        args: &[String],
        lsp: bool,
        tx: Events,
    ) -> Result<Self> {
        let mut cmd = command(executable, root);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd
            .spawn()
            .context("Cannot start external server; install it and check its executable path")?;
        let writer = Arc::new(Mutex::new(child.stdin.take().context("Missing stdin")?));
        let mut reader = BufReader::new(child.stdout.take().context("Missing stdout")?);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let responses = pending.clone();
        let outgoing = writer.clone();
        tokio::spawn(async move {
            loop {
                let parsed: Result<Value> = async {
                    let data = if lsp {
                        let mut length = None;
                        let mut total = 0;
                        loop {
                            let mut line = String::new();
                            let n = (&mut reader).take(8193).read_line(&mut line).await?;
                            if n == 0 {
                                bail!("Server closed");
                            }
                            total += n;
                            anyhow::ensure!(total <= 8192, "LSP headers too large");
                            if line.trim().is_empty() {
                                break;
                            }
                            if let Some((name, value)) = line.split_once(':') {
                                if name.eq_ignore_ascii_case("content-length") {
                                    length = Some(value.trim().parse::<usize>()?);
                                }
                            }
                        }
                        let length = length.context("No Content-Length")?;
                        anyhow::ensure!(length <= MAX_FRAME, "LSP frame too large");
                        let mut bytes = vec![0; length];
                        reader.read_exact(&mut bytes).await?;
                        bytes
                    } else {
                        let mut bytes = Vec::new();
                        let n = (&mut reader)
                            .take((MAX_FRAME + 1) as u64)
                            .read_until(b'\n', &mut bytes)
                            .await?;
                        anyhow::ensure!(n > 0 && n <= MAX_FRAME, "Invalid MCP frame");
                        bytes
                    };
                    Ok(serde_json::from_slice(&data)?)
                }
                .await;
                let value = match parsed {
                    Ok(v) => v,
                    Err(e) => {
                        event(
                            &tx,
                            if lsp { "lsp.error" } else { "mcp.error" },
                            json!({"message":e.to_string()}),
                        )
                        .await;
                        break;
                    }
                };
                if value.get("method").is_some() {
                    if let Some(id) = value.get("id") {
                        let reply = if value["method"] == "ping" {
                            json!({"jsonrpc":"2.0","id":id,"result":{}})
                        } else {
                            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Client capability not supported"}})
                        };
                        let _ = send(&outgoing, lsp, &reply).await;
                    } else {
                        event(
                            &tx,
                            if lsp {
                                "lsp.notification"
                            } else {
                                "mcp.notification"
                            },
                            value,
                        )
                        .await;
                    }
                } else if let Some(id) = value["id"].as_u64() {
                    if let Some(waiter) = responses.lock().await.remove(&id) {
                        let _ = waiter.send(value);
                    }
                }
            }
            responses.lock().await.clear();
        });
        Ok(Self {
            writer,
            pending,
            next: AtomicU64::new(1),
            child: Mutex::new(child),
            lsp,
        })
    }
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let result = async {
            send(
                &self.writer,
                self.lsp,
                &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
            )
            .await?;
            let value = tokio::time::timeout(Duration::from_secs(30), rx).await??;
            if value.get("error").is_some() {
                bail!("Server error: {}", value["error"]);
            }
            Ok(value["result"].clone())
        }
        .await;
        self.pending.lock().await.remove(&id);
        result
    }
    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        send(
            &self.writer,
            self.lsp,
            &json!({"jsonrpc":"2.0","method":method,"params":params}),
        )
        .await
    }
    pub async fn stop(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}
async fn send(writer: &Mutex<ChildStdin>, lsp: bool, message: &Value) -> Result<()> {
    let body = serde_json::to_vec(message)?;
    anyhow::ensure!(body.len() <= MAX_FRAME, "Frame too large");
    let mut writer = writer.lock().await;
    if lsp {
        writer
            .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
            .await?;
    }
    writer.write_all(&body).await?;
    if !lsp {
        writer.write_all(b"\n").await?;
    }
    writer.flush().await?;
    Ok(())
}
