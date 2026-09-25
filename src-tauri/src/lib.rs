mod commands;
mod sidecar;
mod tray;

use commands::AppState;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

fn dist_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        v.push(dir.join("_up_").join("sidecar-dist"));
        v.push(dir.join("sidecar-dist"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            v.push(parent.join("sidecar-dist"));
        }
    }
    v
}

fn find_dist_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    for p in &dist_candidates(app) {
        if p.join("server.js").exists() {
            return Some(p.clone());
        }
    }
    None
}

/// Write a styled startup-error page and navigate the main window to it so a
/// failed sidecar start is visible instead of a silent "Loading Qube..."
/// placeholder. Uses only the system font stack (no bundled fonts needed).
fn show_startup_error(app: &tauri::AppHandle, title: &str, details: &str, data_dir: &std::path::Path) {
    let _ = std::fs::create_dir_all(data_dir);
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let html = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Qube — {t}</title></head>\
        <body style=\"margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101514;color:#e8ece9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif\">\
        <main style=\"max-width:560px;padding:32px\">\
        <h1 style=\"font-size:20px;margin:0 0 12px\">{t}</h1>\
        <p style=\"font-size:14px;line-height:1.6;white-space:pre-wrap;opacity:.9\">{d}</p>\
        <p style=\"font-size:13px;opacity:.65\">Log: {l}</p>\
        <p style=\"font-size:13px;opacity:.65\">Restart Qube after fixing the issue. If it persists, include the log when reporting.</p>\
        </main></body></html>",
        t = esc(title),
        d = esc(details),
        l = esc(&data_dir.join("sidecar.log").to_string_lossy()),
    );
    let path = data_dir.join("startup-error.html");
    if std::fs::write(&path, html).is_ok() {
        if let Ok(url) = url::Url::from_file_path(&path) {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.navigate(url);
            }
        }
    }
}

fn is_server_running(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    )
    .is_ok()
}

use tauri_plugin_autostart::MacosLauncher;

fn read_app_settings(data_dir: &std::path::Path) -> (bool, bool) {
    let settings_path = data_dir.join(".memory").join("app-settings.json");
    if let Ok(raw) = std::fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            let keep_alive = json.get("keepAlive").and_then(|v| v.as_bool()).unwrap_or(false);
            let run_on_start = json.get("runOnStart").and_then(|v| v.as_bool()).unwrap_or(false);
            return (keep_alive, run_on_start);
        }
    }
    (false, false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::AppleScript, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            tray::build_tray(app.handle())?;

            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::temp_dir().join("qube-data")
            });
            let (_keep_alive, run_on_start) = read_app_settings(&data_dir);
            commands::set_autostart(app.handle().clone(), run_on_start).ok();

            if let Some(dist_dir) = find_dist_dir(app.handle()) {
                // Check if a previous sidecar is already running (keepAlive)
                let preferred_port: u16 = 3010;
                if is_server_running(preferred_port) {
                    let state = app.state::<AppState>();
                    state.set_port(preferred_port);
                    let url = format!("http://127.0.0.1:{}", preferred_port);
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(parsed) = url::Url::parse(&url) {
                            let _ = window.navigate(parsed);
                        }
                    }
                    return Ok(());
                }

                match sidecar::Sidecar::start(&dist_dir, &data_dir) {
                    Ok(s) => {
                        let state = app.state::<AppState>();
                        state.set_port(s.port);
                        state.set_child(s.child.unwrap());
                        let url = format!("http://127.0.0.1:{}", s.port);
                        if let Some(window) = app.get_webview_window("main") {
                            if let Ok(parsed) = url::Url::parse(&url) {
                                let _ = window.navigate(parsed);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to start Next.js sidecar: {e}");
                        show_startup_error(
                            app.handle(),
                            "Qube failed to start the local server",
                            &e,
                            &data_dir,
                        );
                    }
                }
            } else {
                let candidates = dist_candidates(app.handle());
                let details = format!(
                    "App resources were found but sidecar-dist/server.js was not under any of:\n{}\nThis usually means an incomplete install — reinstall Qube.",
                    candidates
                        .iter()
                        .map(|p| format!("- {}", p.display()))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                eprintln!("sidecar-dist not found");
                show_startup_error(
                    app.handle(),
                    "Qube installation is incomplete",
                    &details,
                    &data_dir,
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                let data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
                    std::env::temp_dir().join("qube-data")
                });
                let (keep_alive, _) = read_app_settings(&data_dir);
                if !keep_alive {
                    let state = app_handle.state::<AppState>();
                    state.kill_child();
                    app_handle.exit(0);
                } else {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![commands::get_port, commands::set_autostart])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            state.kill_child();
        }
    });
}

