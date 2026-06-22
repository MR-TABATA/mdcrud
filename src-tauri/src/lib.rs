use std::sync::Mutex;

use tauri::{Emitter, Manager};

const ALLOWED_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

/// Path of a file the app was asked to open (via double-click / "Open With"),
/// held until the frontend is ready to pick it up on startup.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

fn is_supported(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Called by the frontend on startup to retrieve the file the app was launched
/// with (if any), covering both the CLI-argument and macOS "Opened" cases.
#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Remember an opened file and notify a running frontend.
fn handle_opened_file(app: &tauri::AppHandle, path: String) {
    if !is_supported(&path) {
        return;
    }
    if let Some(state) = app.try_state::<PendingFile>() {
        *state.0.lock().unwrap() = Some(path.clone());
    }
    // If the frontend is already listening, render it immediately.
    let _ = app.emit("open-file", path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile::default())
        .invoke_handler(tauri::generate_handler![read_file, get_pending_file])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_title("mdcrud").unwrap();

                // Windows / Linux pass the file path as a launch argument.
                #[cfg(not(target_os = "macos"))]
                if let Some(path) = std::env::args().skip(1).find(|a| is_supported(a)) {
                    if let Some(state) = app.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path);
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // macOS delivers double-click / "Open With" as an Apple event.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path) = path.to_str() {
                            handle_opened_file(_app, path.to_string());
                        }
                    }
                }
            }
        });
}
