use anyhow::{bail, Context, Result};
use ignore::WalkBuilder;
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const MAX_FILE: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct Workspace {
    pub root: PathBuf,
}

#[derive(Serialize, Clone)]
pub struct Entry {
    pub path: String,
    pub size: u64,
}

impl Workspace {
    pub fn new(root: PathBuf) -> Result<Self> {
        let root = root.canonicalize().context("Workspace does not exist")?;
        if !root.is_dir() {
            bail!("Workspace must be a directory");
        }
        Ok(Self { root })
    }

    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        if relative.is_empty()
            || relative.contains('\\')
            || relative.contains(':')
            || relative.contains('\0')
        {
            bail!("Invalid relative path");
        }
        let path = Path::new(relative);
        let mut full = self.root.clone();
        for part in path.components() {
            let Component::Normal(name) = part else {
                bail!("Path traversal is forbidden");
            };
            let name_text = name.to_string_lossy();
            if name_text.eq_ignore_ascii_case(".git") || name_text.ends_with(['.', ' ']) {
                bail!("Protected or ambiguous path");
            }
            full.push(name);
            match fs::symlink_metadata(&full) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        bail!("Symbolic links are not writable workspace paths");
                    }
                    let canonical = full.canonicalize()?;
                    if !canonical.starts_with(&self.root) {
                        bail!("Path escapes workspace");
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::MetadataExt;
                        if meta.is_file() && meta.nlink() > 1 {
                            bail!("Hard-linked files are not supported");
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(full)
    }

    pub fn read(&self, path: &str) -> Result<String> {
        let full = self.resolve(path)?;
        if fs::metadata(&full)?.len() > MAX_FILE {
            bail!("File exceeds 1 MiB editor limit");
        }
        let text = fs::read_to_string(full).context("Only UTF-8 text files are supported")?;
        if text.contains('\0') {
            bail!("Binary files are not supported");
        }
        Ok(text)
    }

    pub fn optional_read(&self, path: &str) -> Result<Option<String>> {
        let full = self.resolve(path)?;
        if !full.exists() {
            return Ok(None);
        }
        self.read(path).map(Some)
    }

    pub fn write(&self, path: &str, content: &str) -> Result<()> {
        if content.len() as u64 > MAX_FILE {
            bail!("File exceeds 1 MiB limit");
        }
        let full = self.resolve(path)?;
        let parent = full.parent().context("Missing parent")?;
        fs::create_dir_all(parent)?;
        self.resolve(path)?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
        temp.write_all(content.as_bytes())?;
        if let Ok(meta) = fs::metadata(&full) {
            temp.as_file().set_permissions(meta.permissions())?;
        }
        temp.as_file().sync_all()?;
        temp.persist(&full).map_err(|e| e.error)?;
        Ok(())
    }

    pub fn delete(&self, path: &str) -> Result<()> {
        let full = self.resolve(path)?;
        if full.is_dir() {
            bail!("Directory deletion is intentionally unsupported; delete individual files");
        }
        fs::remove_file(full)?;
        Ok(())
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        let source = self.resolve(from)?;
        let dest = self.resolve(to)?;
        if !source.is_file() {
            bail!("Only file renames are supported");
        }
        if dest.exists() {
            bail!("Destination already exists");
        }
        fs::create_dir_all(dest.parent().context("Missing parent")?)?;
        self.resolve(to)?;
        fs::rename(source, dest)?;
        Ok(())
    }

    pub fn entries(&self) -> Vec<Entry> {
        let entries = Arc::new(Mutex::new(Vec::new()));
        let result = entries.clone();
        let root = self.root.clone();
        WalkBuilder::new(&self.root)
            .hidden(false)
            .git_ignore(true)
            .git_exclude(true)
            .require_git(false)
            .filter_entry(|e| {
                !matches!(
                    e.file_name().to_str(),
                    Some(".git" | "node_modules" | "target" | "dist" | ".degravity")
                )
            })
            .build_parallel()
            .run(|| {
                let entries = entries.clone();
                let root = root.clone();
                Box::new(move |entry| {
                    if let Ok(entry) = entry {
                        if entry.file_type().is_some_and(|t| t.is_file()) {
                            if let (Ok(path), Ok(meta)) =
                                (entry.path().strip_prefix(&root), entry.metadata())
                            {
                                let mut out = entries.lock().unwrap();
                                if out.len() >= 100_000 {
                                    return ignore::WalkState::Quit;
                                }
                                out.push(Entry {
                                    path: path.to_string_lossy().replace('\\', "/"),
                                    size: meta.len(),
                                });
                            }
                        }
                    }
                    ignore::WalkState::Continue
                })
            });
        let mut out = result.lock().unwrap().clone();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        out
    }
}

pub fn context_safe(path: &str) -> bool {
    !path.split('/').any(|p| {
        p.starts_with(".env")
            || matches!(
                p,
                ".git"
                    | ".ssh"
                    | ".aws"
                    | ".npmrc"
                    | ".pypirc"
                    | ".netrc"
                    | ".git-credentials"
                    | "secrets"
                    | "node_modules"
                    | "target"
                    | ".degravity"
            )
            || p.ends_with(".pem")
            || p.ends_with(".key")
            || p == "credentials.json"
    })
}

pub fn process_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(server) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", server));
        }
        if let Some(drive) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(drive);
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_atomic_files() {
        let dir = tempfile::tempdir().unwrap();
        let w = Workspace::new(dir.path().into()).unwrap();
        for p in [
            "../escape",
            "/tmp/escape",
            "a/../../b",
            "C:/x",
            "a\\b",
            ".git/config",
            "a.",
        ] {
            assert!(w.resolve(p).is_err(), "{p}");
        }
        w.write("src/hello.ts", "hello").unwrap();
        w.write("src/hello.ts", "world").unwrap();
        assert_eq!(w.read("src/hello.ts").unwrap(), "world");
        assert!(w.rename("src/hello.ts", "src/hello.ts").is_err());
        w.delete("src/hello.ts").unwrap();
        assert_eq!(w.optional_read("src/hello.ts").unwrap(), None);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        assert!(Workspace::new(dir.path().into())
            .unwrap()
            .write("link/file", "x")
            .is_err());
    }
}
