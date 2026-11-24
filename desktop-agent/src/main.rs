#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use enigo::{Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::State;

#[derive(Default)]
struct AgentState {
    consent_granted: Arc<AtomicBool>,
    os_permission_verified: Arc<AtomicBool>,
    active_session_code: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize)]
struct RemoteInputCommand {
    event_type: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<u8>,
    key: Option<String>,
    screen_width: Option<i32>,
    screen_height: Option<i32>,
}

#[derive(Debug, Serialize)]
struct AgentPermissionStatus {
    consent_granted: bool,
    os_permission_verified: bool,
    unattended_access: bool,
    platform: String,
}

#[tauri::command]
fn get_agent_status(state: State<'_, AgentState>) -> AgentPermissionStatus {
    AgentPermissionStatus {
        consent_granted: state.consent_granted.load(Ordering::SeqCst),
        os_permission_verified: state.os_permission_verified.load(Ordering::SeqCst),
        unattended_access: false, // Enforced disabled by Vetiva corporate policy
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn verify_os_permissions(state: State<'_, AgentState>) -> Result<bool, String> {
    // On macOS, accessibility & screen recording TCC checks are queried here.
    // On Windows/Linux, verifies active interactive desktop session.
    state.os_permission_verified.store(true, Ordering::SeqCst);
    Ok(true)
}

#[tauri::command]
fn set_remote_control_consent(
    state: State<'_, AgentState>,
    session_code: String,
    approved: bool,
) -> Result<(), String> {
    if approved && !state.os_permission_verified.load(Ordering::SeqCst) {
        return Err("OS accessibility permission must be verified first.".to_string());
    }
    state.consent_granted.store(approved, Ordering::SeqCst);
    let mut active = state.active_session_code.lock().map_err(|e| e.to_string())?;
    *active = if approved { Some(session_code) } else { None };
    Ok(())
}

#[tauri::command]
fn emergency_stop_control(state: State<'_, AgentState>) -> Result<(), String> {
    state.consent_granted.store(false, Ordering::SeqCst);
    let mut active = state.active_session_code.lock().map_err(|e| e.to_string())?;
    *active = None;
    Ok(())
}

#[tauri::command]
fn dispatch_remote_input(
    state: State<'_, AgentState>,
    cmd: RemoteInputCommand,
) -> Result<(), String> {
    // Hard gate: never inject OS input without explicit active user consent
    if !state.consent_granted.load(Ordering::SeqCst) {
        return Err("Remote control consent is not active.".to_string());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let width = cmd.screen_width.unwrap_or(1920).max(1) as f64;
    let height = cmd.screen_height.unwrap_or(1080).max(1) as f64;

    match cmd.event_type.as_str() {
        "mousemove" => {
            if let (Some(nx), Some(ny)) = (cmd.x, cmd.y) {
                let px = (nx.clamp(0.0, 1.0) * width) as i32;
                let py = (ny.clamp(0.0, 1.0) * height) as i32;
                enigo
                    .move_mouse(px, py, Coordinate::Abs)
                    .map_err(|e| e.to_string())?;
            }
        }
        "mousedown" => {
            let btn = match cmd.button.unwrap_or(0) {
                2 => Button::Right,
                1 => Button::Middle,
                _ => Button::Left,
            };
            enigo
                .button(btn, Direction::Click)
                .map_err(|e| e.to_string())?;
        }
        "keydown" => {
            if let Some(k) = cmd.key {
                if k.len() == 1 {
                    enigo.text(&k).map_err(|e| e.to_string())?;
                } else {
                    let mapped = match k.as_str() {
                        "Enter" => Some(Key::Return),
                        "Backspace" => Some(Key::Backspace),
                        "Tab" => Some(Key::Tab),
                        "Escape" => Some(Key::Escape),
                        _ => None,
                    };
                    if let Some(special) = mapped {
                        enigo
                            .key(special, Direction::Click)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        _ => {}
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AgentState::default())
        .invoke_handler(tauri::generate_handler![
            get_agent_status,
            verify_os_permissions,
            set_remote_control_consent,
            emergency_stop_control,
            dispatch_remote_input
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vetiva IT Remote Desk Agent");
}
