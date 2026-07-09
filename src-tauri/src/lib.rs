mod commands;
mod sidecar;
mod tray;

use commands::AppState;
use std::path::PathBuf;
use tauri::Manager;

fn find_dist_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    // Check paths from most to least likely
    let candidates: Vec<PathBuf> = {
        let mut v = Vec::new();
        // Bundled resource dir (Tauri v2 bundles resources under _up_/ subdirectory)
        if let Ok(dir) = app.path().resource_dir() {
            v.push(dir.join("_up_").join("sidecar-dist"));
            v.push(dir.join("sidecar-dist"));
        }
        // Next to the binary (for local testing)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .setup(|app| {
            tray::build_tray(app.handle())?;
            if let Some(dist_dir) = find_dist_dir(app.handle()) {
                match sidecar::Sidecar::start(&dist_dir) {
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
