use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri::State;

use crate::sidecar;

pub struct AppState {
    pub sidecar_port: Mutex<Option<u16>>,
    pub sidecar_child: Mutex<Option<Child>>,
    pub sidecar_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            sidecar_port: Mutex::new(None),
            sidecar_child: Mutex::new(None),
            sidecar_dir: Mutex::new(None),
        }
    }

    pub fn set_port(&self, port: u16) {
        if let Ok(mut p) = self.sidecar_port.lock() {
            *p = Some(port);
        }
    }

    pub fn port(&self) -> Option<u16> {
        self.sidecar_port.lock().ok().and_then(|p| *p)
    }

    pub fn set_child(&self, child: Child) {
        if let Ok(mut c) = self.sidecar_child.lock() {
            *c = Some(child);
        }
    }

    pub fn set_dir(&self, dir: PathBuf) {
        if let Ok(mut d) = self.sidecar_dir.lock() {
            *d = Some(dir);
        }
    }

    pub fn take_dir(&self) -> Option<PathBuf> {
        self.sidecar_dir.lock().ok().and_then(|mut d| d.take())
    }

    pub fn kill_child(&self) {
        if let Ok(mut c) = self.sidecar_child.lock() {
            if let Some(ref mut child) = *c {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn get_port(state: State<AppState>) -> Option<u16> {
    state.sidecar_port.lock().ok().and_then(|p| *p)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if enable {
        let _ = autostart.enable();
    } else {
        let _ = autostart.disable();
    }
    Ok(())
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
    let Some(dist_dir) = crate::find_dist_dir(app) else {
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
        while crate::is_server_running(port) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    if let Some(path) = state.take_dir() {
        dirs.push(path);
    }

    for path in crate::unique_paths(dirs) {
        crate::remove_path_with_retries(&path)?;
    }
    crate::remove_sidecar_temp_dirs();

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
            crate::show_startup_error(
                app,
                "Qube could not restart after the hard reset",
                &error,
                &data_dir,
            );
            Err(error)
        }
    }
}
