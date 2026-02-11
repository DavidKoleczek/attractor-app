mod amplifier;
mod commands;
mod error;
mod github;
mod models;
mod state;
mod storage;

use amplifier::AmplifierManager;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let repos_dir = dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".attractor")
        .join("repos");
    std::fs::create_dir_all(&repos_dir).expect("Could not create repos directory");

    let app_state = AppState::new(repos_dir);
    let amplifier_manager = AmplifierManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .manage(amplifier_manager)
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::set_token,
            commands::get_token,
            commands::validate_token,
            // Projects (legacy)
            commands::list_projects,
            commands::create_project,
            commands::select_project,
            // Projects (new model)
            commands::list_recent_projects,
            commands::remove_recent_project,
            commands::create_local_project,
            commands::create_github_project,
            commands::open_local_project,
            commands::open_github_project,
            commands::setup_backing_repo,
            // Issues
            commands::list_issues,
            commands::create_issue,
            commands::get_issue,
            commands::update_issue,
            commands::lock_issue,
            commands::unlock_issue,
            // Comments
            commands::list_comments,
            commands::create_comment,
            commands::get_comment,
            commands::update_comment,
            commands::delete_comment,
            // Labels
            commands::list_labels,
            commands::create_label,
            commands::get_label,
            commands::update_label,
            commands::delete_label,
            commands::list_issue_labels,
            commands::add_issue_labels,
            commands::set_issue_labels,
            commands::remove_all_issue_labels,
            commands::remove_issue_label,
            // Milestones
            commands::list_milestones,
            commands::create_milestone,
            commands::get_milestone,
            commands::update_milestone,
            commands::delete_milestone,
            // Amplifier
            commands::amplifier_run,
            commands::amplifier_status,
            commands::amplifier_cancel,
            // Shell openers
            commands::open_in_explorer,
            commands::open_in_vscode,
        ])
        .setup(|app| {
            // Restore persisted token on startup
            use tauri::Manager;
            use tauri_plugin_store::StoreExt;

            if let Ok(store) = app.store("settings.json") {
                if let Some(token_value) = store.get("token") {
                    if let Some(token_str) = token_value.as_str() {
                        let token_string = token_str.to_string();
                        let state = app.state::<AppState>();
                        let mut guard = state.token.write().expect("token lock poisoned");
                        *guard = Some(token_string);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
