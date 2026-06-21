use tauri::Manager;

const ALLOWED_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match ext {
        Some(ext) if ALLOWED_EXTENSIONS.contains(&ext.as_str()) => {
            std::fs::read_to_string(&path).map_err(|e| e.to_string())
        }
        _ => Err("Unsupported file type".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_title("mdcrud").unwrap();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
