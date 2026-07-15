mod commands;
mod sidecar;
mod tray;

use commands::AppState;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::Manager;

mod commands;
mod sidecar;
mod tray;

use commands::AppState;

fn find_dist_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let candidates: Vec<PathBuf> = {
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
    };
    for p in &candidates {
        if p.join("server.js").exists() {
            return Some(p.clone());
        }
    }
    None
}

fn is_server_running(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn read_keep_alive(data_dir: &std::path::Path) -> bool {
    let settings_path = data_dir.join(".memory").join("app-settings.json");
    if let Ok(raw) = std::fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            return json.get("keepAlive").and_then(|v| v.as_bool()).unwrap_or(false);
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .setup(|app| {
            tray::build_tray(app.handle())?;
            if let Some(dist_dir) = find_dist_dir(app.handle()) {
                let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                    std::env::temp_dir().join("qube-data")
                });

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
                        eprintln!("Failed to start Next.js sidecar: {}", e);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                let data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
                    std::env::temp_dir().join("qube-data")
                });
                let keep_alive = read_keep_alive(&data_dir);
                if !keep_alive {
                    let state = app_handle.state::<AppState>();
                    state.kill_child();
                }
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![commands::get_port])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            state.kill_child();
        }
    });
}
