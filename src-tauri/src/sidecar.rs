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

/// Marker file inside the sidecar temp dir recording which Qube version the
/// copied files came from. The delta copy is only valid for the *same* release
/// (see [`prepare_sidecar_dir`]).
const SIDECAR_VERSION_STAMP: &str = ".qube-version";

#[derive(Debug, Default)]
struct CopyStats {
    copied: usize,
    skipped: usize,
    /// True when the temp dir was rebuilt from scratch because it belonged to
    /// another Qube version (or predates the version stamp).
    resynced: bool,
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
///
/// Only valid for the same Qube version — `fs::copy` stamps the destination
/// with the copy time, so packaged files always look older than the copy and
/// would never be refreshed (see [`prepare_sidecar_dir`]).
fn copy_dir_delta(src: &Path, dst: &Path) -> std::io::Result<(usize, usize)> {
    fs::create_dir_all(dst)?;
    let mut copied = 0usize;
    let mut skipped = 0usize;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ft.is_dir() {
            let (c, s) = copy_dir_delta(&src_path, &dst_path)?;
            copied += c;
            skipped += s;
        } else if ft.is_symlink() {
            // Resource dirs shouldn't contain symlinks, but never break startup on one.
            skipped += 1;
        } else {
            let skip = (|| -> Option<bool> {
                let src_md = fs::metadata(&src_path).ok()?;
                let dst_md = fs::metadata(&dst_path).ok()?;
                if src_md.len() != dst_md.len() {
                    return Some(false);
                }
                let src_mtime = src_md.modified().ok()?;
                let dst_mtime = dst_md.modified().ok()?;
                Some(dst_mtime >= src_mtime)
            })()
            .unwrap_or(false);
            if skip {
                skipped += 1;
            } else {
                fs::copy(&src_path, &dst_path)?;
                copied += 1;
            }
        }
    }
    Ok((copied, skipped))
}

/// Prepares the writable sidecar copy under `base` for `app_version`.
///
/// The delta copy's `same size + dst mtime >= src mtime` heuristic can only
/// prove that a file is unchanged *within* one release. Across releases it is
/// actively wrong: `fs::copy` gives the destination the copy time, while
/// packaged files carry their build time, so the old copy always wins. Files
/// whose size does not change between releases (`package.json` and
/// `.next/BUILD_ID` are the same length in every build) were therefore never
/// refreshed — the desktop binary updated while the sidecar kept serving the
/// previous release's UI and reported the old version in Settings. That reads
/// as "it still shows v0.0.80" and, because the updater compares the *binary*
/// version, "you're up to date" at the same time.
///
/// So: reuse the delta copy only when the stamp matches the running app
/// version, otherwise wipe and copy everything.
fn prepare_sidecar_dir(
    src: &Path,
    base: &Path,
    app_version: &str,
) -> Result<(PathBuf, CopyStats), String> {
    let stamp = base.join(SIDECAR_VERSION_STAMP);
    let cached_version = fs::read_to_string(&stamp)
        .ok()
        .map(|v| v.trim().to_string());

    if cached_version.as_deref() == Some(app_version) {
        let (copied, skipped) = copy_dir_delta(src, base).map_err(|e| {
            format!(
                "Failed to update sidecar files in {} from {}: {}",
                base.display(),
                src.display(),
                e
            )
        })?;
        return Ok((
            base.to_path_buf(),
            CopyStats {
                copied,
                skipped,
                resynced: false,
            },
        ));
    }

    if base.exists() {
        fs::remove_dir_all(base).map_err(|e| {
            format!(
                "Failed to clear sidecar cache {} (cached version {}, running {}): {}",
                base.display(),
                cached_version.as_deref().unwrap_or("unversioned"),
                app_version,
                e
            )
        })?;
    }
    copy_dir_recursively(src, base).map_err(|e| {
        format!(
            "Failed to copy sidecar {} to {}: {}",
            src.display(),
            base.display(),
            e
        )
    })?;
    // Written last: a failed copy leaves no stamp, so the next launch retries
    // the full copy instead of trusting a half-populated directory.
    if let Err(e) = fs::write(&stamp, app_version) {
        eprintln!("Failed to write sidecar version stamp {}: {e}", stamp.display());
    }
    Ok((
        base.to_path_buf(),
        CopyStats {
            resynced: true,
            ..Default::default()
        },
    ))
}

/// Reads the version reported by an already-running Qube sidecar on `port`.
/// Returns `None` when nothing answers or the response has no version field.
pub fn running_version(port: u16) -> Option<String> {
    use std::io::{Read, Write};

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    stream
        .write_all(b"GET /api/settings HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    // Response body: {"settings":{...},"version":"0.0.89"}
    let key = "\"version\"";
    let mut from = 0;
    while let Some(pos) = response[from..].find(key) {
        let after = response[from + pos + key.len()..].trim_start();
        if let Some(rest) = after.strip_prefix(':') {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('"') {
                let end = rest.find('"')?;
                return Some(rest[..end].to_string());
            }
        }
        from += pos + key.len();
    }
    None
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
    pub fn start(
        dist_dir: &std::path::Path,
        data_dir: &std::path::Path,
        app_version: &str,
    ) -> Result<Self, String> {
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
        // on every start. The delta copy is only trusted for the same app
        // version — an in-place update must rebuild the dir, or the sidecar
        // keeps serving the previous release (see prepare_sidecar_dir).
        // Only fall back to a pid-suffixed dir when the base dir is locked by
        // a still-running instance.
        let app_dir = {
            let base = std::env::temp_dir().join("qube-sidecar");
            match prepare_sidecar_dir(dist_dir, &base, app_version) {
                Ok((dir, stats)) if stats.resynced => {
                    log_line(
                        &mut log,
                        &format!(
                            "Sidecar cache rebuilt for v{app_version} (full copy to {})",
                            dir.display()
                        ),
                    );
                    dir
                }
                Ok((dir, stats)) => {
                    log_line(
                        &mut log,
                        &format!(
                            "Sidecar delta copy: {} copied, {} reused (v{app_version})",
                            stats.copied, stats.skipped
                        ),
                    );
                    dir
                }
                Err(e) => {
                    log_line(
                        &mut log,
                        &format!(
                            "Sidecar cache update failed ({}); trying pid-suffixed dir",
                            e
                        ),
                    );
                    let dir =
                        std::env::temp_dir().join(format!("qube-sidecar-{}", std::process::id()));
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
                    dir
                }
            }
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
            // Authoritative app version, straight from the desktop binary.
            // `/api/settings` prefers it over the package.json inside the
            // sidecar copy, so the version shown in Settings can never lag
            // behind the installed app.
            .env("QUBE_APP_VERSION", app_version)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::FileTimes;
    use std::time::{Duration, SystemTime};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qube-sidecar-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_at(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    /// Packaged files carry their build mtime, which is older than the temp
    /// copy (fs::copy stamps the destination with the copy time).
    fn set_mtime_in_the_past(path: &Path) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(
            FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000)),
        )
        .unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn same_version_reuses_unchanged_files() {
        let root = temp_dir("same-version");
        let src = root.join("src");
        let dst = root.join("dst");
        write_at(&src.join("package.json"), "{\"version\":\"0.0.80\"}");
        write_at(&src.join(".next/BUILD_ID"), "aaaaaaaaaaaaaaaaaaaaa");

        let (dir, stats) = prepare_sidecar_dir(&src, &dst, "0.0.80").unwrap();
        assert_eq!(dir, dst);
        assert!(stats.resynced);
        assert_eq!(read(&dst.join("package.json")), "{\"version\":\"0.0.80\"}");

        // Second launch of the same version: nothing changed, nothing copied.
        let (_, stats) = prepare_sidecar_dir(&src, &dst, "0.0.80").unwrap();
        assert!(!stats.resynced);
        assert_eq!(stats.copied, 0);
        assert_eq!(stats.skipped, 2);

        let _ = fs::remove_dir_all(&root);
    }

    /// Regression: after an in-place update, files whose size did not change
    /// but whose packaged mtime is older than the temp copy were skipped, so
    /// the sidecar kept serving the previous release (Settings showed the old
    /// version while the binary — and therefore the updater — was current).
    #[test]
    fn version_change_refreshes_even_when_size_and_mtime_match() {
        let root = temp_dir("version-change");
        let src = root.join("src");
        let dst = root.join("dst");
        write_at(&src.join("package.json"), "{\"version\":\"0.0.80\"}");
        write_at(&src.join(".next/BUILD_ID"), "aaaaaaaaaaaaaaaaaaaaa");
        prepare_sidecar_dir(&src, &dst, "0.0.80").unwrap();

        // New release: same names, same lengths, packaged mtimes in the past.
        write_at(&src.join("package.json"), "{\"version\":\"0.0.89\"}");
        write_at(&src.join(".next/BUILD_ID"), "bbbbbbbbbbbbbbbbbbbbb");
        set_mtime_in_the_past(&src.join("package.json"));
        set_mtime_in_the_past(&src.join(".next/BUILD_ID"));

        // A delta copy would skip both (same size, dst mtime is "now").
        let (_, stats) = prepare_sidecar_dir(&src, &dst, "0.0.89").unwrap();
        assert!(stats.resynced);
        assert_eq!(read(&dst.join("package.json")), "{\"version\":\"0.0.89\"}");
        assert_eq!(read(&dst.join(".next/BUILD_ID")), "bbbbbbbbbbbbbbbbbbbbb");
        assert_eq!(read(&dst.join(SIDECAR_VERSION_STAMP)).trim(), "0.0.89");

        let _ = fs::remove_dir_all(&root);
    }

    /// Within one version the fast path must still pick up changed and new
    /// files, so a repaired/resumed install isn't stuck on an old copy.
    #[test]
    fn same_version_delta_copies_changed_and_new_files() {
        let root = temp_dir("delta");
        let src = root.join("src");
        let dst = root.join("dst");
        write_at(&src.join("server.js"), "one");
        prepare_sidecar_dir(&src, &dst, "1.0.0").unwrap();

        write_at(&src.join("server.js"), "two-longer");
        write_at(&src.join("new.js"), "new");
        let (_, stats) = prepare_sidecar_dir(&src, &dst, "1.0.0").unwrap();
        assert!(!stats.resynced);
        assert_eq!(stats.copied, 2);
        assert_eq!(read(&dst.join("server.js")), "two-longer");
        assert!(dst.join("new.js").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
