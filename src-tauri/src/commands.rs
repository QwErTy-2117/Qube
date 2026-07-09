use std::process::Child;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sidecar_port: Mutex<Option<u16>>,
    pub sidecar_child: Mutex<Option<Child>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            sidecar_port: Mutex::new(None),
            sidecar_child: Mutex::new(None),
        }
    }

    pub fn set_port(&self, port: u16) {
        if let Ok(mut p) = self.sidecar_port.lock() {
            *p = Some(port);
        }
    }

    pub fn set_child(&self, child: Child) {
        if let Ok(mut c) = self.sidecar_child.lock() {
            *c = Some(child);
        }
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
