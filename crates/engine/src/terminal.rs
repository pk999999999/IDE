use crate::protocol::{child_environment, Events};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}
#[derive(Default)]
pub struct Terminals {
    sessions: HashMap<String, Session>,
}

impl Terminals {
    pub fn create(&mut self, root: &Path, cols: u16, rows: u16, tx: Events) -> Result<String> {
        anyhow::ensure!(self.sessions.len() < 8, "Maximum eight terminals");
        let pair = native_pty_system().openpty(size(cols, rows))?;
        let shell = if cfg!(windows) {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
        };
        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(crate::workspace::process_path(root));
        cmd.env_clear();
        for (k, v) in child_environment() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let id = uuid::Uuid::new_v4().to_string();
        let event_id = id.clone();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 8192];
            while let Ok(n) = reader.read(&mut bytes) {
                if n == 0 {
                    break;
                }
                if tx.blocking_send(json!({"event":"pty.data","data":{"id":event_id,"base64":STANDARD.encode(&bytes[..n])}})).is_err() { break; }
            }
            let _ = tx.blocking_send(json!({"event":"pty.exit","data":{"id":event_id}}));
        });
        self.sessions.insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(id)
    }
    pub fn write(&mut self, id: &str, text: &str) -> Result<()> {
        let s = self.sessions.get_mut(id).context("Unknown terminal")?;
        s.writer.write_all(text.as_bytes())?;
        s.writer.flush()?;
        Ok(())
    }
    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<()> {
        self.sessions
            .get_mut(id)
            .context("Unknown terminal")?
            .master
            .resize(size(cols, rows))?;
        Ok(())
    }
    pub fn close(&mut self, id: &str) -> Result<()> {
        if let Some(mut s) = self.sessions.remove(id) {
            s.child.kill()?;
            let _ = s.child.wait();
        }
        Ok(())
    }
}
impl Drop for Terminals {
    fn drop(&mut self) {
        for (_, mut s) in self.sessions.drain() {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 300),
        cols: cols.clamp(2, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}
