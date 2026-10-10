use super::*;
use crate::{controller::Controller, policies::*};
fn boot() -> Controller {
    let mut c = Controller::new(measure);
    c.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{"trace":"1"}}}));
    for mode in ["tiles", "pixels"] {
        let pixels = if mode == "pixels" { 32 } else { 96 };
        c.request(json!({"type":"api","operation":"assets","ok":true,"set":mode,"images":vec![json!({"width":pixels,"height":pixels});46]}));
    }
    c
}
fn event(c: &mut Controller, e: Value) -> Value {
    c.request(json!({"type":"event","event":e}))
}
fn start(c: &mut Controller) -> Value {
    let r = event(c, json!({"type":"invoke","id":"new-game"}));
    assert!(
        r["effects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "worker-start")
    );
    c.request(json!({"type":"worker","generation":1,"data":{"type":"ready"}}))
}
fn queue_effect(r: &Value) -> &Value {
    r["effects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "queue")
        .unwrap()
}
#[test]
fn utf8_budgets_seed_bounds_and_controls() {
    assert!(valid_text(&"勇者".repeat(8), 49, false));
    assert!(!valid_text(&"勇者".repeat(9), 49, false));
    assert!(!valid_text("勇者\0", 49, false));
    assert!(!valid_text("", 49, false));
    assert!(valid_text("", 50, true));
    for input in ["", "-1", "4294967296", "1.5", "NaN", "inf"] {
        assert_eq!(seed(input), None, "{input}");
    }
    assert_eq!(seed(" 4294967295 "), Some(u32::MAX));
    assert_eq!(seed("1e2"), Some(100));
}
#[test]
fn preference_corruption_and_mode_specific_zoom() {
    for raw in [
        "invalid",
        "{}",
        "null",
        r#"{"version":1,"mode":"pixels","zoom":24}"#,
    ] {
        assert_eq!(
            preference(raw),
            json!({"version":1,"mode":"tiles","zoom":32})
        );
    }
    assert_eq!(
        preference(r#"{"version":1,"mode":"pixels","zoom":128}"#)["zoom"],
        128
    );
    assert_eq!(sizes("pixels"), [32, 64, 96, 128]);
    assert!(!mode("secret"));
}
#[test]
fn catalogs_keep_literal_arguments_and_report_missing_without_fallback() {
    let mut c = Catalog::default();
    assert!(
        c.label(
            "ja",
            "notice.input_flush",
            &json!({"count":"<script>1</script>"})
        )
        .contains("<script>1</script>")
    );
    assert!(
        c.label("ja", "missing.id", &json!({}))
            .contains("Missing UI catalog entry")
    );
    assert_eq!(
        c.missing,
        json!([{"locale":"ja","id":"missing.id"}])
            .as_array()
            .unwrap()
            .clone()
    );
}
#[test]
fn history_preserves_repeats_ignores_clears_classifies_and_caps() {
    let mut h = History::default();
    for _ in 0..2 {
        h.message(json!({"id":"hit","text":"Hit"}));
    }
    h.message(json!({"id":"message.clear","text":""}));
    h.notice("saved", json!({}), false);
    assert_eq!(h.entries.len(), 3);
    assert_eq!(h.entries[0]["source"], "game");
    h.message(json!({"id":"platform.restore_error","text":"Could not restore"}));
    assert_eq!(h.entries[3]["source"], "system");
    for _ in 0..600 {
        h.notice("saved", json!({}), false);
    }
    assert_eq!(h.entries.len(), 500);
}
#[test]
fn session_validation_and_stale_callbacks_are_owned_by_rust() {
    let mut c = boot();
    let r=c.request(json!({"type":"event","inputs":{"seed":{"value":"-1"},"name":{"value":"Player"}},"event":{"type":"invoke","id":"new-game"}}));
    assert_eq!(r["state"]["generation"], 0);
    assert!(r["state"]["topOpen"].as_bool().unwrap());
    assert!(!r["state"]["starting"].as_bool().unwrap());
    c.request(json!({"type":"event","inputs":{"seed":{"value":"17"},"name":{"value":"勇者"}},"event":{"type":"native-input","id":"name"}}));
    start(&mut c);
    let r =
        c.request(json!({"type":"worker","generation":0,"data":{"type":"error","text":"stale"}}));
    assert_eq!(r["state"]["runtimeError"], Value::Null);
    assert_eq!(r["state"]["running"], true);
    let r=c.request(json!({"type":"worker","generation":1,"data":{"type":"frame","width":0,"height":24,"cells":""}}));
    assert_eq!(r["state"]["running"], false);
    assert_eq!(r["state"]["runtimeError"], "Invalid Rust frame");
}
#[test]
fn text_save_is_atomic_unicode_without_enter_and_commits_after_transaction() {
    let mut c = boot();
    start(&mut c);
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-context","input":{"kind":"text","limit_bytes":50,"initial":""}}}));
    c.request(json!({"type":"event","inputs":{"prompt-text":{"value":"勇者😀"}},"event":{"type":"native-input","id":"prompt-text"}}));
    let r = event(&mut c, json!({"type":"invoke","id":"save"}));
    let q = queue_effect(&r);
    assert_eq!(
        q["events"],
        json!([21, 0x52c7, 0x8005, 0x1f600, rogue_contract::RG_KEY_SAVE])
    );
    assert_eq!(r["state"]["savePending"], false);
    let r = c
        .request(json!({"type":"api","operation":"queue","ok":true,"generation":1,"after":"save"}));
    assert_eq!(r["state"]["savePending"], true);
    let r = event(&mut c, json!({"type":"invoke","id":"settings-top"}));
    assert_eq!(r["state"]["topOpen"], false);
    let r = c.request(
        json!({"type":"api","operation":"save-write","ok":true,"generation":1,"length":120}),
    );
    assert_eq!(r["state"]["savePending"], false);
    assert_eq!(r["state"]["savedLength"], 120);
    assert_eq!(r["state"]["saved"], true);
}
#[test]
fn composition_blocks_actions_and_queue_failure_keeps_draft() {
    let mut c = boot();
    start(&mut c);
    event(&mut c, json!({"type":"compositionstart"}));
    let r = event(&mut c, json!({"type":"invoke","id":"save"}));
    assert!(
        !r["effects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "queue")
    );
    event(&mut c, json!({"type":"compositionend"}));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-context","input":{"kind":"text","limit_bytes":50}}}));
    c.request(json!({"type":"event","inputs":{"prompt-text":{"value":"勇者"}},"event":{"type":"native-input","id":"prompt-text"}}));
    let r = event(&mut c, json!({"type":"invoke","id":"save"}));
    let original = queue_effect(&r)["events"].clone();
    c.request(json!({"type":"api","operation":"queue","ok":false,"generation":1,"after":"save"}));
    let r = event(&mut c, json!({"type":"invoke","id":"save"}));
    assert_eq!(queue_effect(&r)["events"], original);
    c.request(json!({"type":"api","operation":"queue","ok":true,"generation":1,"after":"save"}));
    let r=c.request(json!({"type":"worker","generation":1,"data":{"type":"input-flush","events":[rogue_contract::RG_KEY_SAVE],"count":1}}));
    assert_eq!(r["state"]["savePending"], false);
}
#[test]
fn randomization_collision_and_restore_selection() {
    let mut c = boot();
    let r = c.request(
        json!({"type":"api","operation":"random","ok":true,"id":"random-seed","value":12345}),
    );
    assert!(
        r["effects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == "seed" && e["properties"]["value"] == "12346")
    );
    let r = event(&mut c, json!({"type":"invoke","id":"load"}));
    assert_eq!(r["state"]["starting"], true);
    let r = c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"length":0}));
    assert_eq!(r["state"]["starting"], false);
    event(&mut c, json!({"type":"invoke","id":"load"}));
    let r =
        c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"length":500}));
    let e = r["effects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "worker-start")
        .unwrap();
    assert_eq!(e["restore"], true);
    assert_eq!(
        e["files"],
        json!([["/message-paging.txt", "log"], ["/trace.enabled", "1"]])
    );
}
