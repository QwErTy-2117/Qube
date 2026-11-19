use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use tauri::State;

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
