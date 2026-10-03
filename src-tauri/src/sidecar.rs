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

/// Delta copy: skip files that already exist with the same size and a
/// dst mtime >= src mtime. On Windows a full copy every launch means
/// thousands of files + ~80MB node.exe through Defender on every start.
/// Reusing the temp dir cuts cold start by seconds on second+ launches.
fn copy_dir_delta(src: &Path, dst: &Path, log: &mut fs::File) -> std::io::Result<(usize, usize)> {
    fs::create_dir_all(dst)?;
    let mut copied = 0usize;
    let mut skipped = 0usize;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ft.is_dir() {
            let (c, s) = copy_dir_delta(&src_path, &dst_path, log)?;
            copied += c;
            skipped += s;
        } else if ft.is_symlink() {
            // Resource dirs shouldn't contain symlinks, but never break startup on one.
            skipped += 1;
        } else {
            let skip = (|| -> bool {
                let src_md = fs::metadata(&src_path).ok()?;
                let dst_md = fs::metadata(&dst_path).ok()?;
                if src_md.len() != dst_md.len() {
                    return false;
                }
                let src_mtime = src_md.modified().ok()?;
                let dst_mtime = dst_md.modified().ok()?;
                Some(dst_mtime >= src_mtime).unwrap_or(false)
            })();
            if skip {
                skipped += 1;
            } else {
                fs::copy(&src_path, &dst_path)?;
                copied += 1;
            }
        }
    }
    let _ = log;
    Ok((copied, skipped))
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
        log_line(
            &mut log,
            &format!("Starting sidecar from {}", dist_dir.display()),
        );

        // Use a user-writable temp directory so Next.js can write caches.
        // Windows fast path: reuse the previous temp dir with a delta copy
        // (skip unchanged files) instead of delete + full copy every launch.
        // A full copy forces Defender to rescan thousands of files + node.exe
        // on every start. Only fall back to a pid-suffixed dir when the base
        // dir is locked by a still-running instance.
        let app_dir = {
            let base = std::env::temp_dir().join("qube-sidecar");
            // Probe writability: try creating the dir; if it exists and is
            // locked (Windows file locks), canonicalize will still succeed —
            // the delta copy below will surface a real IO error, at which
            // point we fall back to a pid-suffixed dir.
            let mut dir = base.clone();
            let delta_result = copy_dir_delta(dist_dir, &dir, &mut log);
            match delta_result {
                Ok((copied, skipped)) => {
                    log_line(
                        &mut log,
                        &format!("Sidecar delta copy: {copied} copied, {skipped} reused"),
                    );
                }
                Err(e) => {
                    log_line(
                        &mut log,
                        &format!(
                            "Delta copy to {} failed ({}); trying pid-suffixed dir",
                            base.display(),
                            e
                        ),
                    );
                    dir = std::env::temp_dir().join(format!("qube-sidecar-{}", std::process::id()));
                    if dir.exists() {
                        fs::remove_dir_all(&dir).map_err(|e| {
                            format!("Failed to clean sidecar temp dir {}: {}", dir.display(), e)
                        })?;
                    }
                    copy_dir_recursively(dist_dir, &dir).map_err(|e| {
                        format!(
                            "Failed to copy sidecar {} to temp dir {}: {}",
                            dist_dir.display(),
                            dir.display(),
                            e
                        )
                    })?;
                }
            }
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

        let log_out = log
            .try_clone()
            .map_err(|e| format!("Failed to clone log handle: {e}"))?;
        let log_err = log
            .try_clone()
            .map_err(|e| format!("Failed to clone log handle: {e}"))?;
        let mut cmd = Command::new(&node_bin);
        cmd.arg("server.js")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("QUBE_DATA_DIR", data_dir.to_string_lossy().as_ref())
            .current_dir(&app_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_out))
            .stderr(Stdio::from(log_err));
        // Windows: node.exe is a console-subsystem binary. The main app
        // itself is windowed (windows_subsystem = "windows"), so without
        // CREATE_NO_WINDOW the OS pops a terminal window next to Qube for
        // the sidecar — and closing it kills the server, after which every
        // /api/* call fails with "Failed to fetch". Hide it entirely;
        // server output already goes to sidecar.log.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
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

        // Poll TCP until server accepts connections. Poll fast (100ms) so we
        // navigate the moment Next.js is up instead of up to 500ms later.
        let max_retries = 200;
        for i in 0..max_retries {
            if TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
                // Extra small delay to let Next.js finish its first render
                thread::sleep(Duration::from_millis(200));
                log_line(&mut log, &format!("Server up on port {port}"));
                return Ok(Sidecar {
                    child: Some(child),
                    port,
                });
            }
            thread::sleep(Duration::from_millis(100));
            if i % 25 == 24 {
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
            max_retries / 10,
            log_path.display()
        ))
    }
}
