use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command};
use std::thread;
use std::time::Duration;

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

#[allow(dead_code)]
pub struct Sidecar {
    pub child: Option<Child>,
    pub port: u16,
}

impl Sidecar {
    pub fn start(dist_dir: &std::path::Path, data_dir: &std::path::Path) -> Result<Self, String> {
        // Use a user-writable temp directory so Next.js can write caches
        let app_dir = {
            let tmp = std::env::temp_dir().join("qube-sidecar");
            if tmp.exists() {
                fs::remove_dir_all(&tmp).map_err(|e| {
                    format!("Failed to clean sidecar temp dir: {}", e)
                })?;
            }
            copy_dir_recursively(dist_dir, &tmp).map_err(|e| {
                format!("Failed to copy sidecar to temp dir: {}", e)
            })?;
            tmp
        };

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
                        .map_err(|e| format!("Failed to bind port: {}", e))?;
                    listener
                        .local_addr()
                        .map_err(|e| format!("Failed to get port: {}", e))?
                        .port()
                }
            }
        };

        let mut child = Command::new("node")
            .arg("server.js")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("QUBE_DATA_DIR", data_dir.to_string_lossy().as_ref())
            .current_dir(&app_dir)
            .spawn()
            .map_err(|e| format!("Failed to spawn Next.js server: {}", e))?;

        // Poll TCP until server accepts connections
        let max_retries = 40;
        for i in 0..max_retries {
            if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                // Extra small delay to let Next.js finish its first render
                thread::sleep(Duration::from_millis(300));
                return Ok(Sidecar {
                    child: Some(child),
                    port,
                });
            }
            thread::sleep(Duration::from_millis(500));
            if i % 5 == 4 {
                eprintln!(
                    "Waiting for Next.js server on port {}... ({}/{})",
                    port,
                    i + 1,
                    max_retries
                );
            }
        }

        let _ = child.wait();
        Err(format!(
            "Next.js server on port {} did not start within {}s",
            port,
            max_retries / 2
        ))
    }
}
