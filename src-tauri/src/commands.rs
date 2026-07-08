use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sidecar_port: Mutex<Option<u16>>,
}

#[tauri::command]
pub fn get_port(state: State<AppState>) -> Option<u16> {
    state.sidecar_port.lock().ok().and_then(|p| *p)
}
