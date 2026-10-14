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
fn wall_assets_load_and_incomplete_sets_fail() {
    let mut c = boot();
    let r = c.request(json!({"type":"render","view":{"width":1240,"height":900}}));
    assert_eq!(r["state"]["ready"], true);
    assert_eq!(r["state"]["runtimeError"], Value::Null);
    for (count, pixels) in [(45, 32), (47, 32), (46, 96)] {
        let mut c = Controller::new(measure);
        c.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{}}}));
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"pixels","images":vec![json!({"width":pixels,"height":pixels});count]}));
        assert_eq!(r["state"]["ready"], false);
        assert_eq!(
            r["state"]["runtimeError"],
            "Invalid tile dimensions or unavailable assets"
        );
    }
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
fn preference_corruption_and_shared_continuous_zoom() {
    for raw in [
        "invalid",
        "{}",
        "null",
        r#"{"version":1,"mode":"pixels","zoom":0}"#,
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
    assert_eq!(
        preference(r#"{"version":1,"mode":"pixels","zoom":24.35}"#)["zoom"],
        24.35
    );
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
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":[1]}}));
    let request = r["effects"].as_array().unwrap().iter().find(|e| e["kind"] == "save-write").unwrap()["request"].clone();
    let r = c.request(
        json!({"type":"api","operation":"save-write","ok":true,"generation":1,"request":request,"length":120}),
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
    let request = save_effect(&r, "save-read")["request"].clone();
    let r = c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"request":request,"length":0}));
    assert_eq!(r["state"]["starting"], false);
    let r = event(&mut c, json!({"type":"invoke","id":"load"}));
    let request = save_effect(&r, "save-read")["request"].clone();
    let bytes = rogue_platform::Envelope::new(17, "Saved".into(), &[1], vec![], 0)
        .unwrap()
        .bytes()
        .unwrap();
    let r = c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"request":request,"length":bytes.len(),"bytes":bytes}));
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

fn save_effect<'a>(response: &'a Value, kind: &str) -> &'a Value {
    response["effects"].as_array().unwrap().iter().find(|e| e["kind"] == kind).unwrap()
}

fn save_bytes(name: &str) -> Vec<u8> {
    rogue_platform::Envelope::new(17, name.into(), &[1], vec![], 0).unwrap().bytes().unwrap()
}

#[test]
fn save_candidates_require_the_pending_operation_and_retire_with_the_session() {
    let mut c = Controller::new(measure);
    let initial = c.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{}}}));
    let initial_request = save_effect(&initial, "save-read")["request"].clone();
    let r = event(&mut c, json!({"type":"invoke","id":"import-save"}));
    let request = save_effect(&r, "save-import")["request"].clone();
    let bytes = save_bytes("Imported");
    for (operation, generation) in [("load", 0), ("import", 7)] {
        let r = c.request(json!({"type":"api","operation":operation,"ok":true,"generation":generation,"request":request,"bytes":bytes}));
        assert_eq!(r["accepted"], false);
        assert_eq!(r["state"]["saved"], false);
    }
    let r = c.request(json!({"type":"api","operation":"import","ok":true,"generation":0,"request":request,"bytes":bytes}));
    assert_eq!(r["accepted"], true);
    assert_eq!(r["state"]["savedLength"], bytes.len());
    assert_eq!(r["state"]["saved"], false);
    assert_eq!(r["state"]["downloadAvailable"], true);
    assert_eq!(save_effect(&r, "save-accept")["request"], request);
    assert_eq!(save_effect(&r, "save-discard")["request"], initial_request);
    assert_eq!(r["state"]["generation"], 1);
    let r = c.request(json!({"type":"api","operation":"init","ok":true,"generation":0,"request":initial_request,"bytes":save_bytes("Older")}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["savedLength"], bytes.len());
    assert_eq!(save_effect(&r, "save-discard")["request"], initial_request);
    let r = c.request(json!({"type":"api","operation":"import","ok":true,"generation":0,"request":request,"bytes":bytes}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["generation"], 1);
}

#[test]
fn invalid_cancelled_or_retired_import_keeps_the_accepted_save_and_game() {
    let mut c = boot();
    let bytes = save_bytes("Existing");
    let r = event(&mut c, json!({"type":"invoke","id":"load"}));
    let request = save_effect(&r, "save-read")["request"].clone();
    c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"request":request,"bytes":bytes}));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"ready"}}));
    for cancelled in [false, true] {
        let r = event(&mut c, json!({"type":"invoke","id":"import-save"}));
        let request = save_effect(&r, "save-import")["request"].clone();
        let r = c.request(json!({"type":"api","operation":"import","ok":!cancelled,"cancelled":cancelled,"generation":1,"request":request,"bytes":[1,2]}));
        assert_eq!(r["state"]["running"], true);
        assert_eq!(r["state"]["generation"], 1);
        assert_eq!(r["state"]["savedLength"], bytes.len());
        assert_eq!(save_effect(&r, "save-discard")["request"], request);
    }
    let r = event(&mut c, json!({"type":"invoke","id":"import-save"}));
    let request = save_effect(&r, "save-import")["request"].clone();
    let r = event(&mut c, json!({"type":"invoke","id":"settings-top"}));
    assert_eq!(save_effect(&r, "save-discard")["request"], request);
    let r = c.request(json!({"type":"api","operation":"import","ok":true,"generation":1,"request":request,"bytes":bytes}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["topOpen"], true);
    assert_eq!(r["state"]["savedLength"], bytes.len());
}

#[test]
fn assets_are_ready_only_after_both_distinct_sets() {
    let mut c = Controller::new(measure);
    for _ in 0..3 {
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"tiles","images":vec![json!({"width":96,"height":96});46]}));
        assert_eq!(r["state"]["ready"], false);
    }
    for _ in 0..3 {
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"pixels","images":vec![json!({"width":32,"height":32});46]}));
        assert_eq!(r["state"]["ready"], true);
    }
    let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"unknown","images":vec![json!({"width":96,"height":96});46]}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["ready"], true);
}

#[test]
fn failed_write_releases_its_candidate_and_preserves_the_previous_save() {
    let mut c = boot();
    let bytes = save_bytes("Existing");
    let r = event(&mut c, json!({"type":"invoke","id":"load"}));
    let request = save_effect(&r, "save-read")["request"].clone();
    c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"request":request,"bytes":bytes}));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"ready"}}));
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":save_bytes("Newer")}}));
    let request = save_effect(&r, "save-write")["request"].clone();
    let r = c.request(json!({"type":"api","operation":"save-write","ok":false,"generation":1,"request":request,"error":"transaction aborted"}));
    assert_eq!(r["state"]["running"], true);
    assert_eq!(r["state"]["saved"], true);
    assert_eq!(r["state"]["downloadAvailable"], true);
    assert_eq!(r["state"]["savedLength"], bytes.len());
    assert_eq!(r["state"]["savePending"], false);
    assert_eq!(save_effect(&r, "save-discard")["request"], request);
    let r = c.request(json!({"type":"api","operation":"save-write","ok":true,"generation":1,"request":request,"length":100}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["savedLength"], bytes.len());
}
