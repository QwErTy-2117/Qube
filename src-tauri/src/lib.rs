mod commands;
mod sidecar;
mod tray;

use commands::AppState;
use std::path::{Path, PathBuf};
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
fn show_startup_error(
    app: &tauri::AppHandle,
    title: &str,
    details: &str,
    data_dir: &std::path::Path,
) {
    let _ = std::fs::create_dir_all(data_dir);
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
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

/// Bring the existing Qube window back to the foreground (used when an
/// OAuth callback deep-links back into the app from the browser).
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

use tauri_plugin_autostart::MacosLauncher;

fn remove_path_with_retries(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut last_error = String::new();
    for attempt in 0..6u64 {
        let result = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        match result {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error.to_string(),
        }
        if !path.exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150 * (attempt + 1)));
    }
    Err(format!(
        "Could not delete {}: {}",
        path.display(),
        last_error
    ))
}

fn remove_sidecar_temp_dirs() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "qube-sidecar" || name.starts_with("qube-sidecar-") {
            let _ = remove_path_with_retries(&entry.path());
        }
    }
}

fn unique_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for path in paths {
        if !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

/// Finish a hard reset in the desktop shell.
///
/// The server-side reset removes Qube's own files while the sidecar is still
/// running. This command then clears native webview storage, stops the
/// sidecar, deletes the app data/cache/config directories and the writable
/// sidecar copy, starts a fresh sidecar, and navigates to it. Returns `false`
/// for dev builds (no bundled sidecar); the frontend reloads in that case.
#[tauri::command]
pub async fn finalize_hard_reset(app: tauri::AppHandle) -> Result<bool, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || finalize_hard_reset_sync(&handle))
        .await
        .map_err(|error| format!("Hard reset task failed: {error}"))?
}

fn finalize_hard_reset_sync(app: &tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    let _ = app.autolaunch().disable();

    // Clear cookies/local storage/cache in the running webview before deleting
    // directories it may be using. This also covers WebKit/WebView2 data that
    // lives outside the Qube data dir.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.clear_all_browsing_data();
    }
    std::thread::sleep(Duration::from_millis(300));

    // Dev builds have no bundled sidecar; the web server is managed by npm.
    // Browser storage and autostart are already cleared, so let the frontend
    // reload into the freshly reset server.
    let Some(dist_dir) = find_dist_dir(app) else {
        return Ok(false);
    };

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
    let app_version = app.package_info().version.to_string();

    let mut dirs = vec![data_dir.clone()];
    if let Ok(path) = app.path().app_cache_dir() {
        dirs.push(path);
    }
    if let Ok(path) = app.path().app_config_dir() {
        dirs.push(path);
    }
    if let Ok(path) = app.path().app_local_data_dir() {
        dirs.push(path);
    }
    if let Ok(path) = app.path().app_log_dir() {
        dirs.push(path);
    }

    let state = app.state::<AppState>();
    state.kill_child();
    // The server exits itself after a successful desktop reset. Wait for the
    // port to close before deleting its files, so a reused keep-alive sidecar
    // (which has no Child handle) cannot keep writing into a deleted tree.
    if let Some(port) = state.port() {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while is_server_running(port) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    if let Some(path) = state.take_dir() {
        dirs.push(path);
    }

    for path in unique_paths(dirs) {
        remove_path_with_retries(&path)?;
    }
    remove_sidecar_temp_dirs();

    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not recreate {}: {}", data_dir.display(), error))?;

    match sidecar::Sidecar::start(&dist_dir, &data_dir, &app_version) {
        Ok(started) => {
            state.set_port(started.port);
            state.set_dir(started.app_dir.clone());
            if let Some(child) = started.child {
                state.set_child(child);
            }
            let url = format!("http://127.0.0.1:{}", started.port);
            let parsed = url::Url::parse(&url)
                .map_err(|error| format!("Could not parse sidecar URL {url}: {error}"))?;
            if let Some(window) = app.get_webview_window("main") {
                window
                    .navigate(parsed)
                    .map_err(|error| format!("Could not navigate to the fresh sidecar: {error}"))?;
            }
            Ok(true)
        }
        Err(error) => {
            show_startup_error(
                app,
                "Qube could not restart after the hard reset",
                &error,
                &data_dir,
            );
            Err(error)
        }
    }
}

fn read_app_settings(data_dir: &std::path::Path) -> (bool, bool) {
    let settings_path = data_dir.join(".memory").join("app-settings.json");
    if let Ok(raw) = std::fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            let keep_alive = json
                .get("keepAlive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let run_on_start = json
                .get("runOnStart")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            return (keep_alive, run_on_start);
        }
    }
    (false, false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: when a `qube://` link (OAuth callback) opens
    // while Qube is already running, the second process hands the URL to the
    // existing instance and exits instead of spawning a duplicate app.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        // Safety net: never navigate the app webview to an external site.
        // External http(s) links (and mailto:/tel:) are opened in the system
        // browser instead — the frontend ExternalLinkHandler covers clicks,
        // this covers anything that slips through (window.open, redirects,
        // context-menu / drag navigation).
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("external-links")
                .on_navigation(|_webview, url| {
                    let scheme = url.scheme();
                    // App-internal schemes always stay inside the webview.
                    if matches!(scheme, "tauri" | "file" | "data" | "blob") {
                        return true;
                    }
                    if scheme == "http" || scheme == "https" {
                        if let Some(host) = url.host_str() {
                            // Local sidecar (dev + production) stays inside.
                            if host == "localhost"
                                || host == "127.0.0.1"
                                || host == "[::1]"
                                || host.ends_with(".localhost")
                            {
                                return true;
                            }
                            // Tauri's own hosts stay inside.
                            if host == "tauri.localhost" {
                                return true;
                            }
                        }
                        // External web link → system browser.
                        #[allow(deprecated)]
                        let _ = tauri_plugin_shell::open::open(None, url.as_str(), None);
                        return false;
                    }
                    if matches!(scheme, "mailto" | "tel") {
                        #[allow(deprecated)]
                        let _ = tauri_plugin_shell::open::open(None, url.as_str(), None);
                        return false;
                    }
                    true
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::AppleScript, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            tray::build_tray(app.handle())?;

            // OAuth callbacks return to the browser's /connectors/callback
            // page, which immediately opens `qube://connectors/callback`.
            // Register the scheme (dev/Linux/Windows) and focus the app when
            // the link arrives, so users land back in Qube instead of a
            // browser copy of the interface.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                {
                    let _ = app.deep_link().register_all();
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if event.urls().iter().any(|url| url.scheme() == "qube") {
                        focus_main(&handle);
                    }
                });
                if matches!(app.deep_link().get_current(), Ok(Some(urls)) if !urls.is_empty()) {
                    focus_main(app.handle());
                }
            }

            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::temp_dir().join("qube-data")
            });
            let (_keep_alive, run_on_start) = read_app_settings(&data_dir);
            commands::set_autostart(app.handle().clone(), run_on_start).ok();

            if let Some(dist_dir) = find_dist_dir(app.handle()) {
                let app_version = app.package_info().version.to_string();
                // Reuse an already-running sidecar (keepAlive) only when it
                // belongs to this exact build. A leftover server from an older
                // release would otherwise serve the previous UI under the new
                // binary: Settings keeps showing the old version while the
                // updater — which reads the binary version — correctly says
                // "up to date", which looks like a broken updater.
                let preferred_port: u16 = 3010;
                if is_server_running(preferred_port) {
                    let running = sidecar::running_version(preferred_port);
                    if running.as_deref() == Some(app_version.as_str()) {
                        let state = app.state::<AppState>();
                        state.set_port(preferred_port);
                        state.set_dir(sidecar::sidecar_base_dir());
                        let url = format!("http://127.0.0.1:{}", preferred_port);
                        if let Some(window) = app.get_webview_window("main") {
                            if let Ok(parsed) = url::Url::parse(&url) {
                                let _ = window.navigate(parsed);
                            }
                        }
                        return Ok(());
                    }
                    eprintln!(
                        "Ignoring sidecar on port {preferred_port} (version {:?}, app is {app_version}); starting a fresh one",
                        running
                    );
                }

                match sidecar::Sidecar::start(&dist_dir, &data_dir, &app_version) {
                    Ok(s) => {
                        let state = app.state::<AppState>();
                        state.set_port(s.port);
                        state.set_dir(s.app_dir.clone());
                        if let Some(child) = s.child {
                            state.set_child(child);
                        }
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
        .invoke_handler(tauri::generate_handler![
            commands::get_port,
            commands::set_autostart,
            finalize_hard_reset
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            state.kill_child();
        }
    });
}
