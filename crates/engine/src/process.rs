use crate::{
    protocol::{child_environment, event, Events},
    workspace::{context_safe, Workspace},
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

pub fn command(executable: &str, root: &Path) -> Command {
    let mut cmd = Command::new(executable);
    cmd.current_dir(crate::workspace::process_path(root))
        .env_clear()
        .envs(child_environment())
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}

pub async fn bounded_read(mut reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        let take = n.min(limit.saturating_sub(output.len()));
        output.extend_from_slice(&chunk[..take]);
    }
    Ok(output)
}

pub async fn run(mut cmd: Command, seconds: u64) -> Result<Value> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let stdout = child.stdout.take().context("Missing stdout")?;
    let stderr = child.stderr.take().context("Missing stderr")?;
    let read_out = tokio::spawn(bounded_read(stdout, 2 * 1024 * 1024));
    let read_err = tokio::spawn(bounded_read(stderr, 512 * 1024));
    let status = match tokio::time::timeout(Duration::from_secs(seconds), child.wait()).await {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            read_out.abort();
            read_err.abort();
            bail!("Process timed out");
        }
    };
    let out = tokio::time::timeout(Duration::from_secs(3), read_out).await???;
    let err = tokio::time::timeout(Duration::from_secs(3), read_err).await???;
    Ok(
        json!({"code": status.code().unwrap_or(-1), "stdout":String::from_utf8_lossy(&out),"stderr":String::from_utf8_lossy(&err)}),
    )
}

pub async fn git(w: &Workspace, action: &str, params: &Value) -> Result<Value> {
    let mut cmd = command("git", &w.root);
    // Hooks and external diff helpers must never execute as a side effect of the source-control panel.
    cmd.args([
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "diff.external=",
        "-c",
        "core.fsmonitor=false",
        "--no-pager",
    ]);
    match action {
        "status" => {
            cmd.args(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        }
        "branches" => {
            cmd.args(["branch", "--format=%(HEAD)%(refname:short)"]);
        }
        "diff" => {
            cmd.args(["diff", "--no-ext-diff", "--no-textconv"]);
            if params["staged"] == true {
                cmd.arg("--cached");
            }
            cmd.arg("--");
            if let Some(path) = params["path"].as_str() {
                w.resolve(path)?;
                cmd.arg(path);
            }
        }
        "stage" | "unstage" => {
            let path = params["path"].as_str().context("Path required")?;
            w.resolve(path)?;
            if action == "stage" {
                cmd.args(["add", "--", path]);
            } else {
                cmd.args(["restore", "--staged", "--", path]);
            }
        }
        "commit" => {
            let msg = params["message"]
                .as_str()
                .context("Commit message required")?;
            anyhow::ensure!(
                !msg.trim().is_empty() && msg.len() <= 4000,
                "Invalid commit message"
            );
            cmd.args(["-c", "commit.gpgsign=false", "commit", "-m", msg]);
        }
        "switch" => {
            let branch = params["branch"].as_str().context("Branch required")?;
            anyhow::ensure!(
                !branch.starts_with('-') && branch.len() <= 200 && !branch.is_empty(),
                "Invalid branch"
            );
            cmd.args(["switch", branch]);
        }
        _ => bail!("Unsupported Git action"),
    }
    let out = run(cmd, 30).await?;
    if out["code"] != 0 {
        bail!(
            "Git: {}",
            out["stderr"].as_str().unwrap_or("operation failed")
        );
    }
    Ok(out)
}

pub async fn verify(
    w: &Workspace,
    commands: &[String],
    tx: &Events,
    cancel: CancellationToken,
) -> Result<Value> {
    let image =
        std::env::var("DEGRAVITY_SANDBOX_IMAGE").unwrap_or_else(|_| "node:22-bookworm-slim".into());
    anyhow::ensure!(
        !image.starts_with('-') && !image.is_empty(),
        "Invalid sandbox image"
    );
    let scratch = tempfile::tempdir()?;
    let snapshot = Workspace::new(scratch.path().to_path_buf())?;
    let source = w.clone();
    let destination = snapshot.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut budget = 64 * 1024 * 1024u64;
        for entry in source.entries() {
            if !context_safe(&entry.path) || entry.size > crate::workspace::MAX_FILE {
                continue;
            }
            if entry.size > budget {
                bail!("Sandbox snapshot exceeds 64 MiB");
            }
            if let Ok(text) = source.read(&entry.path) {
                destination.write(&entry.path, &text)?;
                std::fs::set_permissions(
                    destination.resolve(&entry.path)?,
                    std::fs::metadata(source.resolve(&entry.path)?)?.permissions(),
                )?;
                budget -= entry.size;
            }
        }
        Ok(())
    })
    .await??;
    let mut logs = Vec::new();
    for script in commands {
        anyhow::ensure!(script.len() <= 8000, "Verification command too long");
        let name = format!("degravity-{}", uuid::Uuid::new_v4());
        let mount_path = snapshot.root.to_string_lossy();
        let mount_path = mount_path.strip_prefix(r"\\?\").unwrap_or(&mount_path);
        anyhow::ensure!(
            !mount_path.contains(','),
            "Sandbox path cannot contain commas"
        );
        let mount = format!("type=bind,source={mount_path},target=/workspace");
        let mut cmd = command("docker", &w.root);
        cmd.args([
            "run",
            "--rm",
            "--pull=never",
            "--name",
            &name,
            "--network=none",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--memory=1g",
            "--cpus=2",
            "--pids-limit=128",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,size=128m",
            "--mount",
            &mount,
            "-w",
            "/workspace",
            "--env",
            "HOME=/tmp",
        ]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let owner = std::fs::metadata(&snapshot.root)?;
            cmd.args(["--user", &format!("{}:{}", owner.uid(), owner.gid())]);
        }
        cmd.args([&image, "/bin/sh", "-lc", script]);
        event(
            tx,
            "agent.verification",
            json!({"command":script,"status":"running"}),
        )
        .await;
        let result = tokio::select! { _ = cancel.cancelled() => Err(anyhow::anyhow!("Cancelled")), value = run(cmd, 120) => value };
        // Killing the Docker client alone does not stop its container. Always force-remove by generated name.
        let mut cleanup = command("docker", &w.root);
        cleanup.args(["rm", "-f", &name]);
        let _ = run(cleanup, 10).await;
        let result = result?;
        event(
            tx,
            "agent.verification",
            json!({"command":script,"result":result}),
        )
        .await;
        let failed = result["code"] != 0;
        logs.push(json!({"command":script,"result":result}));
        if failed {
            break;
        }
    }
    Ok(
        json!({"logs":logs,"passed":logs.iter().all(|v|v["result"]["code"] == 0),"sandbox":"Docker, offline copy; workspace unchanged by verification"}),
    )
}
