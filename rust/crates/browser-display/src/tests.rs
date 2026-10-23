use super::*;
use crate::{controller::Controller, policies::*};
fn asset_dimensions(mode: &str) -> Value {
    rogue_display::browser_ui::tiles::assets(mode)["expectedDimensions"].clone()
}
fn boot() -> Controller {
    let mut c = Controller::new(measure);
    c.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{"trace":"1"}}}));
    for mode in ["tiles", "pixels"] {
        c.request(json!({"type":"api","operation":"assets","ok":true,"set":mode,"images":asset_dimensions(mode)}));
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
fn keyboard_forwarding_redraws_new_visual_state_and_action_interruptions_only() {
    let mut c = boot();
    start(&mut c);
    for repeat in [false, true] {
        let result = event(&mut c, json!({"type":"key","key":"l","repeat":repeat}));
        assert_eq!(result["redraw"], false);
        assert_eq!(queue_effect(&result)["events"][0], 108 | if repeat { rogue_contract::RG_EVENT_REPEAT } else { 0 });
        let result = c.request(json!({"type":"api","operation":"queue","ok":true,"after":"send"}));
        assert_eq!(result["redraw"], false);
    }
    let frame = json!({"type":"frame","width":3,"height":3,"cells":"   .@.   ","player":{"x":1,"y":1},
        "map_cells":"   .@.   ","map_tiles":[0,0,0,1,8,1,0,0,0],"map_tile_ids":&rogue_display::map_tiles::IDS[..],"map_unknown_glyphs":[],
        "map_actor_epoch":1,"map_actor_step":1,"map_actors":[{"id":0,"x":1,"y":1,"glyph":64}],
        "map_actor_events":[{"sequence":1,"id":0,"kind":"attack"}],"ui":{"mode":"game","input":{"kind":"command"}}});
    let result = c.request(json!({"type":"worker","generation":1,"data":frame}));
    assert_eq!(result["state"]["runtimeError"], Value::Null);
    assert_eq!(result["redraw"], true);
    let result = c.request(json!({"type":"api","operation":"queue","ok":true,"after":"send"}));
    assert_eq!(result["redraw"], true, "An unfinished action is interrupted immediately");
    let result = c.request(json!({"type":"api","operation":"queue","ok":true,"after":"send"}));
    assert_eq!(result["redraw"], false);
    let result = c.request(json!({"type":"api","operation":"queue","ok":false,"after":"send"}));
    assert_eq!(result["redraw"], true, "Queue errors must remain visible");
    let result = event(&mut c, json!({"type":"key","key":"@"}));
    assert_eq!(result["redraw"], true, "Local status UI opens immediately");
}
#[test]
fn wall_assets_load_and_incomplete_sets_fail() {
    let mut c = boot();
    let r = c.request(json!({"type":"render","view":{"width":1240,"height":900}}));
    assert_eq!(r["state"]["ready"], true);
    assert_eq!(r["state"]["runtimeError"], Value::Null);
    let mut missing = asset_dimensions("pixels");
    missing.as_array_mut().unwrap().pop();
    let mut wrong_sheet = asset_dimensions("pixels");
    let sheet = wrong_sheet.as_array_mut().unwrap().iter_mut()
        .find(|image| image["width"] == 96).unwrap();
    sheet["height"] = json!(32);
    for images in [missing, wrong_sheet, json!(vec![json!({"width":32,"height":32});73])] {
        let mut c = Controller::new(measure);
        c.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{}}}));
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"pixels","images":images}));
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
    assert!(!valid_text("勇者\u{85}", 49, false));
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
            json!({"version":1,"mode":"tiles","zoom":32,"animation":true,"handedness":"right","theme":"default"})
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
            "random.name",
            &json!({"number":"<script>1</script>"})
        )
        .contains("<script>1</script>")
    );
    assert!(
        c.label("ja", "missing.id", &json!({}))
            .contains("画面を表示できませんでした。")
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
    assert_eq!(e["trace"], true);
    assert_eq!(e["message_paging"], "log");
}

fn save_effect<'a>(response: &'a Value, kind: &str) -> &'a Value {
    response["effects"].as_array().unwrap().iter().find(|e| e["kind"] == kind).unwrap()
}

fn save_bytes(name: &str) -> Vec<u8> {
    rogue_platform::Envelope::new(17, name.into(), &[1], vec![], 0).unwrap().bytes().unwrap()
}

fn automatic_save_frame(c: &mut Controller, generation: u64, level: u64, mode: &str) -> Value {
    c.request(json!({"type":"worker","generation":generation,"data":{
        "type":"frame","width":3,"height":3,"cells":"   .@.   ","player":{"x":1,"y":1},
        "stats":{"level":level,"hp":10},"map_cells":"   .@.   ","map_tiles":[0,0,0,1,8,1,0,0,0],
        "map_tile_ids":&rogue_display::map_tiles::IDS[..],"map_unknown_glyphs":[],
        "map_actor_epoch":1,"map_actor_step":1,"map_actors":[{"id":0,"x":1,"y":1,"glyph":64}],
        "map_actor_events":[],"ui":{"mode":mode,"input":{"kind":"command"}}
    }}))
}

#[test]
fn automatic_save_tracks_level_changes_at_original_input_boundaries() {
    let mut c = boot(); start(&mut c);
    automatic_save_frame(&mut c, 1, 1, "game");
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "queue"));
    let r = automatic_save_frame(&mut c, 1, 2, "game");
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "queue"));
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert_eq!(queue_effect(&r)["events"], json!([rogue_contract::RG_KEY_SAVE]));
    c.request(json!({"type":"api","operation":"queue","ok":true,"generation":1,"after":"save"}));
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":save_bytes("Floor2")}}));
    let request = save_effect(&r, "save-write")["request"].clone();
    let r = c.request(json!({"type":"api","operation":"save-write","ok":true,"generation":1,"request":request,"length":100}));
    assert_eq!(r["state"]["saved"], true);
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "queue"));
    automatic_save_frame(&mut c, 1, 1, "game");
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert_eq!(queue_effect(&r)["events"], json!([rogue_contract::RG_KEY_SAVE]));
}

#[test]
fn automatic_save_return_top_waits_for_commit_and_keeps_play_on_failure() {
    let mut c = boot(); start(&mut c);
    for ok in [false, true] {
        let r = event(&mut c, json!({"type":"invoke","id":"settings-top"}));
        assert_eq!(queue_effect(&r)["events"], json!([rogue_contract::RG_KEY_SAVE]));
        c.request(json!({"type":"api","operation":"queue","ok":true,"generation":1,"after":"save"}));
        let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":save_bytes("Top")}}));
        assert_eq!(r["state"]["topOpen"], false);
        let request = save_effect(&r, "save-write")["request"].clone();
        let r = c.request(json!({"type":"api","operation":"save-write","ok":ok,"generation":1,"request":request,"length":100,"error":"aborted"}));
        assert_eq!(r["state"]["topOpen"], ok);
        assert_eq!(r["state"]["running"], !ok);
        assert_eq!(r["state"]["savePending"], false);
    }
}

#[test]
fn automatic_save_successful_restore_consumes_the_slot_once() {
    let mut c = boot();
    let r = event(&mut c, json!({"type":"invoke","id":"load"}));
    let request = save_effect(&r, "save-read")["request"].clone();
    c.request(json!({"type":"api","operation":"load","ok":true,"generation":0,"request":request,"bytes":save_bytes("Restore")}));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"ready"}}));
    let r = automatic_save_frame(&mut c, 1, 7, "game");
    assert_eq!(r["state"]["saved"], true, "Do not consume before replay reaches its real input wait");
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    let deletion = save_effect(&r, "save-delete")["request"].clone();
    assert_eq!(r["state"]["saved"], false);
    assert_eq!(r["state"]["savedLength"], 0);
    assert!(r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "save-clear"));
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "queue"));
    c.request(json!({"type":"api","operation":"save-delete","ok":true,"generation":1,"request":deletion}));
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "save-delete"));
}

#[test]
fn automatic_save_death_invalidates_pending_writes_and_discards_late_bytes() {
    let mut c = boot(); start(&mut c);
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":save_bytes("Older")}}));
    let request = save_effect(&r, "save-write")["request"].clone();
    let r = automatic_save_frame(&mut c, 1, 1, "death");
    save_effect(&r, "save-delete");
    let r = c.request(json!({"type":"api","operation":"save-write","ok":true,"generation":1,"request":request,"length":100}));
    assert_eq!(r["accepted"], false);
    assert_eq!(r["state"]["savedLength"], 0);
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"save","bytes":save_bytes("Late")}}));
    assert!(!r["effects"].as_array().unwrap().iter().any(|e| e["kind"] == "save-write"));
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
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"error","text":"Restore failed"}}));
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
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"tiles","images":asset_dimensions("tiles")}));
        assert_eq!(r["state"]["ready"], false);
    }
    for _ in 0..3 {
        let r = c.request(json!({"type":"api","operation":"assets","ok":true,"set":"pixels","images":asset_dimensions("pixels")}));
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

#[test]
fn animation_switch_persists_without_game_input_and_old_preferences_default_on() {
    let mut c=boot();start(&mut c);
    let r=event(&mut c,json!({"type":"invoke","id":"animation-toggle"}));
    assert_eq!(r["state"]["animationEnabled"],false);
    assert!(!r["effects"].as_array().unwrap().iter().any(|e|e["kind"]=="queue"));
    let stored=r["effects"].as_array().unwrap().iter().find(|e|e["kind"]=="storage-write").unwrap();
    let preference_value:Value=serde_json::from_str(stored["value"].as_str().unwrap()).unwrap();
    assert_eq!(preference_value["animation"],false);
    let mut restored=Controller::new(measure);
    let r=restored.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{}},"preference":stored["value"]}));
    assert_eq!(r["state"]["animationEnabled"],false);
    assert_eq!(preference(r#"{"version":1,"mode":"tiles","zoom":32}"#)["animation"],true);
}

#[test]
fn transient_prompts_do_not_include_gameplay_questions_or_literal_names() {
    use crate::log_visibility::interaction_prompt;
    for id in [
        "misc.get_dir.which_direction", "pack.get_item.for_list",
        "rings.gethand.left_hand_or_right_hand", "rings.gethand.left_or_right_ring",
        "command.call.what_do_you_want_to_call_it", "command.call.call_it",
        "misc.call_it.what_do_you_want_to_call_it", "misc.call_it.call_it",
        "input.choose_item_list", "input.confirm",
    ] {
        let question = json!({"id":id,"args":[],"text":"question"});
        assert!(interaction_prompt(&question), "{id}");
        let sequence = json!({"id":"message.sequence","args":[{"kind":"message_part","value":question}],"text":"assembled question"});
        assert!(interaction_prompt(&sequence), "assembled {id}");
        assert!(interaction_prompt(&json!({"id":"command.command.string","args":[{"kind":"entity","value":{
            "type":"message","id":sequence["id"],"args":sequence["args"]}}],"text":"recalled question"})), "recall {id}");
    }
    for (id, args, text) in [
        ("potions.quaff.yuk_why_would_you_want_to_drink_that", json!([]), "Why would you want to drink that?"),
        ("command.call.called", json!([{"kind":"string","value":"どれを使う？ (* for list)"}]), "どれを使う？ (* for list)という名前"),
        ("sticks.do_zap.nothing_happens", json!([]), "nothing happens"),
        ("platform.save_error", json!([]), "save failed"),
    ] {
        assert!(!interaction_prompt(&json!({"id":id,"args":args,"text":text})), "{id}");
    }
}


#[test]
fn ui_theme_persists_without_game_input_and_old_preferences_keep_the_default() {
    assert_eq!(preference(r#"{"version":1,"mode":"pixels","zoom":32}"#)["theme"],"default");
    assert_eq!(preference(r#"{"version":1,"mode":"pixels","zoom":32,"theme":"unknown"}"#)["theme"],"default");
    let mut c=boot();
    let r=event(&mut c,json!({"type":"select","id":"theme","value":"green-black"}));
    assert_eq!(r["state"]["theme"],"green-black");
    let effects=r["effects"].as_array().unwrap();
    assert!(!effects.iter().any(|e| e["kind"]=="queue" || e["kind"]=="worker-start"));
    let saved=effects.iter().find(|e| e["kind"]=="storage-write").unwrap();
    let saved: Value=serde_json::from_str(text(&saved["value"])).unwrap();assert_eq!(saved["theme"],"green-black");
    let doc=effects.iter().find(|e| e["kind"]=="document").unwrap();assert_eq!(doc["foreground"],"#00ff66");
    assert_eq!(event(&mut c,json!({"type":"select","id":"theme","value":"unknown"}))["state"]["theme"],"green-black");
    let mut restored=Controller::new(measure);
    let r=restored.request(json!({"type":"boot","preference":saved.to_string(),"environment":{"isolated":true,"parameters":{}}}));
    assert_eq!(r["state"]["theme"],"green-black");
}


#[test]
fn system_notifications_keep_only_results_and_failures_in_history() {
    let mut c = boot();
    assert_eq!(c.snapshot()["entries"], json!([]));
    event(&mut c, json!({"type":"invoke","id":"new-game"}));
    assert_eq!(c.snapshot()["loading"], true);
    assert_eq!(c.snapshot()["entries"], json!([]));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"ready"}}));
    for data in [
        json!({"type":"message","id":"save.browser","text":"internal save guidance"}),
        json!({"type":"input-flush","events":[108],"count":1}),
        json!({"type":"input-request"}),
        json!({"type":"outcome","code":0}),
    ] { c.request(json!({"type":"worker","generation":1,"data":data})); }
    let state = c.snapshot();
    assert_eq!(state["entries"], json!([]));
    assert_eq!(state["messages"], json!([]));
    assert_eq!(state["loading"], false);
    let mut history = History::default();
    history.message(json!({"id":"save.browser","text":"restored old guidance"}));
    assert!(history.entries.is_empty());
}

#[test]
fn input_errors_are_specific_local_and_clear_when_edited() {
    for (name, seed, field, id) in [
        ("Player".to_string(), "-1", "seed", "error.seed"),
        ("勇者".repeat(9), "17", "name", "error.name"),
        ("勇者\0".to_string(), "17", "name", "error.name_characters"),
        ("勇者\u{85}".to_string(), "17", "name", "error.name_characters"),
    ] {
        let mut c = boot();
        let r = c.request(json!({"type":"event","inputs":{"name":{"value":name},"seed":{"value":seed}},"event":{"type":"invoke","id":"new-game"}}));
        assert_eq!(r["state"]["fieldErrors"][field]["id"], id);
        assert_eq!(r["state"]["entries"], json!([]));
        for width in [320, 390, 1240] {
            let r = c.request(json!({"type":"render","view":{"width":width,"height":844}}));
            let mut catalog = Catalog::default();
            let message = catalog.label("ja", id, &json!({}));
            let painted = r["commands"].as_array().unwrap().iter().filter(|command| command["op"] == "text")
                .map(|command| text(&command["text"])).collect::<String>();
            assert!(painted.contains(&message), "{width}: {message}");
        }
        let r = event(&mut c, json!({"type":"native-input","id":field}));
        assert_eq!(r["state"]["fieldErrors"][field], Value::Null);
    }
    let mut c = boot();
    let r = c.request(json!({"type":"event","inputs":{"name":{"value":""},"seed":{"value":"17"}},"event":{"type":"invoke","id":"new-game"}}));
    assert!(r["effects"].as_array().unwrap().iter().any(|effect| effect["kind"] == "worker-start" && effect["name"] == "Player"));
}

#[test]
fn prompt_errors_do_not_escape_to_history_or_submit_bad_text() {
    let mut c = boot(); start(&mut c);
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-context","input":{"kind":"text","limit_bytes":50}}}));
    for (value, id) in [("勇".repeat(17), "error.prompt_text"), ("勇\u{7f}".to_string(), "error.prompt_text_characters"), ("勇\u{85}".to_string(), "error.prompt_text_characters")] {
        let r = c.request(json!({"type":"event","inputs":{"prompt-text":{"value":value}},"event":{"type":"submit","id":"prompt-text"}}));
        assert_eq!(r["state"]["fieldErrors"]["prompt-text"]["id"], id);
        assert_eq!(r["state"]["entries"], json!([]));
        assert!(!r["effects"].as_array().unwrap().iter().any(|effect| effect["kind"] == "queue"));
    }
    event(&mut c, json!({"type":"compositionstart"}));
    let r = event(&mut c, json!({"type":"submit","id":"prompt-text"}));
    assert_eq!(r["state"]["fieldErrors"]["prompt-text"]["id"], "error.text_composing");
    let r = c.request(json!({"type":"worker","generation":1,"data":{"type":"message","id":"platform.name_error","text":"この名前は使えません。"}}));
    assert_eq!(r["state"]["fieldErrors"]["prompt-text"]["id"], "platform.name_error");
    assert_eq!(r["state"]["entries"], json!([]));
}

#[test]
fn terminal_failures_and_repeated_asset_failure_produce_one_notice() {
    for id in ["platform.input_limit", "platform.name_error", "platform.restore_error", "platform.error"] {
        let mut c = boot(); start(&mut c);
        for data in [
            json!({"type":"message","id":id,"text":"failure"}),
            json!({"type":"exit","code":-1}),
            json!({"type":"error","text":"startup or runtime failure"}),
        ] { c.request(json!({"type":"worker","generation":1,"data":data})); }
        assert_eq!(c.snapshot()["entries"].as_array().unwrap().len(), 1, "{id}");
    }
    let mut c = boot();
    for set in ["tiles", "pixels"] {
        c.request(json!({"type":"api","operation":"assets","ok":false,"set":set,"error":"missing assets"}));
    }
    assert_eq!(c.snapshot()["entries"].as_array().unwrap().len(), 1);
}


#[test]
fn text_save_validation_and_transport_errors_reveal_the_input_field() {
    let mut c = boot(); start(&mut c);
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-context","input":{"kind":"text","limit_bytes":50}}}));
    event(&mut c, json!({"type":"invoke","id":"settings-toggle"}));
    let r = c.request(json!({"type":"event","inputs":{"prompt-text":{"value":"勇".repeat(17)}},"event":{"type":"native-input","id":"prompt-text"}}));
    assert_eq!(r["state"]["settingsOpen"], true);
    let r = event(&mut c, json!({"type":"invoke","id":"settings-top"}));
    assert_eq!(r["state"]["settingsOpen"], false);
    assert_eq!(r["state"]["fieldErrors"]["prompt-text"]["id"], "error.prompt_text");
    assert!(!r["effects"].as_array().unwrap().iter().any(|effect| effect["kind"] == "queue"));
    for after in ["submit", "save"] {
        let r = c.request(json!({"type":"api","operation":"queue","ok":false,"after":after}));
        assert_eq!(r["state"]["fieldErrors"]["prompt-text"]["id"], "error.queue_full");
        assert_eq!(r["state"]["entries"], json!([]));
    }
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-context","input":{"kind":"command"}}}));
    let r = c.request(json!({"type":"api","operation":"queue","ok":false,"after":"send"}));
    assert_eq!(r["state"]["entries"][0]["id"], "error.queue_full");
}


#[test]
fn separate_failures_can_repeat_after_editing_the_title_form() {
    let mut c = boot();
    c.request(json!({"type":"api","operation":"fullscreen","ok":false,"error":"denied"}));
    c.request(json!({"type":"api","operation":"random","ok":true,"id":"random-seed","value":17}));
    let r = c.request(json!({"type":"api","operation":"fullscreen","ok":false,"error":"denied"}));
    assert_eq!(r["state"]["topNotice"]["id"], "error.fullscreen");
    assert_eq!(r["state"]["entries"].as_array().unwrap().len(), 2);
}


#[test]
fn save_help_is_removed_from_single_answers_lists_and_recall_without_touching_literal_names() {
    let answer = json!({"id":"command.help.string_string","args":[{"kind":"string","value":"S"},{"kind":"term","value":"help.save"}],"text":"S: save the game"});
    let entry = json!({"id":"ui.help.entry","args":[{"kind":"string","value":"S"},{"kind":"term","value":"help.save"}],"text":"S: save the game"});
    let recall = json!({"id":"command.command.string","args":[{"kind":"entity","value":{"type":"message","id":answer["id"],"args":answer["args"]}}],"text":"S: save the game"});
    let mut history = History::default();
    for message in [answer.clone(), entry.clone(), recall] {
        assert!(crate::log_visibility::removed_guidance(&message));
        history.message(message);
    }
    assert!(history.entries.is_empty());
    let literal = json!({"id":"command.call.called","args":[{"kind":"string","value":"help.save"}],"text":"called help.save"});
    assert!(!crate::log_visibility::removed_guidance(&literal));
    let mut c = boot(); start(&mut c);
    c.request(json!({"type":"worker","generation":1,"data":{"type":"frame","width":3,"height":3,"cells":"   .@.   ","player":{"x":1,"y":1},"map_cells":"   .@.   ","map_tiles":[0,0,0,1,8,1,0,0,0],"map_tile_ids":&rogue_display::map_tiles::IDS[..],"map_unknown_glyphs":[],"ui":{"mode":"help","input":{"kind":"space"},"message":answer,"window":{"kind":"help","message":answer},"lines":[entry,literal]}}}));
    let state=c.snapshot();
    assert_eq!(state["presentation"]["lines"].as_array().unwrap().len(), 1);
    assert_eq!(state["presentation"]["message"], Value::Null);
    assert_eq!(state["presentation"]["window"]["message"], Value::Null);
}

#[test]
fn initial_map_mode_uses_tiles_then_saved_selection_then_explicit_url() {
    for saved in [None, Some("ascii"), Some("pixels"), Some("tiles")] {
        for url in [None, Some("ascii"), Some("pixels"), Some("tiles"), Some("invalid")] {
            let mut c = Controller::new(measure);
            let r = c.request(json!({"type":"boot",
                "preference":saved.map(|mode|json!({"version":1,"mode":mode,"zoom":47.5}).to_string()),
                "environment":{"isolated":true,"parameters":{"view":url}}}));
            let expected = url.filter(|value| mode(value)).or(saved).unwrap_or("tiles");
            assert_eq!(r["state"]["displayMode"], expected);
            assert_eq!(r["state"]["tileSize"], if saved.is_some() { 47.5 } else { 32. });
        }
    }
}

#[test]
fn retired_autowalk_timer_is_ignored_while_new_target_waits_for_manual_input() {
    let mut c=boot();start(&mut c);
    let mut cells=vec![b'.';80*24];cells[10*80+10]=b'@';
    let cells=String::from_utf8(cells).unwrap();
    let mut tiles=vec![1;80*24];tiles[10*80+10]=8;
    let frame=json!({"type":"frame","width":80,"height":24,"cells":cells,"map_cells":cells,
        "player":{"x":10,"y":10},"map_tiles":tiles,"map_tile_ids":&rogue_display::map_tiles::IDS[..],"map_unknown_glyphs":[],
        "map_actor_epoch":1,"map_actor_step":0,"map_actors":[{"id":0,"x":10,"y":10,"glyph":64}],"map_actor_events":[],
        "ui":{"mode":"game","input":{"kind":"command"}}});
    c.request(json!({"type":"worker","generation":1,"data":frame}));
    c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    let r=c.request(json!({"type":"render","view":{"width":1240,"height":900}}));
    let camera=&r["diagnostics"]["camera"];let rect=&r["diagnostics"]["mapRect"];
    let x=rect["x"].as_f64().unwrap()+18.5*camera["size"].as_f64().unwrap()-camera["left"].as_f64().unwrap();
    let y=rect["y"].as_f64().unwrap()+9.5*camera["cellH"].as_f64().unwrap()-camera["top"].as_f64().unwrap();
    let target=|c:&mut Controller| {
        event(c,json!({"type":"down","id":1,"x":x,"y":y,"button":0,"primary":true,"pointerType":"mouse"}));
        event(c,json!({"type":"up","id":1,"x":x,"y":y,"hasCapture":true,"pointerType":"mouse"}))
    };
    let initial=target(&mut c);let token=initial["state"]["autowalk"]["scheduled"]["token"].clone();assert!(token.is_u64());
    // The physical key is queued, but the Worker has not supplied its next wait.
    event(&mut c,json!({"type":"enqueue","events":[108]}));
    let next=target(&mut c);assert_eq!(next["state"]["autowalk"]["active"],true);
    assert!(next["state"]["autowalk"]["scheduled"].is_null());
    let late=event(&mut c,json!({"type":"autowalk-tick","generation":1,"token":token}));
    assert_eq!(late["state"]["autowalk"]["active"],true);
    assert!(late["effects"].as_array().unwrap().iter().all(|e|e["kind"]!="queue"));
    let ready=c.request(json!({"type":"worker","generation":1,"data":{"type":"input-request"}}));
    assert!(ready["state"]["autowalk"]["scheduled"]["token"].is_u64());
}

#[test]
fn handedness_switch_persists_defaults_and_never_sends_game_input() {
    for raw in [r#"{"version":1,"mode":"tiles","zoom":32}"#,
        r#"{"version":1,"mode":"tiles","zoom":32,"handedness":"unknown"}"#,
        r#"{"version":1,"mode":"tiles","zoom":32,"handedness":false}"#] {
        assert_eq!(preference(raw)["handedness"], "right");
    }
    let mut c=boot();start(&mut c);
    assert_eq!(c.snapshot()["handedness"], "right");
    let r=event(&mut c,json!({"type":"invoke","id":"handedness-toggle"}));
    assert_eq!(r["state"]["handedness"], "left");
    assert!(!r["effects"].as_array().unwrap().iter().any(|e|e["kind"]=="queue"));
    let stored=r["effects"].as_array().unwrap().iter().find(|e|e["kind"]=="storage-write").unwrap();
    assert_eq!(stored["key"], "rogue-map-display-v1");
    let mut restored=Controller::new(measure);
    let r=restored.request(json!({"type":"boot","environment":{"isolated":true,"parameters":{}},"preference":stored["value"]}));
    assert_eq!(r["state"]["handedness"], "left");
    assert_eq!(event(&mut c,json!({"type":"invoke","id":"handedness-toggle"}))["state"]["handedness"], "right");
}
