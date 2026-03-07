use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tantivy::schema::*;
use tantivy::{Index, IndexReader, IndexWriter};

// ---------------------------------------------------------------------------
// Schema fields wrapper
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SessionSchema {
    pub message_id: Field,
    pub session_id: Field,
    pub content: Field,
    pub role: Field,
    pub project: Field,
    pub host: Field,
    pub timestamp: Field,
    pub git_branch: Field,
    pub tools_used: Field,
    pub files_modified: Field,
    pub schema: Schema,
}

// ---------------------------------------------------------------------------
// Index state -- tracks which files have been indexed and their mtimes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
pub struct IndexState {
    /// Map of JSONL file path -> last-modified epoch seconds
    pub file_mtimes: HashMap<String, u64>,
}

// ---------------------------------------------------------------------------
// SessionIndex -- main struct that owns the tantivy index
// ---------------------------------------------------------------------------

pub struct SessionIndex {
    pub index: Index,
    pub fields: SessionSchema,
    pub writer: Arc<Mutex<IndexWriter>>,
    pub reader: IndexReader,
    pub index_dir: PathBuf,
    pub state: Mutex<IndexState>,
}

impl SessionIndex {
    /// Open an existing index or create a new one at the given directory.
    pub fn open_or_create(index_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(index_dir)
            .map_err(|e| format!("Failed to create index dir: {e}"))?;

        let (schema, fields) = Self::build_schema();

        let dir = tantivy::directory::MmapDirectory::open(index_dir)
            .map_err(|e| format!("Failed to open MmapDirectory: {e}"))?;

        let index = Index::open_or_create(dir, schema)
            .map_err(|e| format!("Failed to open or create index: {e}"))?;

        let writer: IndexWriter = index
            .writer(50_000_000)
            .map_err(|e| format!("Failed to create IndexWriter: {e}"))?;

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| format!("Failed to create IndexReader: {e}"))?;

        let state = Self::load_state(index_dir);

        Ok(Self {
            index,
            fields,
            writer: Arc::new(Mutex::new(writer)),
            reader,
            index_dir: index_dir.to_path_buf(),
            state: Mutex::new(state),
        })
    }

    /// Build the tantivy schema with all 10 fields.
    fn build_schema() -> (Schema, SessionSchema) {
        let mut builder = Schema::builder();

        // STRING | STORED fields (untokenized, exact-match, stored)
        let message_id = builder.add_text_field("message_id", STRING | STORED);
        let session_id = builder.add_text_field("session_id", STRING | STORED);
        let role = builder.add_text_field("role", STRING | STORED);
        let git_branch = builder.add_text_field("git_branch", STRING | STORED);

        // TEXT | STORED fields (tokenized, full-text searchable, stored)
        let content = builder.add_text_field("content", TEXT | STORED);
        let tools_used = builder.add_text_field("tools_used", TEXT | STORED);
        let files_modified = builder.add_text_field("files_modified", TEXT | STORED);

        // Facet fields (hierarchical)
        let project = builder.add_facet_field("project", FacetOptions::default());
        let host = builder.add_facet_field("host", FacetOptions::default());

        // Date field (indexed, stored, fast)
        let date_opts = DateOptions::from(INDEXED)
            .set_stored()
            .set_fast()
            .set_precision(DateTimePrecision::Seconds);
        let timestamp = builder.add_date_field("timestamp", date_opts);

        let schema = builder.build();

        let fields = SessionSchema {
            message_id,
            session_id,
            content,
            role,
            project,
            host,
            timestamp,
            git_branch,
            tools_used,
            files_modified,
            schema: schema.clone(),
        };

        (schema, fields)
    }

    /// Load persisted index state from disk (file mtimes tracking).
    fn load_state(index_dir: &Path) -> IndexState {
        let state_path = index_dir.join("index_state.json");
        if state_path.exists() {
            match std::fs::read_to_string(&state_path) {
                Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
                Err(_) => IndexState::default(),
            }
        } else {
            IndexState::default()
        }
    }

    /// Save the current index state to disk.
    pub fn save_state(&self) -> Result<(), String> {
        let state_path = self.index_dir.join("index_state.json");
        let state = self.state.lock();
        let json =
            serde_json::to_string_pretty(&*state).map_err(|e| format!("Serialize state: {e}"))?;
        std::fs::write(&state_path, json).map_err(|e| format!("Write state: {e}"))?;
        Ok(())
    }

    /// Get a fresh Searcher from the reader pool.
    pub fn searcher(&self) -> tantivy::Searcher {
        self.reader.searcher()
    }
}
