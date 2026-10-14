//! Rust owns pending storage operations; the browser retains only their buffers.
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SaveOperation {
    Init,
    Load,
    Import,
    Write,
}

impl SaveOperation {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::Load => "load",
            Self::Import => "import",
            Self::Write => "save-write",
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct PendingSave {
    pub(crate) request: u64,
    pub(crate) generation: u64,
    pub(crate) operation: SaveOperation,
}

#[derive(Default)]
pub(crate) struct SaveOperations {
    next_request: u64,
    pending: BTreeMap<u64, PendingSave>,
}

impl SaveOperations {
    pub(crate) fn begin(&mut self, operation: SaveOperation, generation: u64) -> PendingSave {
        self.next_request += 1;
        let pending = PendingSave {
            request: self.next_request,
            generation,
            operation,
        };
        self.pending.insert(pending.request, pending);
        pending
    }

    pub(crate) fn finish(&mut self, response: &Value, generation: u64) -> Option<PendingSave> {
        let request = response["request"].as_u64()?;
        let pending = *self.pending.get(&request)?;
        if pending.generation != generation
            || response["generation"].as_u64() != Some(pending.generation)
            || response["operation"].as_str() != Some(pending.operation.name())
        {
            return None;
        }
        self.pending.remove(&request);
        Some(pending)
    }

    pub(crate) fn retire(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.pending).into_keys().collect()
    }
}
