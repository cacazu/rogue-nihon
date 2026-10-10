use rogue_contract as abi;
use rogue_display::display;
use rogue_input as input;
use rogue_platform as platform;
// Standalone checks of the three pure Rust layers. No C FFI or game library
// is imported, and this executable does not exercise browser DOM/storage.

use abi::*;
use input::Input;
use serde_json::{Value, json};
use std::fmt::Debug;

#[derive(Default)]
struct Checks {
    count: usize,
}

impl Checks {
    fn equal<T: PartialEq + Debug>(&mut self, name: &str, actual: T, expected: T) {
        self.count += 1;
        assert_eq!(actual, expected, "{name}");
    }

    fn rejects<T, E>(&mut self, name: &str, result: Result<T, E>) {
        self.equal(name, result.is_err(), true);
    }
}

fn input_checks() -> usize {
    let mut checks = Checks::default();
    for (raw, letter) in [
        (RG_KEY_UP, b'k'),
        (RG_KEY_DOWN, b'j'),
        (RG_KEY_LEFT, b'h'),
        (RG_KEY_RIGHT, b'l'),
        (RG_KEY_HOME, b'y'),
        (RG_KEY_END, b'b'),
        (RG_KEY_PAGE_UP, b'u'),
        (RG_KEY_PAGE_DOWN, b'n'),
    ] {
        checks.equal(
            "direction",
            input::decode(raw),
            Input::Key(i32::from(letter)),
        );
        checks.equal(
            "running direction",
            input::decode(raw | RG_EVENT_SHIFT),
            Input::Key(i32::from(letter.to_ascii_uppercase())),
        );
        checks.equal(
            "control direction",
            input::decode(raw | RG_EVENT_CTRL),
            Input::Key(i32::from(letter & 0x1f)),
        );
    }
    checks.equal(
        "control lowercase",
        input::decode(u32::from(b'r') | RG_EVENT_CTRL),
        Input::Key(18),
    );
    checks.equal(
        "control uppercase",
        input::decode(u32::from(b'R') | RG_EVENT_CTRL),
        Input::Key(18),
    );
    checks.equal(
        "DOM uppercase retained",
        input::decode(u32::from(b'H') | RG_EVENT_SHIFT),
        Input::Key(72),
    );
    checks.equal(
        "ASCII shift already represented by DOM scalar",
        input::decode(u32::from(b'h') | RG_EVENT_SHIFT),
        Input::Key(104),
    );
    checks.equal(
        "repeat retains semantic key",
        input::decode(RG_KEY_LEFT | RG_EVENT_REPEAT),
        Input::Key(104),
    );
    checks.equal("escape", input::decode(27), Input::Key(27));
    checks.equal("space", input::decode(32), Input::Key(32));
    checks.equal(
        "alt belongs to browser",
        input::decode(u32::from(b'x') | RG_EVENT_ALT),
        Input::Ignore,
    );
    checks.equal(
        "alt arrow ignored",
        input::decode(RG_KEY_UP | RG_EVENT_ALT),
        Input::Ignore,
    );
    checks.equal(
        "Japanese scalar ignored",
        input::decode(0x3042),
        Input::Ignore,
    );
    checks.equal(
        "emoji scalar ignored",
        input::decode(0x1f600),
        Input::Ignore,
    );
    checks.equal(
        "unsupported raw key ignored",
        input::decode(0x110009),
        Input::Ignore,
    );
    checks.equal("save request", input::decode(RG_KEY_SAVE), Input::Save);
    checks.equal("input ended", input::decode(RG_KEY_END_INPUT), Input::End);
    checks.count
}

fn formatted(template: &str, arguments: Value) -> Result<String, String> {
    display::format_template(template, arguments.as_array().expect("array fixture"))
}

fn display_checks() -> usize {
    let mut checks = Checks::default();
    let attack = json!([{"kind":"string","value":"orc"},{"kind":"signed","value":7}]);
    checks.equal(
        "typed string and decimal",
        formatted("the %s hits for %2d", attack.clone()).expect("format"),
        "the orc hits for  7".into(),
    );
    checks.equal(
        "Unicode word reordering",
        formatted("{1}ダメージを{0}が受ける", attack.clone()).expect("format"),
        "7ダメージをorcが受ける".into(),
    );
    checks.equal(
        "reused and escaped indexed braces",
        formatted("{{{0}}}/{1}/{0}", attack).expect("format"),
        "{orc}/7/orc".into(),
    );
    checks.equal("legacy complete status line", formatted(
        "Level: %d  Gold: %-5d  Hp: %*d(%*d)  Str: %2d(%d)  Arm: %-2d  Exp: %d/%ld  %s",
        json!([{"value":2},{"value":42},{"value":2},{"value":9},{"value":2},{"value":12},
               {"value":16},{"value":17},{"value":4},{"value":1},{"value":1234},{"value":"Hungry"}])
    ).expect("format"), "Level: 2  Gold: 42     Hp:  9(12)  Str: 16(17)  Arm: 4   Exp: 1/1234  Hungry".into());
    checks.equal(
        "inventory character",
        formatted(
            "%c) %s",
            json!([{"kind":"signed","value":97},{"kind":"string","value":"orc"}]),
        )
        .expect("format"),
        "a) orc".into(),
    );
    checks.equal(
        "positive sign before zero pad",
        formatted("%+05d", json!([{"value":7}])).expect("format"),
        "+0007".into(),
    );
    checks.equal(
        "negative sign before zero pad",
        formatted("%05d", json!([{"value":-7}])).expect("format"),
        "-0007".into(),
    );
    checks.equal(
        "negative star width aligns left",
        formatted("%*d", json!([{"value":-5},{"value":9}])).expect("format"),
        "9    ".into(),
    );
    checks.equal(
        "percent literal",
        formatted("%d%%", json!([{"value":25}])).expect("format"),
        "25%".into(),
    );
    checks.equal(
        "unsigned hexadecimal",
        formatted(
            "%u %x %X",
            json!([{"value":42},{"value":255},{"value":255}]),
        )
        .expect("format"),
        "42 ff FF".into(),
    );
    checks.equal(
        "floating precision",
        formatted("%.2f", json!([{"kind":"float","value":1.25}])).expect("format"),
        "1.25".into(),
    );
    checks.equal(
        "Unicode string precision",
        formatted("%.2s", json!([{"value":"日本語"}])).expect("format"),
        "日本".into(),
    );
    checks.rejects("missing printf argument", formatted("%s", json!([])));
    checks.rejects(
        "wrong value type",
        formatted("%s", json!([{"kind":"signed","value":7}])),
    );
    checks.rejects("untyped argument", formatted("%d", json!([7])));
    checks.rejects("unused arguments", formatted("plain", json!([{"value":7}])));
    checks.rejects(
        "unsupported write conversion",
        formatted("%n", json!([{"value":0}])),
    );
    checks.rejects("incomplete conversion", formatted("broken %", json!([])));
    checks.rejects("oversized width", formatted("%4097d", json!([{"value":7}])));
    checks.rejects(
        "width overflow",
        formatted("%99999999999999999999999999d", json!([{"value":7}])),
    );
    checks.rejects(
        "oversized float precision",
        formatted("%.65f", json!([{"value":1.0}])),
    );
    checks.rejects(
        "missing reordered argument",
        formatted("{2}", json!([{"value":7}])),
    );
    checks.rejects(
        "malformed indexed template",
        formatted("{x}", json!([{"value":7}])),
    );
    checks.rejects(
        "unescaped closing brace",
        formatted("{0}}", json!([{"value":7}])),
    );
    checks.equal(
        "clear",
        display::message("message.clear", &json!([]), "previous"),
        String::new(),
    );
    checks.equal(
        "unknown id fallback",
        display::message("unknown.message", &json!([]), "Original"),
        "Original".into(),
    );
    checks.equal(
        "legacy id fallback",
        display::message("message.legacy", &json!([]), "Original dynamic English"),
        "Original dynamic English".into(),
    );
    checks.equal(
        "known catalog capitalization",
        display::message(
            "armor.wear.wearing",
            &json!([{"kind":"string","value":"chain mail"}]),
            "Wearing chain mail",
        ),
        "Wearing chain mail".into(),
    );
    checks.equal(
        "known template wrong args fallback",
        display::message(
            "armor.wear.wearing",
            &json!([{"kind":"signed","value":42}]),
            "Wearing armor",
        ),
        "Wearing armor".into(),
    );
    checks.equal("sequence with known and dynamic parts", display::message("message.sequence", &json!([
        {"kind":"message_part","value":{"id":"armor.wear.you_are_now","args":[],"fallback":"you are now "}},
        {"kind":"message_part","value":{"id":"message.legacy","args":[],"fallback":"wearing chain mail"}}
    ]), "You are now wearing chain mail"), "You are now wearing chain mail".into());
    checks.equal(
        "malformed sequence fallback",
        display::message(
            "message.sequence",
            &json!([{"kind":"message_part","value":{}}]),
            "Combined original",
        ),
        "Combined original".into(),
    );
    checks.count
}

fn platform_checks() -> usize {
    let mut checks = Checks::default();
    let mut v1 = Value::Null;
    platform::MessagePaging::remove_marker(&mut v1);
    checks.equal("v1 absent presentation remains null", v1, Value::Null);
    let until = platform::MessagePaging::ReplayLegacyUntil(3);
    checks.equal(
        "legacy prefix acknowledgement",
        until.requires_acknowledgement(2),
        true,
    );
    checks.equal(
        "future narration no acknowledgement",
        until.requires_acknowledgement(3),
        false,
    );
    checks.equal(
        "unfinished checkpoint keeps replay policy",
        until.at_checkpoint(2) == until,
        true,
    );
    checks.equal(
        "fresh checkpoint normalizes policy",
        until.at_checkpoint(3) == platform::MessagePaging::Log,
        true,
    );
    let mut mixed = json!({"lines":[],"input":{"kind":"item"},"history":[],"last_message":null});
    until.mark(&mut mixed);
    let mixed_save = platform::Envelope::new_with_presentation(
        1,
        "Rogue".into(),
        &[1],
        vec![32, 108],
        4,
        mixed.clone(),
    )
    .expect("mixed prefix");
    checks.equal(
        "mixed journal boundary roundtrip",
        platform::MessagePaging::from_saved(&mixed_save.presentation) == until,
        true,
    );
    mixed["input"]["message_paging_legacy_until"] = json!(5);
    checks.rejects(
        "future boundary",
        platform::Envelope::new_with_presentation(
            1,
            "Rogue".into(),
            &[1],
            vec![32, 108],
            4,
            mixed.clone(),
        ),
    );
    mixed["input"]["message_paging_legacy_until"] = json!(1);
    checks.rejects(
        "boundary before checkpoint",
        platform::Envelope::new_with_presentation(
            1,
            "Rogue".into(),
            &[1],
            vec![32, 108],
            4,
            mixed.clone(),
        ),
    );
    platform::MessagePaging::remove_marker(&mut mixed);
    checks.equal(
        "prompt context preserved",
        mixed["input"].clone(),
        json!({"kind":"item"}),
    );
    let original = json!({"lines":[],"input":null,"history":[],"last_message":null});
    checks.equal(
        "old narration policy",
        platform::MessagePaging::from_saved(&original) == platform::MessagePaging::Legacy,
        true,
    );
    let mut marked = original.clone();
    platform::MessagePaging::Log.mark(&mut marked);
    let saved =
        platform::Envelope::new_with_presentation(1, "Rogue".into(), &[1], vec![], 0, marked)
            .expect("policy fixture");
    checks.equal("policy uses existing v2", saved.version, 2);
    let mut restored = platform::Envelope::parse(&saved.bytes().expect("policy bytes"))
        .expect("policy parse")
        .presentation;
    checks.equal(
        "policy survives checksum roundtrip",
        platform::MessagePaging::from_saved(&restored) == platform::MessagePaging::Log,
        true,
    );
    platform::MessagePaging::remove_marker(&mut restored);
    checks.equal(
        "policy removed before UI restoration",
        restored.clone(),
        original,
    );
    restored["input"] = json!({"message_paging":"invalid"});
    checks.rejects(
        "unknown narration policy",
        platform::Envelope::new_with_presentation(1, "Rogue".into(), &[1], vec![], 0, restored),
    );
    let value = platform::Envelope::new(123, "Rogue".into(), &[0, 255, 7], vec![107, 27], 12)
        .expect("fixture");
    let bytes = value.bytes().expect("fixture encoding");
    let restored = platform::Envelope::parse(&bytes).expect("fixture parsing");
    checks.equal(
        "checkpoint roundtrip",
        restored.checkpoint().expect("hex"),
        vec![0, 255, 7],
    );
    checks.equal("journal roundtrip", restored.inputs, vec![107, 27]);
    checks.equal(
        "index is cumulative, journal is suffix",
        restored.input_index,
        12,
    );
    checks.equal("seed roundtrip", restored.seed, 123);
    checks.equal(
        "UTF-8 name retained",
        platform::Envelope::new(1, "冒険者".into(), &[1], vec![], 0)
            .expect("name")
            .name,
        "冒険者".into(),
    );
    checks.equal(
        "hex all bytes roundtrip",
        platform::hex_decode(&platform::hex_encode(&(0..=255).collect::<Vec<u8>>())).expect("hex"),
        (0..=255).collect::<Vec<u8>>(),
    );
    for (label, mutate) in [
        ("format", 0_u8),
        ("version", 1),
        ("ABI", 2),
        ("source", 3),
        ("checksum", 4),
        ("checkpoint corruption", 5),
        ("journal corruption", 6),
        ("journal position", 7),
        ("negative key", 8),
        ("non-ASCII key", 9),
        ("odd hex length", 10),
        ("invalid hex digit", 11),
    ] {
        let mut broken = value.clone();
        match mutate {
            0 => broken.format = "other".into(),
            1 => broken.version += 1,
            2 => broken.abi += 1,
            3 => broken.source = "different source".into(),
            4 => broken.checksum ^= 1,
            5 => broken.checkpoint_hex = "00ff08".into(),
            6 => broken.inputs[0] = 106,
            7 => broken.input_index = 1,
            8 => broken.inputs[0] = -1,
            9 => broken.inputs[0] = 128,
            10 => broken.checkpoint_hex = "f".into(),
            11 => broken.checkpoint_hex = "0g".into(),
            _ => unreachable!(),
        }
        // Exercise untrusted parse as well as validation at encoding.
        checks.rejects(
            label,
            platform::Envelope::parse(&serde_json::to_vec(&broken).expect("mutation encoding")),
        );
    }
    checks.rejects(
        "empty checkpoint",
        platform::Envelope::new(1, "Rogue".into(), &[], vec![], 0),
    );
    checks.rejects(
        "checkpoint above size bound",
        platform::Envelope::new(
            1,
            "Rogue".into(),
            &vec![1; platform::MAX_CHECKPOINT + 1],
            vec![],
            0,
        ),
    );
    checks.rejects(
        "journal above size bound",
        platform::Envelope::new(
            1,
            "Rogue".into(),
            &[1],
            vec![107; platform::MAX_INPUTS + 1],
            (platform::MAX_INPUTS + 1) as u32,
        ),
    );
    checks.rejects(
        "name above byte bound",
        platform::Envelope::new(1, "x".repeat(50), &[1], vec![], 0),
    );
    checks.rejects(
        "name containing NUL",
        platform::Envelope::new(1, "a\0b".into(), &[1], vec![], 0),
    );
    checks.rejects(
        "UTF-8 name bound counts bytes",
        platform::Envelope::new(1, "日".repeat(17), &[1], vec![], 0),
    );
    checks.rejects("unknown JSON field", {
        let mut json = serde_json::to_value(&value).expect("fixture JSON");
        json["unknown"] = json!(true);
        platform::Envelope::parse(&serde_json::to_vec(&json).expect("encoding"))
    });
    checks.rejects(
        "missing fields",
        platform::Envelope::parse(b"{\"format\":\"rogue-four-layer\"}"),
    );
    checks.rejects("malformed JSON", platform::Envelope::parse(b"{"));
    checks.rejects(
        "envelope above byte bound",
        platform::Envelope::parse(&vec![b' '; platform::MAX_ENVELOPE + 1]),
    );
    checks.rejects(
        "uppercase hex rejected by canonical encoding",
        platform::hex_decode("FF"),
    );
    let presentation = json!({"lines":[{"scope":"menu","row":1,"col":0,
        "id":"ui.inventory.entry","args":[],"fallback":"item"}],
        "input":{"kind":"text","current_text":"旅人"},"history":[],"last_message":null});
    let v2 = platform::Envelope::new_with_presentation(
        7,
        "旅人".into(),
        &[1, 2],
        vec![21, 230, 151, 133],
        4,
        presentation.clone(),
    )
    .expect("UTF-8 presentation fixture");
    let decoded =
        platform::Envelope::parse(&v2.bytes().expect("UTF-8 encode")).expect("UTF-8 decode");
    checks.equal("presentation schema version", decoded.version, 2);
    checks.equal(
        "typed UTF-8 journal bytes",
        decoded.inputs,
        vec![21, 230, 151, 133],
    );
    checks.equal(
        "presentation checkpoint identity",
        decoded.presentation,
        presentation.clone(),
    );
    checks.equal(
        "max C name bytes accepted v2",
        platform::Envelope::new_with_presentation(
            7,
            "x".repeat(50),
            &[1],
            vec![],
            0,
            presentation.clone(),
        )
        .expect("50-byte name")
        .name
        .len(),
        50,
    );
    for key in [256, -1] {
        checks.rejects(
            "journal bounds v2",
            platform::Envelope::new_with_presentation(
                7,
                "旅人".into(),
                &[1],
                vec![key],
                1,
                presentation.clone(),
            ),
        );
    }
    for malformed in [
        json!([]),
        json!({}),
        json!({"lines":[],"history":[],"last_message":null,"input":7}),
        json!({"lines":[{"scope":"menu","row":-1,"col":0,"id":"ui.text","args":[],"fallback":""}],
            "history":[],"last_message":null,"input":null}),
    ] {
        checks.rejects(
            "presentation structure bounds",
            platform::Envelope::new_with_presentation(7, "旅人".into(), &[1], vec![], 0, malformed),
        );
    }
    let mut corrupted = v2.clone();
    corrupted.presentation["input"]["current_text"] = json!("偽");
    checks.rejects("presentation covered by checksum", corrupted.bytes());
    checks.count
}

fn main() {
    let input = input_checks();
    let display = display_checks();
    let platform = platform_checks();
    println!(
        "{}",
        json!({
            "input_checks": input, "display_checks": display, "platform_checks": platform,
            "total_checks": input + display + platform, "result": "pass",
            "scope": "pure Rust modules in standalone Emscripten/Node executable; no C game or browser"
        })
    );
}
