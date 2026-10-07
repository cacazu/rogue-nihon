//! Versioned, validated browser storage. C state and input replay are distinct.
use serde::{Deserialize, Serialize};

pub const SOURCE_HASH: &str = "7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1";
pub const MAX_CHECKPOINT: usize = 4 * 1024 * 1024;
pub const MAX_INPUTS: usize = 65_536;
pub const MAX_ENVELOPE: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub format: String,
    pub version: u32,
    pub abi: u32,
    pub source: String,
    pub seed: u32,
    pub name: String,
    pub checkpoint_hex: String,
    pub inputs: Vec<i32>,
    pub input_index: u32,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub presentation: serde_json::Value,
    pub checksum: u32,
}

/// Narration policy separates recorded acknowledgements from future input.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum MessagePaging {
    #[default]
    Legacy,
    Log,
    ReplayLegacyUntil(u32),
}
impl MessagePaging {
    pub fn from_saved(presentation: &serde_json::Value) -> Self {
        if presentation["input"]["message_paging"] == "log" {
            presentation["input"]["message_paging_legacy_until"]
                .as_u64()
                .and_then(|index| u32::try_from(index).ok())
                .map_or(Self::Log, Self::ReplayLegacyUntil)
        } else {
            Self::Legacy
        }
    }
    pub fn mark(self, presentation: &mut serde_json::Value) {
        if self != Self::Legacy {
            if presentation["input"].is_null() {
                presentation["input"] = serde_json::json!({});
            }
            presentation["input"]["message_paging"] = serde_json::json!("log");
            if let Self::ReplayLegacyUntil(index) = self {
                presentation["input"]["message_paging_legacy_until"] = serde_json::json!(index);
            }
        }
    }
    pub fn requires_acknowledgement(self, input_index: u32) -> bool {
        match self {
            Self::Legacy => true,
            Self::Log => false,
            Self::ReplayLegacyUntil(index) => input_index < index,
        }
    }
    pub fn at_checkpoint(self, input_index: u32) -> Self {
        if matches!(self, Self::ReplayLegacyUntil(index) if input_index >= index) {
            Self::Log
        } else {
            self
        }
    }
    pub fn remove_marker(presentation: &mut serde_json::Value) {
        let Some(input) = presentation
            .get_mut("input")
            .and_then(serde_json::Value::as_object_mut)
        else {
            return;
        };
        let marked = input.remove("message_paging").is_some();
        input.remove("message_paging_legacy_until");
        if marked && input.is_empty() {
            presentation["input"] = serde_json::Value::Null;
        }
    }
}

impl Envelope {
    #[allow(dead_code)] // Version 1 compatibility is checked independently.
    pub fn new(
        seed: u32,
        name: String,
        checkpoint: &[u8],
        inputs: Vec<i32>,
        input_index: u32,
    ) -> Result<Self, String> {
        Self::new_with_presentation(
            seed,
            name,
            checkpoint,
            inputs,
            input_index,
            serde_json::Value::Null,
        )
    }

    pub fn new_with_presentation(
        seed: u32,
        name: String,
        checkpoint: &[u8],
        inputs: Vec<i32>,
        input_index: u32,
        presentation: serde_json::Value,
    ) -> Result<Self, String> {
        if checkpoint.is_empty() || checkpoint.len() > MAX_CHECKPOINT {
            return Err("invalid checkpoint size".into());
        }
        let mut value = Self {
            format: "rogue-four-layer".into(),
            version: if presentation.is_null() { 1 } else { 2 },
            abi: crate::abi::RG_ABI_VERSION,
            source: SOURCE_HASH.into(),
            seed,
            name,
            checkpoint_hex: hex_encode(checkpoint),
            inputs,
            input_index,
            presentation,
            checksum: 0,
        };
        value.checksum = value.digest();
        value.validate()?;
        Ok(value)
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_ENVELOPE {
            return Err("save envelope exceeds size limit".into());
        }
        let value: Self =
            serde_json::from_slice(bytes).map_err(|error| format!("invalid save JSON: {error}"))?;
        value.validate()?;
        Ok(value)
    }

    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|error| format!("save encoding failed: {error}"))
    }

    pub fn checkpoint(&self) -> Result<Vec<u8>, String> {
        hex_decode(&self.checkpoint_hex)
    }

    fn validate(&self) -> Result<(), String> {
        if self.format != "rogue-four-layer"
            || !(1..=2).contains(&self.version)
            || self.abi != crate::abi::RG_ABI_VERSION
            || self.source != SOURCE_HASH
        {
            return Err("incompatible save format, source or ABI".into());
        }
        if self.name.len() > if self.version == 1 { 49 } else { 50 }
            || self.name.chars().any(char::is_control)
        {
            return Err("invalid saved player name".into());
        }
        if self.checkpoint_hex.is_empty() || self.checkpoint_hex.len() > MAX_CHECKPOINT * 2 {
            return Err("invalid checkpoint size".into());
        }
        let _ = self.checkpoint()?;
        let max_key = if self.version == 1 { 127 } else { 255 };
        if self.inputs.len() > MAX_INPUTS
            || self.inputs.iter().any(|key| !(0..=max_key).contains(key))
        {
            return Err("invalid input journal".into());
        }
        if self.inputs.len() > self.input_index as usize {
            return Err("invalid journal position".into());
        }
        if (self.version == 1 && !self.presentation.is_null())
            || (self.version == 2
                && (!self.presentation.is_object()
                    || serde_json::to_vec(&self.presentation)
                        .map_err(|_| "invalid presentation")?
                        .len()
                        > 512 * 1024))
        {
            return Err("invalid saved presentation".into());
        }
        if self.version == 2 {
            let object = self
                .presentation
                .as_object()
                .ok_or("invalid saved presentation")?;
            if object.len() != 4
                || !["lines", "input", "history", "last_message"]
                    .iter()
                    .all(|key| object.contains_key(*key))
                || !self.presentation["lines"]
                    .as_array()
                    .is_some_and(|lines| lines.len() <= 256 && lines.iter().all(ValueShape::line))
                || !self.presentation["history"]
                    .as_array()
                    .is_some_and(|history| {
                        history.len() <= 32 && history.iter().all(ValueShape::message)
                    })
                || !(self.presentation["input"].is_null() || self.presentation["input"].is_object())
                || !(self.presentation["last_message"].is_null()
                    || ValueShape::message(&self.presentation["last_message"]))
            {
                return Err("invalid saved presentation structure".into());
            }
        }
        if let Some(marker) = self.presentation["input"].get("message_paging")
            && marker != "log"
        {
            return Err("invalid narration policy".into());
        }
        if let Some(until) = self.presentation["input"].get("message_paging_legacy_until")
            && (self.presentation["input"]["message_paging"] != "log"
                || !until.as_u64().is_some_and(|index| {
                    index >= u64::from(self.input_index - self.inputs.len() as u32)
                        && index <= u64::from(self.input_index)
                }))
        {
            return Err("invalid narration replay boundary".into());
        }
        if self.checksum != self.digest() {
            return Err("save checksum mismatch".into());
        }
        Ok(())
    }

    fn digest(&self) -> u32 {
        // Corruption detection, not an authentication/security signature.
        let mut digest = 2_166_136_261_u32;
        let mut add = |bytes: &[u8]| {
            for &byte in bytes {
                digest = (digest ^ u32::from(byte)).wrapping_mul(16_777_619);
            }
            digest = (digest ^ 0xff).wrapping_mul(16_777_619);
        };
        add(self.format.as_bytes());
        add(&self.version.to_le_bytes());
        add(&self.abi.to_le_bytes());
        add(self.source.as_bytes());
        add(&self.seed.to_le_bytes());
        add(self.name.as_bytes());
        add(self.checkpoint_hex.as_bytes());
        for key in &self.inputs {
            add(&key.to_le_bytes());
        }
        add(&self.input_index.to_le_bytes());
        if self.version == 2
            && let Ok(bytes) = serde_json::to_vec(&self.presentation)
        {
            add(&bytes);
        }
        digest
    }
}

struct ValueShape;
impl ValueShape {
    fn message(value: &serde_json::Value) -> bool {
        value.is_object()
            && value["id"].is_string()
            && value["args"].is_array()
            && value["fallback"].is_string()
    }
    fn line(value: &serde_json::Value) -> bool {
        Self::message(value)
            && value["scope"].is_string()
            && value["row"]
                .as_i64()
                .is_some_and(|row| (0..128).contains(&row))
            && value["col"]
                .as_i64()
                .is_some_and(|col| (0..256).contains(&col))
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 15)]));
    }
    output
}

pub fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) {
        return Err("invalid checkpoint hex length".into());
    }
    fn digit(byte: u8) -> Result<u8, String> {
        match byte {
            b'0'..=b'9' => Ok(byte - b'0'),
            b'a'..=b'f' => Ok(byte - b'a' + 10),
            _ => Err("invalid checkpoint hex digit".into()),
        }
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    for pair in value.as_bytes().as_chunks::<2>().0 {
        bytes.push((digit(pair[0])? << 4) | digit(pair[1])?);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_validate_identity_lengths_journal_and_corruption() {
        let value =
            Envelope::new(123, "Rogue".into(), &[0, 255, 7], vec![107, 27], 2).expect("fixture");
        let bytes = value.bytes().expect("fixture encoding");
        assert_eq!(
            Envelope::parse(&bytes)
                .expect("fixture decoding")
                .checkpoint()
                .expect("fixture hex"),
            [0, 255, 7]
        );
        let mut corrupted = value.clone();
        corrupted.inputs[0] = 106;
        assert!(corrupted.bytes().is_err());
        let mut wrong_source = value.clone();
        wrong_source.source = "other".into();
        assert!(wrong_source.bytes().is_err());
        assert!(Envelope::parse(b"{\"format\":\"rogue-four-layer\"}").is_err());
        assert!(hex_decode("0g").is_err());
        assert!(hex_decode("f").is_err());
        assert!(Envelope::new(1, "Rogue".into(), &[1], vec![128], 1).is_err());
    }
}
