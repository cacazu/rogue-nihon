use super::*;

#[test]
fn mobile_log_subjects_only_hide_semantic_player_prefixes() {
    fn entry(message: Value) -> Value {
        let text = crate::display::message_language(s(&message["id"]), &message["args"], "", "ja");
        assert!(text.missing_ids.is_empty());
        json!({"message":message,"text":text.text})
    }
    fn text(ui: &BrowserUi, entry: &Value, mobile: bool) -> String {
        ui.log_runs(entry, mobile).iter().map(|run| s(&run["text"])).collect()
    }
    fn part(id: &str, args: Value) -> Value {
        json!({"kind":"part","value":{"id":id,"args":args}})
    }
    let mut ui = BrowserUi::new(measure);
    ui.model = model();
    let item = json!({"kind":"entity","value":{"type":"item","category":"weapon","which":2,"count":1,"identified":false}});
    for (prefix, body, args, expected) in [
        ("armor.wear.you_are_now", "armor.wear.wearing", json!([item.clone()]), "短弓を身につけた。"),
        ("weapons.wield.you_are_now", "weapons.wield.wielding", json!([item.clone(),{"kind":"signed","value":99}]), "短弓を構えた。"),
        ("pack.move_msg.you", "pack.move_msg.moved_onto", json!([item.clone()]), "短弓の上に移動した。"),
        ("fight.killed.you_have", "fight.killed.defeated_trailing_space", json!([]), "倒した敵：ホブゴブリン"),
    ] {
        let mut parts = vec![part(prefix, json!([])), part(body, args)];
        if prefix == "fight.killed.you_have" {
            parts.push(part("message.entity",json!([{"kind":"entity","value":{"type":"monster","display":"name","index":7}}])));
        }
        let message = json!({"id":"message.sequence","args":parts});
        let e = entry(message.clone());
        assert_eq!(text(&ui,&e,true), expected, "{prefix}");
        assert_eq!(text(&ui,&e,false), s(&e["text"]));
        assert_eq!(e["message"], message);
        let recalled = entry(json!({"id":"command.command.string","args":[{"kind":"entity","value":{"type":"message","id":"message.sequence","args":parts}}]}));
        assert_eq!(text(&ui,&recalled,true),expected,"nested {prefix}");
    }
    for (hit,index,expected) in [
        (true,0,"ホブゴブリンに痛烈な一撃を与えた"),
        (true,2,"ホブゴブリンに傷を負わせた"),
        (true,3,"振りかぶり、ホブゴブリンに攻撃を当てた"),
        (false,1,"振りかぶったが、ホブゴブリンには当たらなかった"),
        (true,1,"あなたの攻撃がホブゴブリンに命中した"),
    ] {
        let parts = json!([
            part("message.entity",json!([{"kind":"entity","value":{"type":"monster","display":"you","role":"subject"}}])),
            part("message.entity",json!([{"kind":"entity","value":{"type":"combat_verb","hit":hit,"index":index}}])),
            part("message.entity",json!([{"kind":"entity","value":{"type":"monster","display":"name","index":7,"role":"object"}}]))
        ]);
        let e = entry(json!({"id":"message.sequence","args":parts}));
        assert_eq!(text(&ui,&e,true),expected);
        assert_eq!(text(&ui,&e,false),s(&e["text"]));
        let recalled = entry(json!({"id":"command.command.string","args":[{"kind":"entity","value":{"type":"message","id":"message.sequence","args":parts}}]}));
        assert_eq!(text(&ui,&recalled,true),expected);
    }
    for literal in ["あなたはという名前", "あなたがという名前"] {
        let e = entry(json!({"id":"message.entity","args":[{"kind":"entity","value":{"type":"literal","text":literal}}]}));
        assert_eq!(text(&ui,&e,true),literal);
    }
    let enemy = entry(json!({"id":"message.entity","args":[{"kind":"entity","value":{"type":"combat","hit":true,"index":0,
        "actor":{"type":"monster","display":"name","index":7},"target":{"type":"monster","display":"you"}}}]}));
    assert_eq!(text(&ui,&enemy,true),s(&enemy["text"]));
    ui.model["language"] = json!("en");
    let message = json!({"id":"message.sequence","args":[part("armor.wear.you_are_now",json!([])),part("armor.wear.wearing",json!([item]))]});
    let english = crate::display::message_language("message.sequence",&message["args"],"","en").text;
    let e = json!({"message":message,"text":english});
    assert_eq!(text(&ui,&e,true),english);
}

fn measure(text: &str, size: f64, _bold: bool, _mono: bool) -> TextSize {
    TextSize {
        width: text
            .chars()
            .map(|c| if c.is_ascii() { size * 0.55 } else { size })
            .sum(),
        ascent: 0.,
        descent: size,
    }
}
fn model() -> Value {
    json!({"language":"ja","running":true,"ready":true,"displayMode":"pixels","tileSize":32,"frame":{"width":80,"height":24,"player":{"x":10,"y":10},"ui":{"name":"勇者","status":{"args":[{"value":1},{"value":0},{"value":12},{"value":12},{"value":16},{"value":16},{"value":6},{"value":1},{"value":0},{"value":"status.hunger.0"}]}}}})
}
fn view(width: f64, height: f64) -> Value {
    json!({"width":width,"height":height,"inputs":{}})
}
fn click(ui: &mut BrowserUi, id: &str) -> Value {
    let control = ui.widgets.controls.iter().find(|c| c.id == id).unwrap();
    let x = control.rect.x + control.rect.w / 2.;
    let y = control.rect.y + control.rect.h / 2.;
    ui.event(
        json!({"type":"down","id":1,"x":x,"y":y,"pointerType":"touch","button":0,"primary":true}),
    );
    ui.event(json!({"type":"up","id":1,"x":x,"y":y,"pointerType":"touch","captured":true}))
}
#[test]
fn desktop_and_phone_share_status_rows_gauges_and_icon_colors() {
    let mut desktop = BrowserUi::new(measure);
    let pc = desktop.render(model(), view(1400., 1050.));
    let mut phone = BrowserUi::new(measure);
    let mobile = phone.render(model(), view(484., 844.));
    assert_eq!(pc["diagnostics"]["hud"], mobile["diagnostics"]["hud"]);
    for (width, height, fullscreen) in [(700.,900.,false),(1240.,900.,false),(1240.,900.,true),(844.,390.,true)] {
        let mut ui = BrowserUi::new(measure);
        let mut v = view(width, height); v["fullscreen"] = json!(fullscreen);
        let output = ui.render(model(), v);
        let h = &output["diagnostics"]["hud"];
        assert_eq!(array(&h["rows"]).len(), 2);
        assert_eq!(h["row"]["h"], 48.);
        assert_eq!(h["hp"]["rect"]["x"], h["experience"]["rect"]["x"]);
        assert_eq!(h["hp"]["rect"]["w"], h["experience"]["rect"]["w"]);
        assert_eq!(h["hp"]["label"]["text"], "12/12");
        assert_eq!(h["experience"]["label"]["text"], "1");
        assert_eq!(h["items"]["strength"]["text"], "16");
        assert_eq!(h["items"]["depth"]["text"], "-1");
        let row: Rect = serde_json::from_value(h["row"].clone()).unwrap();
        for id in ["settings-toggle", "header-fullscreen"] {
            let c = ui.widgets.controls.iter().find(|c| c.id == id).unwrap();
            assert!(!c.rect.overlaps(row));
            assert_eq!(c.rect.y + c.rect.h / 2., row.y + row.h / 2.);
        }
        assert!(ui.widgets.controls.iter().any(|c| c.id == "status-open"));
        assert!(!ui.widgets.controls.iter().any(|c| c.id.starts_with("hud-")));
        assert!(ui.widgets.icons.iter().any(|i| i["glyph"] == "💪"));
        assert!(ui.widgets.icons.iter().any(|i| i["glyph"] == "👑"));
        assert!(!array(&output["commands"]).iter().any(|c| c["op"] == "box" && c["rect"] == h["row"]));
    }
}
#[test]
fn status_click_and_escape_are_local_on_desktop_and_phone() {
    for width in [390., 1400.] {
        let mut ui = BrowserUi::new(measure);
        ui.render(model(), view(width, 844.));
        let clicked = click(&mut ui, "status-open");
        assert!(array(&clicked["effects"]).iter().all(|e| e["kind"] != "send"));
        let output = ui.render(model(), view(width, 844.));
        assert_eq!(output["diagnostics"]["scope"], "status");
        assert!(ui.widgets.text_runs.iter().any(|t| t["text"] == "16 / 16"));
        let escape = ui.event(json!({"type":"key","key":"Escape"}));
        assert_eq!(escape["consumed"], true);
        assert!(array(&escape["effects"]).is_empty());
        assert_eq!(ui.render(model(),view(width,844.))["diagnostics"]["scope"], "game");
    }
}
#[test]
fn canceled_or_moved_press_never_activates_a_button() {
    let mut ui = BrowserUi::new(measure);
    ui.render(model(), view(390., 844.));
    let r = ui
        .widgets
        .controls
        .iter()
        .find(|c| c.id == "settings-toggle")
        .unwrap()
        .rect;
    ui.event(json!({"type":"down","id":4,"x":r.x+10.,"y":r.y+10.,"button":0,"primary":true}));
    ui.event(json!({"type":"cancel","id":4}));
    assert!(array(&ui.event(json!({"type":"up","id":4,"x":r.x+10.,"y":r.y+10.,"captured":true}))["effects"]).is_empty());
    ui.event(json!({"type":"down","id":5,"x":r.x+10.,"y":r.y+10.,"button":0,"primary":true}));
    ui.event(json!({"type":"move","id":5,"x":r.x+30.,"y":r.y+10.,"buttons":1,"captured":true}));
    let up = ui.event(json!({"type":"up","id":5,"x":r.x+10.,"y":r.y+10.,"captured":true}));
    assert!(array(&up["effects"]).iter().all(|e| e["kind"] != "invoke"));
}
#[test]
fn modal_keys_and_composition_are_isolated_from_the_game() {
    let mut ui = BrowserUi::new(measure);
    let mut m = model();
    m["settingsOpen"] = json!(true);
    ui.render(m, view(390., 844.));
    let arrow = ui.event(json!({"type":"key","key":"ArrowDown"}));
    assert_eq!(arrow["consumed"], true);
    assert!(array(&arrow["effects"]).is_empty());
    let composition = ui.event(json!({"type":"key","key":"Enter","composing":true}));
    assert_eq!(composition["consumed"], false);
    assert!(array(&composition["effects"]).is_empty());
    let escape = ui.event(json!({"type":"key","key":"Escape"}));
    assert_eq!(
        escape["effects"][0],
        json!({"kind":"invoke","id":"settings-close"})
    );
}

#[test]
fn raw_keys_preserve_scalar_and_modifier_contract() {
    use rogue_contract::*;
    let mut ui = BrowserUi::new(measure);
    let output=ui.event(json!({"type":"raw-key","key":"ArrowUp","shiftKey":true,"ctrlKey":true,"altKey":true,"repeat":true}));
    assert_eq!(
        output["raw"],
        json!(RG_KEY_UP | RG_EVENT_SHIFT | RG_EVENT_CTRL | RG_EVENT_ALT | RG_EVENT_REPEAT)
    );
    assert_eq!(
        ui.event(json!({"type":"raw-key","key":"勇"}))["raw"],
        json!('勇' as u32)
    );
    assert!(ui.event(json!({"type":"raw-key","key":"F12"}))["raw"].is_null());
}

#[test]
fn hud_is_reusable_without_a_browser_surface() {
    let mut hud = hud::HudWidget::default();
    let mut widgets = Widgets::default();
    let m = model();
    hud.draw(
        &mut widgets,
        hud::HudData {
            map: Rect::new(0., 0., 320., 500.),
            name: "別の画面",
            status: &m["frame"]["ui"]["status"],
            offset: 0.,
            label: &|id| id.to_string(),
        },
        measure,
    );
    assert_eq!(array(&hud.layout["items"]).len(), 8);
    assert_eq!(hud.layout["items"][2]["text"], "12/12");
    assert!(widgets.controls.iter().all(|c| c.id != "settings-toggle"));
    assert_eq!(hud.layout["nameRect"]["y"], hud.layout["row"]["y"]);
}

#[test]
fn status_swipe_reveals_large_values_without_opening_or_sending_commands() {
    let mut ui = BrowserUi::new(measure);
    let mut m = model();
    for i in [1,2,3,4,5,6] { m["frame"]["ui"]["status"]["args"][i]["value"] = json!(2147483647); }
    ui.render(m.clone(),view(700.,844.));
    assert!(n(&ui.hud.layout["maxScroll"]) > 0.);
    let row: Rect = serde_json::from_value(ui.hud.layout["row"].clone()).unwrap();
    let x = row.x + row.w - 30.; let y = row.y + row.h / 2.;
    ui.event(json!({"type":"down","id":8,"x":x,"y":y,"pointerType":"touch","button":0,"primary":true}));
    let moved = ui.event(json!({"type":"move","id":8,"x":x-120.,"y":y,"pointerType":"touch","buttons":1,"captured":true}));
    assert!(array(&moved["effects"]).iter().all(|e| e["kind"] != "send"));
    ui.event(json!({"type":"up","id":8,"x":x-120.,"y":y,"pointerType":"touch","captured":true}));
    let output = ui.render(m,view(700.,844.));
    assert!(n(&ui.hud.layout["offset"]) > 0.);
    assert_eq!(output["diagnostics"]["scope"], "game");
}
#[test]
fn settings_blocks_game_input_before_the_next_repaint() {
    let mut ui = BrowserUi::new(measure);
    let mut m = model();
    m["frame"]["ui"]["mode"] = json!("game");
    ui.render(m.clone(), view(390., 844.));
    m["settingsOpen"] = json!(true);
    ui.set_context(m);
    let event = ui.event(json!({"type":"key","key":"h"}));
    assert_eq!(event["consumed"], true);
    assert!(array(&event["effects"]).is_empty());
}

#[test]
fn mobile_game_shows_two_status_rows_and_hunger_warnings() {
    let mut ui = BrowserUi::new(measure);
    for (hunger, color) in [(0, "#a6d0be"), (1, "#efd18e"), (2, "#ffb4a5"), (3, "#ffb4a5")] {
        let mut m = model();
        m["frame"]["ui"]["status"]["args"][9]["value"] = json!(format!("status.hunger.{hunger}"));
        let output = ui.render(m, view(390., 844.));
        assert_eq!(
            output["diagnostics"]["hud"]["metrics"],
            json!(["depth", "hp", "strength", "hunger", "level", "experience", "armor", "gold"])
        );
        let icon = ui
            .widgets
            .icons
            .iter()
            .find(|icon| icon["name"] == "food")
            .unwrap();
        assert!(
            array(&output["commands"])
                .iter()
                .any(|command| command["op"] == "path"
                    && command["rect"] == icon["rect"]
                    && command["color"] == color)
        );
        assert!(!ui.regions.contains_key("log"));
    }
}

#[test]
fn mobile_top_uses_controller_state_and_never_draws_a_game_map() {
    let mut ui = BrowserUi::new(measure);
    let mut m = model();
    m["topOpen"] = json!(true);
    m["running"] = json!(false);
    m["saved"] = json!(false);
    m["frame"] = Value::Null;
    for (width, height) in [(390., 844.), (320., 568.), (844., 390.)] {
        let mut surface = view(width, height);
        surface["coarse"] = json!(true);
        let output = ui.render(m.clone(), surface);
        assert_eq!(output["diagnostics"]["scope"], "top");
        assert!(output["diagnostics"]["mapRect"].is_null());
        assert!(
            array(&output["commands"])
                .iter()
                .any(|c| c["text"] == "ROGUE")
        );
        assert!(!ui.regions.contains_key("map"));
        assert!(
            !ui.widgets
                .controls
                .iter()
                .any(|c| c.id.starts_with("touch-"))
        );
    }
    let button = ui
        .widgets
        .controls
        .iter()
        .find(|c| c.id == "random-seed")
        .unwrap();
    let x = button.rect.x + button.rect.w / 2.;
    let y = button.rect.y + button.rect.h / 2.;
    ui.event(
        json!({"type":"down","id":3,"x":x,"y":y,"pointerType":"touch","button":0,"primary":true}),
    );
    ui.event(json!({"type":"move","id":3,"x":x,"y":100.,"pointerType":"touch","buttons":1,"captured":true}));
    let released =
        ui.event(json!({"type":"up","id":3,"x":x,"y":100.,"pointerType":"touch","captured":true}));
    // The shared vertical form can scroll in a short landscape viewport.
    assert_eq!(ui.scrolls["top"], (y - 100.).max(0.).min(ui.regions["top"].max));
    assert!(
        array(&released["effects"])
            .iter()
            .all(|effect| effect["kind"] != "invoke" && effect["kind"] != "send")
    );
    m["saved"] = json!(true);
    ui.render(m, view(390., 844.));
    assert!(
        ui.widgets
            .controls
            .iter()
            .any(|c| c.id == "load" && !c.disabled)
    );
    assert!(
        array(&click(&mut ui, "load")["effects"]).contains(&json!({"kind":"invoke","id":"load"}))
    );
}

#[test]
fn mobile_keeps_the_fixed_dock_and_uses_contextual_stair_commands() {
    let mut ui = BrowserUi::new(measure);
    ui.mobile_controls = true;
    for (amulet, id, key) in [
        (false, "touch-search", 62),
        (true, "touch-search", 60),
        (false, "touch-search", 62),
    ] {
        let mut m = model();
        m["frame"]["ui"]["mode"] = json!("game");
        m["frame"]["ui"]["input"] = json!({"kind":"command"});
        m["frame"]["ui"]["player_state"] = json!({"amulet":amulet,"levitating":false});
        m["frame"]["ui"]["map_controls"] =
            crate::game_window::map_controls(&m["frame"]["ui"], true);
        ui.mobile_operations = false;
        ui.render(m.clone(), view(390., 844.));
        for dock_id in ["mobile-movement", "touch-action-action.inventory", "touch-search", "mobile-full-map", "mobile-operations", "touch-again"] {
            assert!(ui.widgets.controls.iter().any(|control| control.id == dock_id));
        }
        assert!(!ui.widgets.controls.iter().any(|control| matches!(control.id.as_str(), "touch-ascend" | "touch-action-action.descend")));
        let control = ui.widgets.controls.iter().find(|control| control.id == id).unwrap();
        assert_eq!(control.rect.h, 52.);
        assert!(!control.disabled);
        let event = click(&mut ui, id);
        let sends: Vec<_> = array(&event["effects"])
            .iter()
            .filter(|effect| effect["kind"] == "send")
            .cloned()
            .collect();
        assert_eq!(sends, vec![json!({"kind":"send","key":key})]);
    }
}


#[test]
fn selection_shortcuts_cover_every_game_window_input_kind() {
    for (width, coarse) in [(1400., false), (600., false), (390., true)] {
        for language in ["ja", "en"] {
            for kind in ["space", "space_cancel", "enter", "item", "direction", "text", "symbol", "help", "discovery", "hand", "confirm", "option_bool", "option_inventory"] {
                let mut m = model();
                m["language"] = json!(language);
                m["input"] = json!({"kind":kind,"id":"input.test"});
                m["frame"]["ui"]["mode"] = json!("game");
                m["frame"]["ui"]["input"] = m["input"].clone();
                m["frame"]["ui"]["lines"] = json!([]);
                let window = crate::game_window::render(&m["frame"]["ui"], language);
                m["frame"]["ui"]["window"] = window.clone();
                let mut v = view(width, 1050.);
                v["coarse"] = json!(coarse);
                for action in array(&window["actions"]) {
                    let key = n(&action["key"]) as u32;
                    let mut ui = BrowserUi::new(measure);
                    ui.render(m.clone(), v.clone());
                    let id = format!("window-{key}");
                    let control = ui.widgets.controls.iter().find(|c| c.id == id).unwrap().clone();
                    assert_eq!(control.shortcut.is_some(), !coarse, "{width} {language} {kind} {id}");
                    if let Some(shortcut) = &control.shortcut {
                        let hint = Widgets::shortcut_hint(shortcut);
                        if shortcut == "Enter" { assert_eq!(hint, "Enter", "Use the supported key name in every window"); }
                        assert!(control.label.starts_with(&format!("{hint}) ")));
                        assert!(ui.widgets.text_runs.iter().any(|run| s(&run["text"]) == control.label || s(&run["text"]) == hint), "painted {kind} {id}");
                        let result = ui.event(json!({"type":"key","key":shortcut}));
                        assert_eq!(result["consumed"], true, "{kind} {id}");
                        assert!(array(&result["effects"]).iter().any(|effect| *effect == control.action), "same control action {kind} {id}: {result}");
                    }
                }
                if matches!(kind, "text" | "symbol" | "help" | "discovery") {
                    let mut ui = BrowserUi::new(measure);
                    ui.render(m.clone(), v.clone());
                    let field = if kind == "text" { "prompt-text" } else { "command-key" };
                    // Help/discovery fields are intentionally omitted on a phone.
                    if !coarse || matches!(kind,"text"|"symbol") {
                        for key in ["a", "b", "c", " "] {
                            let result = ui.event(json!({"type":"key","key":key,"native":field}));
                            assert_eq!(result["consumed"], false);
                            assert!(array(&result["effects"]).is_empty());
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn selection_shortcuts_reject_stale_context_modifiers_and_disabled_controls() {
    let mut m = model();
    m["input"] = json!({"kind":"confirm","id":"input.test"});
    m["frame"]["ui"]["input"] = m["input"].clone();
    m["frame"]["ui"]["window"] = crate::game_window::render(&m["frame"]["ui"], "ja");
    for modifier in ["ctrlKey", "altKey", "metaKey", "composing"] {
        let mut ui = BrowserUi::new(measure); ui.render(m.clone(),view(1400.,900.));
        let mut event = json!({"type":"key","key":"a"}); event[modifier] = json!(true);
        let result = ui.event(event);
        assert!(!array(&result["effects"]).iter().any(|e| e["key"] == 121), "{modifier}");
    }
    let mut ui = BrowserUi::new(measure); ui.render(m.clone(),view(1400.,900.));
    ui.widgets.controls.iter_mut().find(|c| c.id == "window-121").unwrap().disabled = true;
    assert!(!array(&ui.event(json!({"type":"key","key":"a"}))["effects"]).iter().any(|e| e["key"] == 121));
    ui.render(m.clone(),view(1400.,900.));
    ui.model["input"]["id"] = json!("input.changed-before-paint");
    assert!(!array(&ui.event(json!({"type":"key","key":"a"}))["effects"]).iter().any(|e| e["key"] == 121));
    ui.render(m,view(1400.,900.));
    ui.model["settingsOpen"] = json!(true);
    assert!(array(&ui.event(json!({"type":"key","key":"a"}))["effects"]).is_empty());
}

#[test]
fn selection_shortcuts_keep_enter_and_space_on_the_tab_focused_choice() {
    for key in ["Enter", " "] {
        let mut m = model(); m["input"] = json!({"kind":"text"});
        m["frame"]["ui"]["input"] = m["input"].clone();
        m["frame"]["ui"]["window"] = crate::game_window::render(&m["frame"]["ui"], "ja");
        let mut ui = BrowserUi::new(measure); ui.render(m,view(1400.,900.));
        ui.widgets.focus = "window-27".into();
        let result = ui.event(json!({"type":"key","key":key}));
        assert_eq!(result["effects"],json!([{"kind":"invoke","id":"window-close"}]));
    }
}


#[test]
fn selection_shortcuts_stay_on_controls_without_duplicate_instructions() {
    for language in ["ja", "en"] {
        for (kind, expected) in [
            ("confirm", vec![(121,"a"),(110,"b")]),
            ("hand", vec![(108,"a"),(114,"b")]),
            ("option_bool", vec![(116,"a"),(102,"b"),(13,"c"),(45,"d")]),
            ("option_inventory", vec![(111,"a"),(115,"b"),(99,"c"),(13,"d"),(45,"e")]),
        ] {
            let mut m=model();m["language"]=json!(language);m["input"]=json!({"kind":kind});
            m["frame"]["ui"]["input"]=m["input"].clone();
            m["frame"]["ui"]["window"]=crate::game_window::render(&m["frame"]["ui"],language);
            let mut ui=BrowserUi::new(measure);ui.render(m,view(1400.,1050.));
            let painted=ui.widgets.text_runs.iter().map(|run| s(&run["text"])).collect::<String>();
            assert!(!painted.contains("選択キー")&&!painted.contains("Choice keys"));
            for (key,alias) in expected {
                let control=ui.widgets.controls.iter().find(|control|control.id==format!("window-{key}")).unwrap();
                assert_eq!(control.shortcut.as_deref(),Some(alias));
                assert!(painted.matches(&control.label).count() <= 1,"one caption per choice: {kind} {painted}");
                assert!(!control.label.contains('（')&&!control.label.contains('('),"no second key inside {control:?}");
            }
            for obsolete in ["Y：","N：","L：","R：","T：","F：","O：","S：","C：","Y:","N:","L:","R:","T:","F:","O:","S:","C:"] {
                assert!(!painted.contains(obsolete),"old key {obsolete} in {painted}");
            }
            assert!(ui.widgets.controls.iter().any(|control| control.shortcut.as_deref()==Some("Escape")));
        }
    }
}

#[test]
fn selection_shortcuts_project_semantic_questions_in_dialog_logs_and_recall_only() {
    let mut ui=BrowserUi::new(measure);ui.model=model();
    for (id, expected) in [
        ("main.quit.really_quit","本当に終了する？"),
        ("rings.gethand.left_hand_or_right_hand","左手と右手、どちらにする？"),
        ("rings.gethand.left_or_right_ring","左右どちらの指輪？"),
        ("save.save_game.file_exists_do_you_wish_to_overwrite_it","ファイルがすでにある。上書きする？"),
        ("save.save_game.save_file","「Y/N (L)」に保存する？"),
    ] {
        let args=json!([{"kind":"string","value":"Y/N (L)"}]);
        let original=crate::display::message_language(id,&args,"","ja").text;
        let message=json!({"id":id,"args":args,"text":original});
        assert_eq!(ui.dialog_message_text(&message),expected);
        for wrapped in [message.clone(),json!({"id":"command.command.string","args":[{"kind":"entity","value":{"type":"message","id":id,"args":args}}]})] {
            let text=crate::display::message_language(s(&wrapped["id"]),&wrapped["args"],"","ja").text;
            let entry=json!({"message":wrapped,"text":text});
            for mobile in [false,true] { assert_eq!(ui.log_runs(&entry,mobile).iter().map(|run|s(&run["text"])).collect::<String>(),expected); }
            assert_eq!(entry["message"],wrapped,"source event stays unchanged");
        }
    }
    let literal=json!({"id":"ui.text","args":[{"kind":"string","value":"Y/N (L) T: F: 本当に終了する？（y/n）"}]});
    let text=crate::display::message_language("ui.text",&literal["args"],"","ja").text;
    let entry=json!({"message":literal,"text":text});
    assert_eq!(ui.log_runs(&entry,false).iter().map(|run|s(&run["text"])).collect::<String>(),text);
}

#[test]
fn direction_wait_uses_a_dialog_when_the_optional_map_pad_is_hidden() {
    for (width, coarse) in [(1400., false), (390., true)] {
        let mut m = model();
        m["input"] = json!({"kind":"direction","id":"input.choose_direction"});
        m["frame"]["ui"]["input"] = m["input"].clone();
        m["frame"]["ui"]["mode"] = json!("game");
        m["frame"]["ui"]["movement_direction"] = json!(true);
        m["frame"]["ui"]["window"] = Value::Null;
        m["frame"]["ui"]["map_controls"] = crate::game_window::map_controls(&m["frame"]["ui"], false);
        let mut v = view(width, 1050.); v["coarse"] = json!(coarse);
        let mut ui = BrowserUi::new(measure);
        ui.render(m.clone(), v.clone()); // initialize the current generation
        ui.mobile_controls = false;
        ui.render(m.clone(), v.clone());
        assert!(ui.regions.contains_key("dialog"));
        for key in [121,107,117,104,108,98,106,110,27] {
            assert!(ui.widgets.controls.iter().any(|c| c.id == format!("window-{key}") && !c.disabled));
        }
        let rect = |key| ui.widgets.controls.iter().find(|c| c.id == format!("window-{key}")).unwrap().rect;
        assert_eq!(rect(121).x, rect(104).x);
        assert_eq!(rect(104).x, rect(98).x);
        assert_eq!(rect(107).x, rect(106).x);
        assert_eq!(rect(117).x, rect(108).x);
        assert_eq!(rect(108).x, rect(110).x);
        assert_eq!(rect(121).y, rect(107).y);
        assert_eq!(rect(104).y, rect(108).y);
        assert_eq!(rect(98).y, rect(106).y);
        assert!(rect(98).y > rect(104).y);
        for (key, code, raw) in [
            ("PageUp", "PageUp", rogue_contract::RG_KEY_PAGE_UP),
            ("PageDown", "PageDown", rogue_contract::RG_KEY_PAGE_DOWN),
            ("PageUp", "Numpad9", rogue_contract::RG_KEY_PAGE_UP),
            ("PageDown", "Numpad3", rogue_contract::RG_KEY_PAGE_DOWN),
        ] {
            let result = ui.event(json!({"type":"key","key":key,"code":code}));
            assert!(array(&result["effects"]).iter().any(|effect| effect["kind"] == "send" && effect["key"] == raw));
        }
        ui.set_context(m.clone()); // input synchronization must retain this projection
        assert!(ui.model["frame"]["ui"]["window"].is_object());
        ui.mobile_controls = true;
        ui.render(m, v);
        assert!(ui.widgets.controls.iter().any(|c| c.id == "touch-l"));
        assert!(!ui.widgets.controls.iter().any(|c| c.id == "window-108"));
    }
}

#[test]
fn item_list_shortcut_and_button_use_the_same_original_key() {
    for id in ["input.choose_item", "input.choose_item_list", "input.inventory_one"] {
        let mut m = model();
        m["input"] = json!({"kind":"item","id":id,"action":"action.identify"});
        m["frame"]["ui"]["input"] = m["input"].clone();
        m["frame"]["ui"]["mode"] = json!("game");
        m["frame"]["ui"]["window"] = crate::game_window::render(&m["frame"]["ui"], "ja");
        assert_eq!(m["frame"]["ui"]["window"]["title"], if id == "input.choose_item_list" { "識別するアイテムの一覧" } else { "識別するアイテムを選択" });
        let mut ui = BrowserUi::new(measure); ui.render(m, view(1400.,1050.));
        assert_eq!(ui.widgets.controls.iter().any(|c| c.id == "window-42"), id != "input.inventory_one");
        if id != "input.inventory_one" {
            let star = ui.widgets.controls.iter().find(|c| c.id == "window-42").unwrap();
            assert_eq!(star.shortcut.as_deref(), Some("*"));
            let effect = star.action.clone();
            assert!(array(&ui.event(json!({"type":"key","key":"*","code":"NumpadMultiply"}))["effects"]).contains(&effect));
        }
    }
}


#[test]
fn death_tombstone_wraps_public_content_and_does_not_restyle_rankings() {
    let ids = ["rest", "in", "peace", "name", "gold", "killed_by", "cause", "year"];
    for (width, height) in [(320., 720.), (390., 844.), (1400., 1050.)] {
        let values = ["ここに", "安らかに", "眠る", "長い名前の冒険者あいうえおかきくけこ",
            "所持金：12345678G", "死因：", "非常に長い名前のモンスターあいうえお", "2026年"];
        let lines: Vec<_> = ids.iter().zip(values).enumerate().map(|(i, (id, text))|
            json!({"scope":"tombstone","id":format!("ui.ending.{id}"),"row":i,"text":text})).collect();
        let mut m = model();
        m["input"] = json!({"kind":"enter","id":"input.show_score"});
        // C publishes the score acknowledgement before the tombstone disappears.
        m["frame"]["ui"]["mode"] = json!("score");
        m["frame"]["ui"]["input"] = m["input"].clone();
        m["frame"]["ui"]["lines"] = json!(lines);
        m["frame"]["ui"]["window"] = crate::game_window::render(&m["frame"]["ui"], "ja");
        let mut ui = BrowserUi::new(measure);
        let output = ui.render(m.clone(), view(width, height));
        assert_eq!(array(&output["commands"]).iter().filter(|c| c["op"] == "text" && b(&c["mono"]) && s(&c["text"]).contains("___________________")).count(), 1);
        let public_text: String = array(&output["commands"]).iter().filter(|c| c["op"] == "text" && !b(&c["mono"]))
            .map(|c| s(&c["text"])).collect();
        for value in values { assert!(public_text.contains(value), "{width}: {value}"); }
        let dialog = ui.regions["dialog"].rect;
        for c in array(&output["commands"]).iter().filter(|c| c["op"] == "text" && !b(&c["mono"]) && n(&c["y"]) >= dialog.y && n(&c["y"]) <= dialog.y + dialog.h) {
            let ink = measure(s(&c["text"]), n(&c["size"]), b(&c["bold"]), false);
            assert!(n(&c["x"]) >= dialog.x && n(&c["x"]) + ink.width <= dialog.x + dialog.w + 0.01);
        }
        m["frame"]["ui"]["lines"] = json!([{"scope":"score","id":"ui.score.heading","text":"順位  スコア  名前"}]);
        let output = ui.render(m, view(width, height));
        assert!(!array(&output["commands"]).iter().any(|c| c["op"] == "text" && b(&c["mono"]) && s(&c["text"]).contains("___________________")));
    }
}

#[test]
fn repeated_wait_keys_pause_until_release_cancellation_or_another_action() {
    let mut m = model(); m["input"] = json!({"kind":"command"});
    let mut ui = BrowserUi::new(measure); ui.render(m.clone(), view(1240.,900.));
    for (key,code) in [(".","Period"),("5","Numpad5"),("Clear","Numpad5")] {
        ui.event(json!({"type":"key","key":key,"code":code}));
        assert!(!ui.wait_held(), "Single wait keeps its usual animation");
        let r = ui.event(json!({"type":"key","key":key,"code":code,"repeat":true}));
        assert!(r["effects"].as_array().unwrap().iter().any(|e|e["key"] == (46 | rogue_contract::RG_EVENT_REPEAT)));
        assert!(ui.wait_held());
        ui.event(json!({"type":"keyup","key":"Shift","code":"ShiftLeft"}));
        assert!(ui.wait_held());
        ui.event(json!({"type":"keyup","key":key,"code":code}));
        assert!(!ui.wait_held());
        for cancel in [json!({"type":"cancel"}),json!({"type":"key","key":"l"})] {
            ui.event(json!({"type":"key","key":key,"code":code,"repeat":true}));
            assert!(ui.wait_held()); ui.event(cancel); assert!(!ui.wait_held());
        }
    }
}
