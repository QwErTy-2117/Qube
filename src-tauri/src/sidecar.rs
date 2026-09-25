use std::fs;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

fn log_line(log: &mut fs::File, msg: &str) {
    let _ = writeln!(log, "{msg}");
}

fn copy_dir_recursively(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursively(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Prefer the Node.js runtime bundled next to server.js (shipped as a Tauri
/// resource so user machines don't need Node.js installed — typically absent
/// on Windows/macOS). Fall back to PATH `node` for dev / missing bundle.
/// Returns the binary path and whether it is the bundled one.
fn resolve_node_bin(app_dir: &Path) -> (PathBuf, bool) {
    #[cfg(windows)]
    let bundled = app_dir.join("node-bin").join("node.exe");
    #[cfg(not(windows))]
    let bundled = app_dir.join("node-bin").join("node");
    if bundled.exists() {
        #[cfg(unix)]
        {
            // Copying may drop the executable bit; ensure it on the live copy
            // (app_dir is always user-writable, unlike the resource dir).
            use std::os::unix::fs::PermissionsExt;
            if let Ok(md) = fs::metadata(&bundled) {
                let mut perms = md.permissions();
                if perms.mode() & 0o111 == 0 {
                    perms.set_mode(0o755);
                    let _ = fs::set_permissions(&bundled, perms);
                }
            }
        }
        (bundled, true)
    } else {
        (PathBuf::from("node"), false)
    }
}

#[allow(dead_code)]
pub struct Sidecar {
    pub child: Option<Child>,
    pub port: u16,
}

impl Sidecar {
    pub fn start(dist_dir: &std::path::Path, data_dir: &std::path::Path) -> Result<Self, String> {
        // data_dir doubles as the diagnostics location: sidecar.log captures
        // the Next.js server output so a failed start is debuggable from a
        // user machine without devtools.
        fs::create_dir_all(data_dir)
            .map_err(|e| format!("Failed to create data dir {}: {}", data_dir.display(), e))?;
        let log_path = data_dir.join("sidecar.log");
        let mut log = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open {}: {}", log_path.display(), e))?;
        log_line(&mut log, &format!("Starting sidecar from {}", dist_dir.display()));

        // Use a user-writable temp directory so Next.js can write caches.
        // On Windows a previous instance may still hold the dir (cwd/file
        // locks) making cleanup fail — fall back to a pid-suffixed dir
        // instead of failing startup.
        let app_dir = {
            let base = std::env::temp_dir().join("qube-sidecar");
            let mut dir = base.clone();
            if base.exists() {
                if let Err(e) = fs::remove_dir_all(&base) {
                    log_line(
                        &mut log,
                        &format!(
                            "Could not clean {} ({}); using pid-suffixed dir",
                            base.display(),
                            e
                        ),
                    );
                    dir = std::env::temp_dir()
                        .join(format!("qube-sidecar-{}", std::process::id()));
                    if dir.exists() {
                        fs::remove_dir_all(&dir).map_err(|e| {
                            format!("Failed to clean sidecar temp dir {}: {}", dir.display(), e)
                        })?;
                    }
                }
            }
            copy_dir_recursively(dist_dir, &dir).map_err(|e| {
                format!(
                    "Failed to copy sidecar {} to temp dir {}: {}",
                    dist_dir.display(),
                    dir.display(),
                    e
                )
            })?;
            dir
        };
        log_line(&mut log, &format!("Sidecar files at {}", app_dir.display()));

        let (node_bin, bundled) = resolve_node_bin(&app_dir);
        log_line(
            &mut log,
            &format!(
                "Node.js: {} ({})",
                node_bin.display(),
                if bundled { "bundled" } else { "PATH fallback" }
            ),
        );

        // Use a fixed port so localStorage (origin-scoped) persists across restarts
        let port: u16 = {
            let preferred: u16 = 3010;
            match TcpListener::bind(("127.0.0.1", preferred)) {
                Ok(listener) => {
                    drop(listener);
                    preferred
                }
                Err(_) => {
                    let listener = TcpListener::bind("127.0.0.1:0")
                        .map_err(|e| format!("Failed to bind port: {e}"))?;
                    listener
                        .local_addr()
                        .map_err(|e| format!("Failed to get port: {e}"))?
                        .port()
                }
            }
        };

        let log_out = log.try_clone().map_err(|e| format!("Failed to clone log handle: {e}"))?;
        let log_err = log.try_clone().map_err(|e| format!("Failed to clone log handle: {e}"))?;
        let mut child = Command::new(&node_bin)
            .arg("server.js")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("QUBE_DATA_DIR", data_dir.to_string_lossy().as_ref())
            .current_dir(&app_dir)
            .stdout(Stdio::from(log_out))
            .stderr(Stdio::from(log_err))
            .spawn()
            .map_err(|e| {
                if bundled {
                    format!(
                        "Failed to spawn bundled Node.js at {}: {}. See {}",
                        node_bin.display(),
                        e,
                        log_path.display()
                    )
                } else {
                    format!(
                        "Failed to spawn `node` from PATH: {}. Bundled Node.js is missing ({} not found) and this machine has no system Node.js — reinstall Qube. See {}",
                        e,
                        node_bin.display(),
                        log_path.display()
                    )
                }
            })?;

        // Poll TCP until server accepts connections
        let max_retries = 40;
        for i in 0..max_retries {
            if TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
                // Extra small delay to let Next.js finish its first render
                thread::sleep(Duration::from_millis(300));
                log_line(&mut log, &format!("Server up on port {port}"));
                return Ok(Sidecar {
                    child: Some(child),
                    port,
                });
            }
            thread::sleep(Duration::from_millis(500));
            if i % 5 == 4 {
                log_line(
                    &mut log,
                    &format!(
                        "Waiting for Next.js server on port {port}... ({}/{max_retries})",
                        i + 1,
                    ),
                );
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
            "Next.js server on port {port} did not start within {}s. Server output was captured in {}",
            max_retries / 2,
            log_path.display()
        ))
    }
}
