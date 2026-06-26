use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
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

/// Write content back to a Markdown file (Update). Guards the extension so the
/// app never writes to unexpected file types.
#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Move a Markdown file to the OS trash (the Delete of CRUD) and drop it from
/// the recent-files list. Uses the trash, not an unrecoverable delete, so a
/// misclick is recoverable from the system's Trash/Recycle Bin.
#[tauri::command]
fn delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    trash::delete(&path).map_err(|e| e.to_string())?;
    if let Some(store) = recent_store(&app) {
        let list: Vec<String> = get_recent_files(app.clone())
            .into_iter()
            .filter(|p| p != &path)
            .collect();
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = std::fs::write(store, json);
        }
    }
    Ok(())
}

/// Last-modified time of a file in milliseconds, used by the frontend to poll
/// for external edits and auto-reload.
#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|e| e.to_string())
}

const MAX_RECENT: usize = 10;

fn recent_store(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("recent.json"))
}

/// Most-recently-opened file paths, newest first.
#[tauri::command]
fn get_recent_files(app: tauri::AppHandle) -> Vec<String> {
    recent_store(&app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// Move `path` to the front of the recent list, deduped and capped at `max`.
/// Pure (no I/O) so it can be unit-tested.
fn compute_recent(mut list: Vec<String>, path: String, max: usize) -> Vec<String> {
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(max);
    list
}

/// Record an opened file at the front of the recent list (deduped, capped).
#[tauri::command]
fn add_recent_file(app: tauri::AppHandle, path: String) -> Vec<String> {
    let list = compute_recent(get_recent_files(app.clone()), path, MAX_RECENT);
    if let Some(store) = recent_store(&app) {
        if let Some(dir) = store.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = std::fs::write(store, json);
        }
    }
    list
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

/// Build the native menu in the given language ("ja" or anything else = en).
/// Custom items carry stable ids that the frontend maps back to actions; the
/// About item shows the compiled crate version so it can never go stale.
fn build_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let ja = lang == "ja";
    let pick = |j: &'static str, e: &'static str| -> &'static str { if ja { j } else { e } };
    let sep = || PredefinedMenuItem::separator(app);

    let about_meta = AboutMetadata {
        name: Some("mdcrud".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "mdcrud",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(pick("mdcrud について", "About mdcrud")), Some(about_meta))?,
            &sep()?,
            &MenuItem::with_id(app, "settings", pick("設定…", "Settings…"), true, Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some(pick("mdcrud を隠す", "Hide mdcrud")))?,
            &PredefinedMenuItem::hide_others(app, Some(pick("ほかを隠す", "Hide Others")))?,
            &PredefinedMenuItem::show_all(app, Some(pick("すべてを表示", "Show All")))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some(pick("mdcrud を終了", "Quit mdcrud")))?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        pick("ファイル", "File"),
        true,
        &[
            &MenuItem::with_id(app, "new", pick("新規", "New"), true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", pick("開く…", "Open…"), true, Some("CmdOrCtrl+O"))?,
            &sep()?,
            &MenuItem::with_id(app, "save", pick("保存", "Save"), true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "reload", pick("再読み込み", "Reload"), true, Some("CmdOrCtrl+R"))?,
            &sep()?,
            // No accelerator: ⌘⌫ stays the editor's "delete to line start".
            &MenuItem::with_id(app, "delete", pick("ゴミ箱に移動", "Move to Trash"), true, None::<&str>)?,
            &MenuItem::with_id(app, "close", pick("閉じる", "Close"), true, Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        pick("編集", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(pick("取り消す", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(pick("やり直す", "Redo")))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(pick("カット", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(pick("コピー", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(pick("ペースト", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(pick("すべてを選択", "Select All")))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        pick("表示", "View"),
        true,
        &[
            &MenuItem::with_id(app, "sidebar", pick("サイドバー", "Sidebar"), true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "edit", pick("編集 / プレビュー", "Edit / Preview"), true, Some("CmdOrCtrl+E"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        pick("ウインドウ", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(pick("しまう", "Minimize")))?,
            &PredefinedMenuItem::maximize(app, Some(pick("拡大／縮小", "Zoom")))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}

/// Rebuild and apply the menu in the requested language (called by the frontend
/// on startup and whenever the in-app language changes).
#[tauri::command]
fn apply_menu(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let menu = build_menu(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFile::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            delete_file,
            file_mtime,
            get_recent_files,
            add_recent_file,
            get_pending_file,
            apply_menu
        ])
        .on_menu_event(|app, event| {
            // Forward our custom item ids to the frontend, which maps them to
            // actions. Predefined items (undo/copy/…) are handled natively.
            let _ = app.emit("menu", event.id().as_ref());
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_title("mdcrud").unwrap();

                // Initial menu; the frontend re-applies it in its resolved
                // language (OS locale or the saved override) right after load.
                if let Ok(menu) = build_menu(&app.handle(), "ja") {
                    let _ = app.set_menu(menu);
                }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_extensions_are_case_insensitive() {
        assert!(is_supported("a.md"));
        assert!(is_supported("A.MARKDOWN"));
        assert!(is_supported("notes.txt"));
        assert!(!is_supported("image.png"));
        assert!(!is_supported("Makefile"));
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn recent_moves_existing_entry_to_front_without_duplicating() {
        let list = compute_recent(v(&["a", "b", "c"]), "c".into(), 10);
        assert_eq!(list, v(&["c", "a", "b"]));
    }

    #[test]
    fn recent_prepends_new_entry() {
        let list = compute_recent(v(&["a", "b"]), "z".into(), 10);
        assert_eq!(list, v(&["z", "a", "b"]));
    }

    #[test]
    fn recent_is_capped_at_max() {
        let list = compute_recent(v(&["a", "b", "c"]), "z".into(), 2);
        assert_eq!(list, v(&["z", "a"]));
    }

    #[test]
    fn save_file_writes_supported_and_rejects_others() {
        let path = std::env::temp_dir().join("mdcrud_save_test.md");
        let path_str = path.to_str().unwrap().to_string();

        save_file(path_str.clone(), "# hello".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# hello");
        let _ = std::fs::remove_file(&path);

        assert!(save_file("/tmp/x.png".to_string(), "data".to_string()).is_err());
    }
}
