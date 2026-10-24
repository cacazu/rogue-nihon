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
    let pc_hud = &pc["diagnostics"]["hud"];
    let mobile_hud = &mobile["diagnostics"]["hud"];
    assert_eq!(n(&pc_hud["row"]["y"]), n(&mobile_hud["row"]["y"]) + 24.);
    for key in ["metrics", "fontSize", "maxScroll"] { assert_eq!(pc_hud[key],mobile_hud[key]); }
    assert!(desktop.widgets.text_runs.iter().any(|run| run["text"] == "勇者"));
    assert!(!phone.widgets.text_runs.iter().any(|run| run["text"] == "勇者"));
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
        m["input"] = m["frame"]["ui"]["input"].clone();
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
fn hidden_pad_uses_pc_overlay_or_phone_dialog_without_changing_direction_keys() {
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
        assert_eq!(ui.regions.contains_key("dialog"),coarse);
        let control_id=|key| if coarse {format!("window-{key}")} else if key==27 {"pc-cancel".into()} else {format!("touch-{}",char::from_u32(key).unwrap())};
        for key in [121,107,117,104,108,98,106,110,27] {
            assert!(ui.widgets.controls.iter().any(|c| c.id == control_id(key) && !c.disabled));
        }
        let rect = |key| ui.widgets.controls.iter().find(|c| c.id == control_id(key)).unwrap().rect;
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
            assert!(array(&result["effects"]).iter().any(|effect| effect["kind"] == "send" && effect["key"] == if coarse {raw}else if key=="PageUp" {117}else{110}));
        }
        ui.set_context(m.clone()); // input synchronization must retain this projection
        assert_eq!(ui.model["frame"]["ui"]["window"].is_object(),coarse);
        ui.mobile_controls = true;
        ui.render(m, v);
        assert!(ui.widgets.controls.iter().any(|c| c.id == "touch-l"));
        assert!(!ui.widgets.controls.iter().any(|c| c.id == "window-108"));
    }
}

#[test]
fn item_selection_has_no_list_button_but_physical_star_remains_a_c_key() {
    for width in [390.,1400.] {
        for id in ["input.choose_item", "input.choose_item_list", "input.inventory_one"] {
            let mut m = model();
            m["input"] = json!({"kind":"item","id":id,"action":"action.identify"});
            m["frame"]["ui"]["input"] = m["input"].clone();
            m["frame"]["ui"]["mode"] = json!("game");
            m["frame"]["ui"]["window"] = crate::game_window::render(&m["frame"]["ui"], "ja");
            assert_eq!(array(&m["frame"]["ui"]["window"]["actions"]).iter().map(|a| n(&a["key"]) as i32).collect::<Vec<_>>(),vec![27]);
            let mut ui = BrowserUi::new(measure); ui.render(m, view(width,1050.));
            assert!(!ui.widgets.controls.iter().any(|c| c.id == "window-42"));
            let result = ui.event(json!({"type":"key","key":"*","code":"NumpadMultiply"}));
            assert!(array(&result["effects"]).iter().any(|e| e["kind"] == "send" && e["key"] == 42));
        }
    }
}

fn selection_model(action: &str, filter: &str, categories: &[&str]) -> Value {
    let mut m=model();
    m["input"]=json!({"kind":"item","id":"input.choose_item","action":action,"filter":filter});
    let input=m["input"].clone();
    let ui=&mut m["frame"]["ui"];
    ui["input"]=input;
    ui["mode"]=json!("game");
    ui["lines"]=json!(categories.iter().enumerate().map(|(i,category)| {
        let key=b'a'+i as u8;
        json!({"scope":"choices","id":"ui.inventory.entry","row":i,"key":(key as char).to_string(),"selectable":true,
            "args":[{"value":key},{"kind":"entity","value":{"type":"item","category":category,"which":0,"count":1,"known":false}}]})
    }).collect::<Vec<_>>());
    ui["window"]=crate::game_window::render(ui,"ja");m
}

#[test]
fn selection_tabs_cover_each_original_purpose_and_preserve_browse_preferences() {
    for (action,filter,categories,tabs) in [
        ("action.wield","weapon",vec!["weapon"],vec!["weapon"]), ("action.wear","armor",vec!["armor"],vec!["armor"]),
        ("action.quaff","potion",vec!["potion"],vec!["potion"]), ("action.read","scroll",vec!["scroll"],vec!["scroll"]),
        ("action.eat","food",vec!["food"],vec!["food"]), ("action.put_ring","ring",vec!["ring"],vec!["ring"]),
        ("action.zap","stick",vec!["stick"],vec!["stick"]), ("action.charge","stick",vec!["stick"],vec!["stick"]),
        ("action.throw","all",vec!["food","weapon","potion"],vec!["all"]),
        ("action.drop","all",vec!["food","weapon","potion"],vec!["all"]),
        ("action.call","callable",vec!["weapon","armor","ring"],vec!["weapon","armor","ring"]),
        ("action.identify","ring-stick",vec!["ring","stick"],vec!["stick","ring"]),
        ("action.identify","weapon",vec!["weapon"],vec!["weapon"]),
        ("action.identify","potion",vec!["potion"],vec!["potion"]),
        ("action.identify","scroll",vec!["scroll"],vec!["scroll"]),
        ("action.identify","armor",vec!["armor"],vec!["armor"]),
        ("action.identify","all",vec!["food","potion","scroll","weapon","armor","ring","stick","amulet"],vec!["all"]),
    ] {
        for count in [0,1,categories.len()] {
            let m=selection_model(action,filter,&categories[..count]);
            let mut ui=BrowserUi::new(measure);
            ui.load_inventory_preference(r#"{"version":1,"tab":"food","positions":{"food":140},"horizontal":31}"#);
            let preference=ui.inventory_preference();
            ui.render(m.clone(),view(1400.,1050.));
            let actual:Vec<_>=ui.widgets.controls.iter().filter_map(|c| c.id.strip_prefix("inventory-tab-")).collect();
            let expected=if filter=="callable" {
                if count==0 { vec!["all"] } else { tabs.iter().copied().filter(|tab| categories[..count].contains(tab)).collect() }
            } else { tabs.clone() };
            assert_eq!(actual,expected,"{action}/{count}");
            assert!(!ui.widgets.controls.iter().any(|c| c.id=="inventory-history" || c.id=="window-42"));
            if count>0 {
                if !ui.widgets.controls.iter().any(|c| c.id.starts_with("item-")) {
                    click(&mut ui,&format!("inventory-tab-{}",categories[0]));
                    ui.render(m.clone(),view(1400.,1050.));
                }
                let key=ui.widgets.controls.iter().find(|c| c.id.starts_with("item-")).unwrap().id.clone();
                let result=click(&mut ui,&key);
                let expected=(key.as_bytes()[5]) as u32;
                assert!(array(&result["effects"]).iter().any(|e| e["kind"]=="send" && e["key"]==expected));
            }
            assert_eq!(ui.inventory_preference(),preference,"selection cannot persist over browsing");
            let mut mobile=BrowserUi::new(measure);let mut phone_view=view(390.,844.);phone_view["coarse"]=json!(true);mobile.render(m,phone_view);
            assert!(!mobile.widgets.controls.iter().any(|c| c.id.starts_with("inventory-tab-")));
        }
    }
}

#[test]
fn choice_filter_metadata_is_not_body_text_and_is_retired_with_choices() {
    let mut presentation=crate::presentation::Presentation::default();
    presentation.update("item_filter",0,0,"ui.text",json!([]),"weapon");
    presentation.update("input",-2,0,"input.choose_item",json!([]),"");
    let ui=presentation.render("ja","");
    assert_eq!(ui["input"]["filter"],"weapon");
    assert!(!array(&ui["lines"]).iter().any(|l| l["scope"]=="item_filter"));
    presentation.update("item_filter",-1,0,"",json!([]),"");
    assert!(presentation.render("ja","")["input"]["filter"].is_null());
    let mut browser=BrowserUi::new(measure);let item=selection_model("action.call","callable",&["weapon","armor"]);
    browser.render(item.clone(),view(1400.,1050.));browser.selection_tabs.tab="armor".into();
    browser.set_context(model());browser.set_context(item.clone());browser.render(item,view(1400.,1050.));
    assert_eq!(browser.selection_tabs.tab,"weapon");
}

#[test]
fn single_item_inquiry_uses_the_common_all_tab_without_changing_browse_state() {
    let mut ui=BrowserUi::new(measure);let mut m=selection_model("","all",&["weapon","armor","food"]);
    m["frame"]["ui"]["input"]["id"]=json!("input.inventory_one");
    let preference=ui.inventory_preference();ui.render(m,view(1400.,1050.));
    let tabs:Vec<_>=ui.widgets.controls.iter().filter_map(|c| c.id.strip_prefix("inventory-tab-")).collect();
    assert_eq!(tabs,vec!["all"]);assert_eq!(ui.inventory_preference(),preference);
}

#[test]
fn pc_log_heading_uses_only_the_current_public_cell_and_name_is_bounded() {
    let mut ui=BrowserUi::new(measure);let mut m=model();
    m["frame"]["ui"]["name"]=json!("長い名前".repeat(30));
    m["frame"]["map_tiles"]=json!(vec![0;80*24]);
    for mode in ["ascii","tiles","pixels"] {
        m["displayMode"]=json!(mode);ui.render(m.clone(),view(1400.,1050.));
        assert!(ui.widgets.icons.iter().any(|i| i["name"]=="command-list"));
        let c=ui.camera.unwrap();let r=ui.map_rect.unwrap();
        ui.hover_point=Some((r.x+4.5*c.size-c.left,r.y+3.5*c.cell_h-c.top));
        let output=ui.render(m.clone(),view(1400.,1050.));
        let images:Vec<_>=array(&output["commands"]).iter().filter(|c| b(&c["logHeader"])).collect();
        assert_eq!(images.len(),1);assert_eq!(images[0]["image"],"terrain.unexplored.png");
        assert_eq!(images[0]["set"],if mode=="pixels" {"pixels"} else {"tiles"});
        assert!(ui.widgets.text_runs.iter().any(|r| s(&r["text"]).contains('…')));
        assert!(ui.widgets.text_runs.iter().any(|r| r["text"]=="暗闇"));
        // Changes in undisclosed data do not affect the selected public image.
        m["frame"]["hidden_monster"]=json!({"which":3});
        let output=ui.render(m.clone(),view(1400.,1050.));
        assert_eq!(array(&output["commands"]).iter().find(|c| b(&c["logHeader"])).unwrap()["image"],"terrain.unexplored.png");
        m["frame"]["map_tiles"][4*80+4]=json!(15);
        let output=ui.render(m.clone(),view(1400.,1050.));
        assert_eq!(array(&output["commands"]).iter().find(|c| b(&c["logHeader"])).unwrap()["image"],"item.potion.png");
        // A camera move under a stationary pointer resolves the newly pointed cell.
        ui.camera.as_mut().unwrap().left+=c.size;
        let output=ui.render(m.clone(),view(1400.,1050.));
        assert_eq!(array(&output["commands"]).iter().find(|c| b(&c["logHeader"])).unwrap()["image"],"terrain.unexplored.png");
        assert!(array(&ui.event(json!({"type":"leave"}))["effects"]).is_empty());
        assert!(ui.hover_point.is_none());m["frame"]["map_tiles"][4*80+4]=json!(0);
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


fn shortcut_model() -> Value {
    let mut m = model();
    m["input"] = json!({"kind":"command"});
    m["frame"]["ui"]["input"] = m["input"].clone();
    m["frame"]["ui"]["mode"] = json!("game");
    m["frame"]["ui"]["ranged"] = json!({"bow":true,"arrow_key":101});
    m["frame"]["ui"]["map_controls"] = crate::game_window::map_controls(&m["frame"]["ui"],false);
    m
}

#[test]
fn web_shortcuts_share_actions_with_buttons_and_preserve_original_keys() {
    for (key, id) in [("g","mobile-movement"),("p","mobile-full-map"),("x","pc-fire"),
        ("E","touch-again"),("C","commands-open"),("O","settings-toggle"),("G","header-fullscreen"),("M","history-open")] {
        let mut pointer = BrowserUi::new(measure);
        let mut keyboard = BrowserUi::new(measure);
        let m = shortcut_model();
        pointer.render(m.clone(),view(1400.,1000.)); keyboard.render(m.clone(),view(1400.,1000.));
        let control = pointer.widgets.controls.iter().find(|control| control.id == id).unwrap().clone();
        assert_eq!(control.shortcut.as_deref(),Some(key));
        let mut effects = Vec::new();pointer.activate(&control,&Value::Null,&mut effects);
        let result = keyboard.event(json!({"type":"key","key":key}));
        assert_eq!(result["effects"],json!(effects),"{key}");
        assert_eq!(keyboard.mobile_movement,pointer.mobile_movement);
        assert_eq!(keyboard.mobile_full_map,pointer.mobile_full_map);
        assert_eq!(keyboard.commands_open,pointer.commands_open);
        assert_eq!(keyboard.history_open,pointer.history_open);
    }
    let mut ui = BrowserUi::new(measure);let m = shortcut_model();
    ui.render(m.clone(),view(1400.,1000.));
    for key in ["a","o","f","F","w","W","r","R","t","T","potion-key"] {
        let result = ui.event(json!({"type":"key","key":key}));
        if key.chars().count() == 1 {
            assert_eq!(result["effects"],json!([{"kind":"send","key":if key=="t" {rogue_contract::RG_KEY_SELECT_THROW} else {key.chars().next().unwrap() as u32},"redraw":false}]),"{key}");
        }
    }
    ui.mobile_repeat_count=3;ui.mobile_repeat_configured=true;
    assert_eq!(ui.event(json!({"type":"key","key":"E"}))["effects"],json!([{"kind":"send","keys":[51,97]}]));
    ui.event(json!({"type":"key","key":"A"}));assert!(ui.repeat_count_open());
    ui.mobile_repeat_open=false;
    for _ in 0..2 { ui.event(json!({"type":"key","key":"V"})); }
    assert!(ui.mobile_controls);ui.mobile_controls=false;
    ui.render(m,view(1400.,1000.));
    assert!(!ui.widgets.controls.iter().any(|control| control.id=="mobile-movement"));
    ui.event(json!({"type":"key","key":"g"}));assert_eq!(ui.mobile_movement,1);
    assert_eq!(ui.event(json!({"type":"key","key":"x"}))["effects"],json!([{"kind":"send","key":rogue_contract::RG_KEY_FIRE}]));
}

#[test]
fn web_shortcuts_are_isolated_by_waits_modifiers_ime_and_key_repeat() {
    for field in ["ctrlKey","altKey","metaKey","composing","native","keyCode"] {
        let mut ui = BrowserUi::new(measure);ui.render(shortcut_model(),view(1400.,1000.));
        let mut event=json!({"type":"key","key":"g"});
        event[field]=match field {"native"=>json!("prompt-text"),"keyCode"=>json!(229),_=>json!(true)};
        ui.event(event);assert_eq!(ui.mobile_movement,0,"{field}");
    }
    for kind in ["direction","item","confirm","text","space","enter"] {
        let mut ui = BrowserUi::new(measure);let mut m=shortcut_model();m["input"]["kind"]=json!(kind);
        m["frame"]["ui"]["window"]=json!({"kind":"test","title":"test","actions":[]});
        ui.render(m,view(1400.,1000.));ui.event(json!({"type":"key","key":"g"}));
        assert_eq!(ui.mobile_movement,0,"{kind}");
    }
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();ui.render(m.clone(),view(1400.,1000.));
    ui.event(json!({"type":"key","key":"g","repeat":true}));assert_eq!(ui.mobile_movement,0);
    ui.event(json!({"type":"key","key":"C"}));assert!(ui.commands_open);
    ui.event(json!({"type":"key","key":"g"}));assert_eq!(ui.mobile_movement,0);
    ui.event(json!({"type":"key","key":"C","repeat":true}));assert!(ui.commands_open);
    ui.event(json!({"type":"key","key":"C"}));assert!(!ui.commands_open);
    for arrows in [Value::Null,json!(0)] {
        let mut absent=m.clone();absent["frame"]["ui"]["ranged"]["arrow_key"]=arrows;
        ui.render(absent,view(1400.,1000.));
        assert_eq!(ui.event(json!({"type":"key","key":"x"}))["effects"],json!([]));
        assert!(ui.widgets.controls.iter().find(|control| control.id=="pc-fire").unwrap().disabled);
    }
}

#[test]
fn phone_operations_include_every_web_and_item_command_without_hiding_unavailable_rows() {
    let mut ui=BrowserUi::new(measure);let mut v=view(390.,844.);v["coarse"]=json!(true);
    let mut m=shortcut_model();m["frame"]["ui"]["ranged"]["arrow_key"]=Value::Null;
    ui.render(m.clone(),v.clone());click(&mut ui,"mobile-operations");ui.render(m.clone(),v.clone());
    for command in WEB_COMMANDS {
        let control=ui.widgets.controls.iter().find(|control| control.id==format!("mobile-op-web-{}",command.id)).unwrap();
        assert_eq!(control.action,json!({"kind":"web","id":command.id}));
        assert!(control.shortcut.is_none());
    }
    for key in "hjklyubn.,ms^><fFtzqrewWTPRdcIiD@/=)?a".chars() {
        assert!(ui.widgets.controls.iter().any(|control| control.id==format!("mobile-op-{}",key as u32)),"{key}");
    }
    for key in [111, 118, 18, 16, 83, 33] {
        assert!(!ui.widgets.controls.iter().any(|control| control.id==format!("mobile-op-{key}")),"Retired control {key} stays absent");
    }
    assert!(ui.widgets.controls.iter().any(|control| control.id=="mobile-op-web-settings"));
    assert!(ui.widgets.controls.iter().find(|control| control.id=="mobile-op-web-fire").unwrap().disabled);
    assert!(ui.widgets.controls.iter().find(|control| control.id=="mobile-op-60").unwrap().disabled);
    assert!(ui.regions["mobile-operations"].max>0.);
    // A menu action closes the sheet, then uses the existing original C input path.
    let command=ui.widgets.controls.iter().find(|control| control.id=="mobile-op-116").unwrap().clone();
    let mut effects=Vec::new();ui.activate(&command,&Value::Null,&mut effects);
    assert_eq!(effects,vec![json!({"kind":"send","key":116})]);assert!(!ui.mobile_operations);
}


#[test]
fn phone_direction_commands_use_the_pad_mode_and_selection_rows_are_not_game_commands() {
    for mode in 0..3 {
        let mut ui=BrowserUi::new(measure);let m=shortcut_model();let mut v=view(390.,844.);v["coarse"]=json!(true);
        ui.render(m.clone(),v.clone());ui.mobile_movement=mode;
        let expected:Vec<_>="hjklyubn".chars().map(|key| {
            let value=key as u32;
            (value,match mode {1=>value-32,2=>value|rogue_contract::RG_EVENT_CTRL,_=>value})
        }).collect();
        for (key,emitted) in expected {
            ui.mobile_operations=false;ui.render(m.clone(),v.clone());
            let pad=ui.widgets.controls.iter().find(|control| control.id==format!("touch-{}",char::from_u32(key).unwrap())).unwrap().clone();
            assert_eq!(pad.action["key"],emitted);
            ui.mobile_operations=true;ui.render(m.clone(),v.clone());
            assert!(!ui.widgets.controls.iter().any(|control| control.id=="mobile-op-42"),"Selection-only * is absent");
            let command=ui.widgets.controls.iter().find(|control| control.id==format!("mobile-op-{key}")).unwrap().clone();
            let mut effects=Vec::new();ui.activate(&command,&Value::Null,&mut effects);
            assert_eq!(effects,vec![json!({"kind":"send","key":emitted})],"{mode} {key}");
        }
    }
    let selection=commands::GROUPS.iter().find(|(group,_)| *group=="commands.group.selection").unwrap();
    assert!(selection.1.iter().all(|entry| entry.phone_action.is_none()));
}


#[test]
fn physical_directions_follow_selected_mode_without_changing_other_inputs() {
    use rogue_contract::*;
    let mut ui=BrowserUi::new(measure);
    ui.render(shortcut_model(),view(1400.,1000.));
    let send = |key| json!([{"kind":"send","key":key,"redraw":false}]);
    for mode in 0..3 {
        ui.mobile_movement=mode;
        for (name,digit,letter,symbol) in [
            ("ArrowUp",8,b'k',RG_KEY_UP),("ArrowDown",2,b'j',RG_KEY_DOWN),
            ("ArrowLeft",4,b'h',RG_KEY_LEFT),("ArrowRight",6,b'l',RG_KEY_RIGHT),
            ("Home",7,b'y',RG_KEY_HOME),("End",1,b'b',RG_KEY_END),
            ("PageUp",9,b'u',RG_KEY_PAGE_UP),("PageDown",3,b'n',RG_KEY_PAGE_DOWN),
        ] {
            let expected=match mode {1=>u32::from(letter.to_ascii_uppercase()),2=>symbol|RG_EVENT_CTRL,_=>symbol};
            for event in [json!({"type":"key","key":name}),
                json!({"type":"key","key":name,"code":format!("Numpad{digit}")}),
                json!({"type":"key","key":digit.to_string(),"code":format!("Numpad{digit}")})] {
                assert_eq!(ui.event(event)["effects"],send(expected),"mode {mode}, {name}");
            }
            let expected=match mode {1=>u32::from(letter.to_ascii_uppercase()),2=>u32::from(letter)|RG_EVENT_CTRL,_=>u32::from(letter)};
            assert_eq!(ui.event(json!({"type":"key","key":char::from(letter).to_string()}))["effects"],send(expected));
            for (field,flag) in [("shiftKey",RG_EVENT_SHIFT),("ctrlKey",RG_EVENT_CTRL),("altKey",RG_EVENT_ALT)] {
                let mut event=json!({"type":"key","key":name});event[field]=json!(true);
                assert_eq!(ui.event(event)["effects"],send(symbol|flag),"{field}, mode {mode}");
            }
            assert_eq!(ui.event(json!({"type":"key","key":char::from(letter.to_ascii_uppercase()).to_string()}))["effects"],send(u32::from(letter.to_ascii_uppercase())));
        }
        for digit in 0..10 {
            assert_eq!(ui.event(json!({"type":"key","key":digit.to_string(),"code":format!("Digit{digit}")}))["effects"],send(48+digit));
        }
        for key in ["5","Clear"] {
            assert_eq!(ui.event(json!({"type":"key","key":key,"code":"Numpad5"}))["effects"],send(46));
        }
        for field in ["metaKey","composing","keyCode","native"] {
            let mut event=json!({"type":"key","key":"ArrowRight"});
            event[field]=match field {"keyCode"=>json!(229),"native"=>json!("prompt-text"),_=>json!(true)};
            assert_eq!(ui.event(event)["effects"],json!([]),"{field}");
        }
    }
    for kind in ["direction","item","confirm","text","space","enter"] {
        let mut m=shortcut_model();m["input"]["kind"]=json!(kind);
        ui.render(m,view(1400.,1000.));ui.mobile_movement=2;
        for (key,expected) in [("ArrowRight",RG_KEY_RIGHT),("l",108)] {
            assert_eq!(ui.event(json!({"type":"key","key":key}))["effects"],send(expected),"{kind}");
        }
    }
    let mut m=shortcut_model();m["frame"]["ui"]["movement_direction"]=json!(true);
    ui.render(m,view(1400.,1000.));ui.mobile_movement=2;
    assert_eq!(ui.event(json!({"type":"key","key":"ArrowRight"}))["effects"],send(108));
}

#[test]
fn repeat_button_displays_phone_hold_hint_until_configured_and_keeps_pc_count() {
    for (coarse, prefix) in [(false,"A) 回数"),(true,"回数")] {
        let mut ui=BrowserUi::new(measure);
        let m=shortcut_model();let mut v=view(1400.,1000.);v["coarse"]=json!(coarse);
        ui.render(m.clone(),v.clone());
        let initial = if coarse { "繰返し\n長押し" } else { "E) E) 繰返し\nA) 回数1" };
        assert_eq!(ui.widgets.controls.iter().find(|c| c.id=="touch-again").unwrap().label, initial);
        let mut effects=Vec::new();ui.open_repeat_count(&mut effects);
        ui.event(json!({"type":"key","key":"Escape"}));
        ui.render(m.clone(),v.clone());
        assert_eq!(ui.widgets.controls.iter().find(|c| c.id=="touch-again").unwrap().label, initial);
        assert_eq!(json!(array(&click(&mut ui,"touch-again")["effects"]).iter().filter(|e| e["kind"]=="send").collect::<Vec<_>>()),json!([{"kind":"send","keys":[97]}]));
        let mut effects=Vec::new();ui.open_repeat_count(&mut effects);
        assert!(ui.confirm_repeat_count("12"));
        let output=ui.render(m.clone(),v.clone());
        assert!(array(&output["commands"]).iter().any(|c| c["text"]==format!("{prefix}12")));
        assert_eq!(json!(array(&click(&mut ui,"touch-again")["effects"]).iter().filter(|e| e["kind"]=="send").collect::<Vec<_>>()),json!([{"kind":"send","keys":[49,50,97]}]));
        let mut effects=Vec::new();ui.open_repeat_count(&mut effects);
        assert!(ui.confirm_repeat_count("1"));
        let output=ui.render(m,v);
        assert!(array(&output["commands"]).iter().any(|c| c["text"]==format!("{prefix}1")));
    }
}

#[test]
fn settings_handedness_switch_has_localized_state_and_unique_shortcuts() {
    for (width,height,coarse) in [(1400.,1000.,false),(390.,844.,true)] {
        let mut ui=BrowserUi::new(measure);let mut m=model();m["settingsOpen"]=json!(true);
        let mut v=view(width,height);v["coarse"]=json!(coarse);
        for (handedness,label) in [("right","右"),("left","左")] {
            m["handedness"]=json!(handedness);let output=ui.render(m.clone(),v.clone());
            assert!(array(&output["commands"]).iter().any(|c| c["text"]==label));
            let toggle=ui.widgets.controls.iter().find(|c|c.id=="handedness-toggle").unwrap();
            assert_eq!(toggle.key,Some(json!(handedness=="right")));
            assert_eq!(json!(array(&click(&mut ui,"handedness-toggle")["effects"]).iter().filter(|e| e["kind"]=="invoke").collect::<Vec<_>>()),json!([{"kind":"invoke","id":"handedness-toggle"}]));
            let shortcuts:Vec<_>=ui.widgets.controls.iter().filter_map(|c|c.shortcut.clone()).collect();
            let mut unique=shortcuts.clone();unique.sort();unique.dedup();assert_eq!(shortcuts.len(),unique.len());
        }
    }
}


fn game_effects(result: Value) -> Value {
    json!(array(&result["effects"]).iter().filter(|v|v["kind"]=="send").cloned().collect::<Vec<_>>())
}

#[test]
fn handed_docks_mirror_action_columns_and_keep_natural_directions_and_live_hitboxes() {
    for (width,height,coarse) in [(1400.,900.,false),(900.,700.,false),(700.,500.,false),(390.,844.,true),(320.,568.,true)] {
        let mut right = BrowserUi::new(measure);
        let mut left = BrowserUi::new(measure);
        let mut m = shortcut_model();
        let mut v = view(width,height);v["coarse"] = json!(coarse);
        m["handedness"] = json!("right");right.render(m.clone(),v.clone());
        m["handedness"] = json!("left");left.render(m.clone(),v.clone());
        let get = |ui: &BrowserUi,id: &str| ui.widgets.controls.iter().find(|c|c.id==id).unwrap().clone();
        for ui in [&right,&left] {
            let h=get(ui,"touch-h").rect;let k=get(ui,"touch-k").rect;let l=get(ui,"touch-l").rect;
            assert!(h.x < k.x && k.x < l.x,"directions keep their natural positions");
            assert_eq!(h.w,h.h);assert_eq!(l.w,l.h);
            let dock:Vec<_> = ui.widgets.controls.iter().filter(|c|c.id.starts_with("pc-")||c.id.starts_with("touch-")||matches!(c.id.as_str(),"mobile-movement"|"mobile-full-map"|"mobile-operations")).collect();
            for (index,a) in dock.iter().enumerate() {
                assert_eq!(a.rect,a.full_rect,"{} fully visible at {width}",a.id);
                assert!(a.rect.w>=48.&&a.rect.h>=48.,"{} target at {width}",a.id);
                assert!(a.rect.x>=0.&&a.rect.y>=0.&&a.rect.x+a.rect.w<=width&&a.rect.y+a.rect.h<=height,"{} fits at {width}",a.id);
                for b in &dock[index+1..] {assert!(!a.rect.overlaps(b.rect),"{} avoids {} at {width}",a.id,b.id);}
            }
        }
        let right_pad=get(&right,"touch-h").rect;let left_pad=get(&left,"touch-h").rect;
        if coarse {assert!(right_pad.x<left_pad.x);} else {assert!(right_pad.x>left_pad.x);}
        let ids = if coarse {vec!["mobile-movement","touch-action-action.inventory","touch-search","mobile-full-map","mobile-operations","touch-again"]}
            else {vec!["mobile-movement","pc-inventory","pc-search","pc-wield","pc-throw","pc-zap","mobile-full-map","touch-again","pc-armor","pc-quaff","pc-read","pc-eat"]};
        for id in ids.into_iter().filter(|id| *id!="pc-ring" || width>=980. || coarse) {
            let a=get(&right,id);let b=get(&left,id);
            assert!((a.rect.x+b.rect.x+a.rect.w-width).abs()<0.001,"{id} reflected at {width}");
            assert_eq!(a.action,b.action);assert_eq!(a.shortcut,b.shortcut);
        }
        let search=if coarse {"touch-search"} else {"pc-search"};
        assert_eq!(game_effects(click(&mut right,search)),json!([{"kind":"send","key":115}]));
        assert_eq!(game_effects(click(&mut left,search)),json!([{"kind":"send","key":115}]));
        if !coarse {
            let cell=get(&right,"pc-inventory").rect;
            for id in ["mobile-movement","pc-search","pc-wield","pc-throw","pc-zap","mobile-full-map","touch-again","pc-armor","pc-quaff","pc-read","pc-eat"] {
                for ui in [&right,&left] {
                    if id=="pc-ring" && width<980. {continue;}
                    let button=get(ui,id).rect;assert_eq!((button.w,button.h),(cell.w,cell.h),"{id} uses one cell at {width}");
                }
            }
            for (id,key) in [("pc-armor",87),("pc-quaff",113),("pc-read",114),("pc-eat",101)] {
                if id=="pc-ring" && width<980. {continue;}
                assert_eq!(get(&left,id).shortcut,Some(char::from_u32(key).unwrap().to_string()));
                assert_eq!(game_effects(click(&mut left,id)),json!([{"kind":"send","key":key}]));
            }
        }
    }
}

#[test]
fn context_candidates_are_additive_on_desktop_and_highlight_the_phone_replacement() {
    let mut m=shortcut_model();
    m["frame"]["map_player_surface"]=json!({"tile":17});
    m["frame"]["map_tiles"]=json!([0,0,0,0,0,0,0,0,0,0,0,0,7]);
    m["frame"]["width"]=json!(4);m["frame"]["height"]=json!(6);
    m["frame"]["player"]=json!({"x":1,"y":3});
    m["frame"]["ui"]["player_state"]=json!({"amulet":true,"levitating":false});
    m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],true);
    let mut pc=BrowserUi::new(measure);pc.render(m.clone(),view(1400.,900.));
    let search=pc.widgets.controls.iter().find(|c|c.id=="pc-search").unwrap().clone();
    for id in ["pc-ascend","pc-descend","pc-trap","pc-pickup","pc-fire"] {
        let c=pc.widgets.controls.iter().find(|c|c.id==id).unwrap();
        assert!(c.rect.y+c.rect.h<search.rect.y,"{id} stays on the separate row");
    }
    assert!(pc.widgets.controls.iter().any(|c|c.id=="pc-throw"));
    assert_eq!(game_effects(click(&mut pc,"pc-search")),json!([{"kind":"send","key":115}]));
    let mut phone=BrowserUi::new(measure);let mut v=view(390.,844.);v["coarse"]=json!(true);
    let output=phone.render(m.clone(),v.clone());
    let c=phone.widgets.controls.iter().find(|c|c.id=="touch-search").unwrap();
    assert_eq!(c.action,json!({"kind":"command","id":"game.upstairs"}));
    assert_eq!(c.key,Some(json!(60)));
    let painted=|output:&Value,c:&Control| array(&output["commands"]).iter().find(|v|v["op"]=="box"&&v["rect"]==json!(c.full_rect)).unwrap()["fill"].clone();
    assert_eq!(painted(&output,c),phone.widgets.theme.color("@accent"));
    assert_eq!(game_effects(click(&mut phone,"touch-search")),json!([{"kind":"send","key":60}]));
    m["frame"]["map_player_surface"]=json!({"tile":1});m["frame"]["map_tiles"]=json!([]);
    m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
    let output=phone.render(m,v);
    let c=phone.widgets.controls.iter().find(|c|c.id=="touch-search").unwrap();
    assert_eq!(c.action,json!({"kind":"command","id":"game.search"}));
    assert_eq!(c.key,Some(json!(115)));
    assert_eq!(painted(&output,c),phone.widgets.theme.color("@button.background"));
}

#[test]
fn keyboard_direction_is_centered_on_desktop_and_phone_regardless_of_handedness() {
    for (width,coarse) in [(1400.,false),(390.,true)] {
        let mut positions=Vec::new();
        for hand in ["left","right"] {
            let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();
            m["handedness"]=json!(hand);m["input"]=json!({"kind":"direction"});
            m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(true);
            let mut v=view(width,900.);v["coarse"]=json!(coarse);
            ui.render(m.clone(),v.clone());ui.mobile_controls=false;ui.render(m,v);
            let (left_id,right_id)=if coarse {("window-104","window-108")}else{("touch-h","touch-l")};
            let left=ui.widgets.controls.iter().find(|c|c.id==left_id).unwrap();
            let right=ui.widgets.controls.iter().find(|c|c.id==right_id).unwrap();
            assert!(left.rect.x<right.rect.x);positions.push(left.rect.x);
            assert_eq!(game_effects(click(&mut ui,right_id)),json!([{"kind":"send","key":108}]));
        }
        assert_eq!(positions[0],positions[1]);
    }
}

#[test]
fn narrow_phone_repeat_hint_and_count_two_stay_on_two_lines() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();
    let mut v=view(320.,740.);v["coarse"]=json!(true);
    for (configured,expected) in [(false,vec!["繰返し","長押し"]),(true,vec!["繰返し","回数2"])] {
        ui.mobile_repeat_configured=configured;ui.mobile_repeat_count=2;
        let output=ui.render(m.clone(),v.clone());
        let rect=ui.widgets.controls.iter().find(|c|c.id=="touch-again").unwrap().rect;
        let lines:Vec<_>=array(&output["commands"]).iter().filter(|c| c["op"]=="text" && rect.contains(n(&c["x"]),n(&c["y"]))).collect();
        assert_eq!(lines.iter().map(|c|s(&c["text"])).collect::<Vec<_>>(),expected);
        assert!(lines.iter().all(|c|c["size"]==17.));
    }
}

#[test]
fn narrow_phone_repeat_fits_each_complete_line_at_normal_size_or_smaller() {
    for (language,expected) in [("ja",vec!["繰返し","回数255"]),("en",vec!["Repeat","Count 255"])] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();m["language"]=json!(language);
        let mut v=view(320.,740.);v["coarse"]=json!(true);
        ui.render(m.clone(),v.clone());
        let mut effects=Vec::new();ui.open_repeat_count(&mut effects);assert!(ui.confirm_repeat_count("255"));
        let output=ui.render(m,v);
        let rect=ui.widgets.controls.iter().find(|c|c.id=="touch-again").unwrap().rect;
        let lines:Vec<_>=array(&output["commands"]).iter().filter(|c| c["op"]=="text" && rect.contains(n(&c["x"]),n(&c["y"]))).collect();
        assert_eq!(lines.iter().map(|c|s(&c["text"])).collect::<Vec<_>>(),expected);
        assert!(lines.iter().all(|c|n(&c["size"])>0. && n(&c["size"])<=17.));
        assert!(lines.iter().all(|c|measure(s(&c["text"]),n(&c["size"]),false,false).width<=rect.w-2.+0.001));
    }
}


#[test]
fn phone_button_logical_lines_fit_without_changing_targets_or_leaking_to_desktop() {
    for width in [320.,390.] {
        for hand in ["right","left"] {
            let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();m["handedness"]=json!(hand);
            let mut v=view(width,844.);v["coarse"]=json!(true);
            let output=ui.render(m.clone(),v);
            for id in ["mobile-movement","touch-action-action.inventory","touch-search","mobile-full-map","mobile-operations","touch-again"] {
                let c=ui.widgets.controls.iter().find(|c|c.id==id).unwrap();
                assert_eq!(c.rect,c.full_rect);assert!(c.rect.w>=48. && c.rect.h>=48.);
                let lines:Vec<_>=array(&output["commands"]).iter().filter(|run|run["op"]=="text" && c.rect.contains(n(&run["x"]),n(&run["y"]))).collect();
                assert_eq!(lines.iter().map(|run|s(&run["text"])).collect::<Vec<_>>(),c.label.split('\n').collect::<Vec<_>>(),"{id} at {width}");
                for run in lines {
                    assert!(n(&run["size"])>0. && n(&run["size"])<=17.);
                    assert!(n(&run["x"])+measure(s(&run["text"]),n(&run["size"]),false,false).width<=c.rect.x+c.rect.w+0.001);
                }
            }
            let desktop=ui.render(m.clone(),view(1400.,900.));
            let fresh=BrowserUi::new(measure).render(m,view(1400.,900.));
            assert_eq!(desktop["commands"],fresh["commands"],"phone fitting does not leak into desktop");
        }
    }
}

#[test]
fn fitted_control_line_keeps_zero_width_and_empty_labels_finite() {
    let mut widgets=Widgets::default();widgets.fit_control_captions=true;
    for label in ["", "持ち物"] {
        let ink=widgets.control_line(label,Rect::new(0.,0.,0.,48.),
            LineStyle { text:TextStyle::new(17.,TEXT,false),center:true,ellipsis:false },measure);
        assert!(ink.x.is_finite() && ink.y.is_finite() && ink.w.is_finite() && ink.h.is_finite());
        assert!(ink.w<=0.);
    }
}

#[test]
fn desktop_direction_removes_all_background_hitboxes_while_showing_the_selector() {
    for width in [700.,900.,1400.] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();
        ui.render(m.clone(),view(width,900.));
        let ids=["mobile-movement","pc-inventory","pc-search","pc-wield","pc-throw","pc-zap","mobile-full-map","touch-again","pc-armor","pc-quaff","pc-read","pc-eat"];
        assert!(ids.iter().all(|id|ui.widgets.controls.iter().any(|c|c.id==*id)));
        m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();
        m["frame"]["ui"]["movement_direction"]=json!(true);m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
        ui.render(m,view(width,900.));
        assert!(ids.iter().all(|id|!ui.widgets.controls.iter().any(|c|c.id==*id)),"Only the modal selector owns hitboxes");
        assert_eq!(ui.widgets.controls.len(),9);
        assert!(ui.widgets.controls.iter().any(|c|c.id=="pc-cancel"&&!c.disabled));
        assert!(!ui.widgets.controls.iter().any(|c|c.id=="pc-fire"||c.id=="touch-."));
        assert!(ui.widgets.controls.iter().filter(|c|c.id.starts_with("touch-")).all(|c|!c.disabled));
        assert_eq!(game_effects(click(&mut ui,"touch-l")),json!([{"kind":"send","key":108}]));
    }
}

#[test]
fn desktop_direction_custom_captions_share_standard_disabled_opacity() {
    fn alpha_for(output: &Value, prefix: &str) -> f64 {
        let mut stack=vec![1.];
        for command in array(&output["commands"]) {
            match s(&command["op"]) {
                "save" | "clip" => stack.push(stack.last().unwrap()*command["alpha"].as_f64().unwrap_or(1.)),
                "restore" => {stack.pop();},
                "text" if s(&command["text"]).starts_with(prefix) => return *stack.last().unwrap(),
                _ => {},
            }
        }
        panic!("Missing caption {prefix}");
    }
    for width in [390.,700.,1400.] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();
        let normal=ui.render(m.clone(),view(width,900.));
        for prefix in ["g)","E)","A)","p)"] {assert_eq!(alpha_for(&normal,prefix),1.);}
        m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();
        m["frame"]["ui"]["movement_direction"]=json!(true);m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
        let direction=ui.render(m.clone(),view(width,900.));
        for prefix in ["g)","E)","A)","s)","p)"] {
            if width>=700. || prefix!="s)" {assert_eq!(alpha_for(&direction,prefix),0.45,"{prefix} at {width}");}
        }
        let form=ui.control_form();ui.controls_preferences.profile_mut(form).assignments[1]="web.full-map".into();
        let custom=ui.render(m.clone(),view(width,900.));assert_eq!(alpha_for(&custom,"p)"),0.45,"Custom full-map assignment");
        let mut effects=Vec::new();ui.activate_web(WebAction::FullMap,&mut effects);
        assert!(!ui.mobile_full_map,"Direction selection blocks the full-map action");assert!(effects.is_empty());
        m["input"]=json!({"kind":"command"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(false);
        m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
        let restored=ui.render(m,view(width,900.));assert_eq!(alpha_for(&restored,"p)"),1.);
        ui.activate_web(WebAction::FullMap,&mut effects);assert!(ui.mobile_full_map);assert!(effects.is_empty());
    }
    let mut phone=BrowserUi::new(measure);let mut v=view(320.,568.);v["coarse"]=json!(true);
    let normal=phone.render(shortcut_model(),v);
    assert_eq!(alpha_for(&normal,"歩く"),1.);assert_eq!(alpha_for(&normal,"長押し"),1.);
}

#[test]
fn desktop_resize_removes_hidden_hitboxes_and_keeps_the_reference_and_keys() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();
    for width in [1400.,980.,979.,900.,700.,699.,700.,980.] {
        ui.render(m.clone(),view(width,900.));
        let has_ring=ui.widgets.controls.iter().any(|c|c.id=="pc-ring");
        assert!(!has_ring,"Ring is assignable from the list, never an extra default button");
        if width<700. {assert!(ui.widgets.controls.iter().any(|c|c.id=="mobile-operations"));continue;}
        let controls:Vec<_>=ui.widgets.controls.iter().filter(|c|matches!(c.id.as_str(),"mobile-movement"|"pc-inventory"|"pc-search"|"pc-wield"|"pc-throw"|"pc-zap"|"mobile-full-map"|"touch-again"|"pc-armor"|"pc-quaff"|"pc-ring"|"pc-read"|"pc-eat")).collect();
        assert_eq!(controls.len(),12);
        let mut rows:Vec<_>=controls.iter().map(|c|c.rect.y as i32).collect();rows.sort_unstable();rows.dedup();assert_eq!(rows.len(),3);
        assert!(controls.iter().all(|c|c.rect==c.full_rect));
    }
    assert!(commands::GROUPS.iter().flat_map(|(_,entries)|entries.iter()).any(|entry|entry.keys=="P"));
    ui.render(m.clone(),view(700.,900.));ui.event(json!({"type":"key","key":"C"}));
    ui.render(m.clone(),view(700.,900.));assert_eq!(ui.scope,"commands");
    ui.event(json!({"type":"key","key":"Escape"}));ui.render(m,view(700.,900.));
    assert_eq!(game_effects(ui.event(json!({"type":"key","key":"P"}))),json!([{"kind":"send","key":80,"redraw":false}]));
}

#[test]
fn custom_binding_capture_requires_confirmation_preserves_aliases_and_rejects_duplicates() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();
    ui.render(m.clone(),view(1400.,1000.));
    let before=ui.control_preferences();
    ui.open_binding_capture("game.search",0);
    assert!(ui.binding_key(&json!({"key":"Control"})));
    assert!(ui.binding_capture.as_ref().unwrap().candidate.is_none());
    ui.binding_key(&json!({"key":"i"}));
    assert!(ui.binding_capture.as_ref().unwrap().error.is_some());
    ui.confirm_binding();assert!(ui.binding_capture.is_some());
    assert_eq!(ui.control_preferences(),before);
    ui.binding_key(&json!({"key":"s","ctrlKey":true}));
    assert!(ui.binding_capture.as_ref().unwrap().error.is_none());
    assert_eq!(ui.control_preferences(),before);
    ui.confirm_binding();assert!(ui.binding_capture.is_none());
    assert_eq!(game_effects(ui.event(json!({"type":"key","key":"s","ctrlKey":true}))),json!([{"kind":"send","key":115,"redraw":false}]));
    assert!(game_effects(ui.event(json!({"type":"key","key":"s"}))).as_array().unwrap().is_empty());
    let aliases=ui.command_bindings("game.move-left");
    ui.open_binding_capture("game.move-left",1);
    ui.binding_key(&json!({"key":"j","altKey":true}));ui.confirm_binding();
    let changed=ui.command_bindings("game.move-left");assert_eq!(changed[0],aliases[0]);assert_eq!(changed[2],aliases[2]);
    ui.open_binding_capture("game.search",0);
    ui.binding_key(&json!({"key":"x","altKey":true}));ui.binding_key(&json!({"key":"Escape"}));
    assert_eq!(ui.command_bindings("game.search")[0].label(),"Ctrl+s");
}
#[test]
fn custom_bindings_do_not_translate_followups_or_phone_keys() {
    for kind in ["item","direction","text","confirm","space"] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();
        m["input"]=json!({"kind":kind});m["frame"]["ui"]["input"]=m["input"].clone();
        ui.render(m,view(1400.,1000.));
        ui.controls_preferences.bindings.insert("game.search".into(),vec![keybindings::KeyBinding::plain("v")]);
        let effects=game_effects(ui.event(json!({"type":"key","key":"v"})));
        assert!(effects.as_array().unwrap().iter().all(|e|e["key"]!=115),"{kind}");
    }
    let mut ui=BrowserUi::new(measure);let mut v=view(390.,844.);v["coarse"]=json!(true);
    ui.render(shortcut_model(),v);
    ui.controls_preferences.bindings.insert("game.search".into(),vec![keybindings::KeyBinding::plain("v")]);
    assert!(game_effects(ui.event(json!({"type":"key","key":"v"}))).as_array().unwrap().iter().all(|e|e["key"]!=115));
}

#[test]
fn pc_command_table_is_command_then_key_and_each_alias_opens_capture() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();
    ui.render(m.clone(),view(1400.,1000.));ui.commands_open=true;
    let output=ui.render(m.clone(),view(1400.,1000.));
    let text=array(&output["commands"]);
    let command=text.iter().find(|t|t["text"]==ui.t("commands.action")).unwrap();
    let key=text.iter().find(|t|t["text"]==ui.t("commands.key")).unwrap();
    assert!(n(&command["x"])<n(&key["x"]));
    let id="command-bind-game.move-left-1";
    let cell=ui.widgets.controls.iter().find(|c|c.id==id).unwrap();
    assert_eq!(cell.action["index"],1);
    assert!(game_effects(click(&mut ui,id)).as_array().unwrap().is_empty());
    assert_eq!(ui.binding_capture.as_ref().unwrap().command,"game.move-left");
    assert_eq!(ui.binding_capture.as_ref().unwrap().index,1);
    ui.render(m,view(1400.,1000.));
    assert!(ui.widgets.text_runs.iter().any(|t|t["text"]==ui.t("keybindings.prompt")));
    assert!(ui.widgets.controls.iter().find(|c|c.id=="key-binding-confirm").unwrap().disabled);
}

#[test]
fn binding_capture_treats_modified_enter_as_a_candidate_until_plain_enter_confirms() {
    for modifier in ["ctrlKey","altKey","shiftKey"] {
        let mut ui=BrowserUi::new(measure);
        ui.render(shortcut_model(),view(1400.,1000.));
        ui.open_binding_capture("game.search",0);
        ui.binding_key(&json!({"key":"s","ctrlKey":true}));
        for ignored in [json!({"key":"Enter","composing":true}),json!({"key":"Enter","keyCode":229}),json!({"key":"Enter","metaKey":true})] {
            ui.binding_key(&ignored);
            assert!(ui.binding_capture.is_some(),"Excluded Enter must not confirm a candidate");
        }
        let mut event=json!({"key":"Enter"});event[modifier]=json!(true);
        ui.binding_key(&event);
        let capture=ui.binding_capture.as_ref().expect("Modified Enter must remain a candidate");
        assert_eq!(capture.candidate,keybindings::KeyBinding::from_event(&event));
        ui.binding_key(&json!({"key":"Enter"}));
        assert!(ui.binding_capture.is_none());
        assert_eq!(ui.command_bindings("game.search"),vec![keybindings::KeyBinding::from_event(&event).unwrap()]);
    }
}


#[test]
fn search_unification_resolved_button_keys_do_not_inherit_retired_context_aliases() {
    for (width,coarse) in [(390.,false),(699.,false),(700.,false),(390.,true)] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();let mut v=view(width,900.);v["coarse"]=json!(coarse);m["frame"]["ui"]["map_controls"]["stairs"]=json!({"ascend":false,"descend":true});
        let mut old=serde_json::to_value(control_preferences::ControlsPreferences::default()).unwrap();let form=if width<700.||coarse {"phone"}else{"desktop"};old[form]["assignments"][1]=json!("web.context");old["bindings"]["web.context"]=json!([{"key":"F20"}]);ui.load_control_preferences(&old.to_string());ui.render(m,v);
        let id=if form=="phone" {"touch-action-action.inventory"}else{"pc-inventory"};let c=ui.widgets.controls.iter().find(|c|c.id==id).unwrap().clone();assert_eq!(c.shortcut.as_deref(),if coarse {None}else{Some(">")});assert_eq!(c.action,json!({"kind":"command","id":"game.downstairs"}));
        if !coarse {let alias=ui.event(json!({"type":"key","key":"F20"}));assert!(array(&alias["effects"]).iter().any(|e|e["kind"]=="send"&&e["key"]==115));}
    }
}

#[test]
fn responsive_pc_direction_inactivates_every_background_web_control() {
    fn alphas(out:&Value,text:&str)->Vec<f64> {
        let mut stack=vec![1.];let mut found=Vec::new();
        for c in array(&out["commands"]) {match s(&c["op"]) {
            "save"|"clip"=>stack.push(stack.last().unwrap()*c["alpha"].as_f64().unwrap_or(1.)),"restore"=>{stack.pop();},
            "text" if s(&c["text"])==text || s(&c["text"]).starts_with(&format!("{text})"))=>found.push(*stack.last().unwrap()),_=>{}
        }}found
    }
    for width in [390.,699.,700.] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();let v=view(width,900.);ui.render(m.clone(),v.clone());
        let form=ui.control_form();for (slot,id) in ["web.commands","web.history","web.fullscreen","web.settings","web.controls","web.full-map"].iter().enumerate(){ui.controls_preferences.profile_mut(form).assignments[slot]=(*id).into();}
        let normal=ui.render(m.clone(),v.clone());for key in ["C","M","G","O","V","p"] {let found=alphas(&normal,key);assert!(!found.is_empty(),"{key}");assert!(found.iter().all(|a|*a==1.));}
        m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(true);m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
        let direction=ui.render(m,v);for key in ["C","M","G","O","V","p"] {let found=alphas(&direction,key);assert!(!found.is_empty(),"{key}");assert!(found.iter().all(|a|*a==0.45),"Background {key} at {width}: {found:?}");}
        assert_eq!(ui.widgets.controls.len(),9);assert!(ui.widgets.controls.iter().all(|c|!c.disabled));
        let mut effects=Vec::new();ui.activate_web(WebAction::Commands,&mut effects);assert!(!ui.commands_open&&!ui.mobile_operations);assert!(effects.is_empty());
    }
    let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(true);m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);
    let mut v=view(390.,900.);v["coarse"]=json!(true);ui.render(m,v);assert!(ui.widgets.controls.iter().any(|c|c.id=="settings-toggle"&&!c.disabled));assert!(!ui.widgets.controls.iter().any(|c|c.id=="mobile-full-map"||c.id=="mobile-operations"));
}

#[test]
fn responsive_pc_keeps_key_editing_and_item_tabs_at_compact_width() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();
    for width in [700.,699.,390.] {
        ui.render(m.clone(),view(width,900.));ui.event(json!({"type":"key","key":"C"}));let out=ui.render(m.clone(),view(width,900.));
        if width<700. {assert!(array(&out["commands"]).iter().any(|c|s(&c["text"])=="コマンド / キー"));}
        assert!(ui.commands_open&&!ui.mobile_operations,"PC command list at {width}");
        let id="command-bind-game.move-left-0";let c=ui.widgets.controls.iter().find(|c|c.id==id).unwrap();assert!(c.rect.w>=40.&&c.rect.h>=40.);
        click(&mut ui,id);assert!(ui.binding_capture.is_some());ui.event(json!({"type":"key","key":"Escape"}));ui.event(json!({"type":"key","key":"Escape"}));
        let selection=selection_model("action.call","callable",&["weapon","armor"]);let before=ui.inventory_preference();ui.render(selection.clone(),view(width,900.));
        assert!(ui.widgets.controls.iter().any(|c|c.id=="inventory-tab-weapon"));assert!(ui.widgets.controls.iter().any(|c|c.id=="inventory-tab-armor"));
        click(&mut ui,"inventory-tab-armor");ui.render(selection,view(width,900.));assert_eq!(ui.selection_tabs.tab,"armor");assert_eq!(ui.inventory_preference(),before);
    }
    let mut phone=BrowserUi::new(measure);let mut v=view(390.,900.);v["coarse"]=json!(true);phone.render(m.clone(),v.clone());phone.activate_web(WebAction::Commands,&mut Vec::new());phone.render(m,v.clone());assert!(phone.mobile_operations&&!phone.commands_open);
    phone.mobile_operations=false;phone.render(selection_model("action.call","callable",&["weapon","armor"]),v);assert!(!phone.widgets.controls.iter().any(|c|c.id.starts_with("inventory-tab-")));
}

#[test]
fn responsive_pc_retains_keyboard_log_help_and_reassigned_history_hint() {
    for (width,coarse) in [(390.,false),(699.,false),(700.,false),(390.,true)] {
        let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();let mut v=view(width,900.);v["coarse"]=json!(coarse);
        m["entries"]=json!([{"source":"game","text":"Keyboard hint marker","mobile_keyboard_hint":true}]);
        ui.controls_preferences.bindings.insert("web.history".into(),vec![keybindings::KeyBinding::plain("F20")]);
        let out=ui.render(m.clone(),v.clone());let painted:Vec<_>=array(&out["commands"]).iter().filter(|c|c["op"]=="text").map(|c|s(&c["text"])).collect();
        assert_eq!(painted.join(" ").contains("Keyboard hint marker"),!coarse,"width={width} texts={painted:?}");
        let history=ui.widgets.controls.iter().find(|c|c.id=="history-open").unwrap();assert_eq!(history.shortcut.as_deref(),if coarse {None}else{Some("F20")});
        if !coarse {ui.event(json!({"type":"key","key":"F20"}));assert!(ui.history_open);let out=ui.render(m.clone(),v.clone());assert!(array(&out["commands"]).iter().map(|c|s(&c["text"])).collect::<Vec<_>>().join(" ").contains("Keyboard hint marker"));ui.event(json!({"type":"key","key":"Escape"}));}
        m["input"]=json!({"kind":"space"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["mode"]=json!("help");m["frame"]["ui"]["lines"]=json!([{"id":"ui.help.entry","text":"Ctrl + R redraw marker","args":[{"value":"Ctrl + R"},{"value":"help.redraw"}]}]);m["frame"]["ui"]["window"]=crate::game_window::render(&m["frame"]["ui"],"ja");
        let out=ui.render(m,v);assert_eq!(array(&out["commands"]).iter().map(|c|s(&c["text"])).collect::<Vec<_>>().join(" ").contains("redraw marker"),!coarse);
    }
}


#[test]
fn pad_hold_shares_start_repeat_and_release_across_pointer_modes() {
    for (width,coarse,pointer) in [(1240.,false,"mouse"),(390.,false,"mouse"),(390.,true,"touch")] {
        let mut ui=BrowserUi::new(measure);let mut v=view(width,900.);v["coarse"]=json!(coarse);
        let mut m=shortcut_model();m["inputRequests"]=json!(10);ui.render(m.clone(),v.clone());
        let c=ui.widgets.controls.iter().find(|c|c.id=="touch-h").unwrap().clone();let x=c.rect.x+c.rect.w/2.;let y=c.rect.y+c.rect.h/2.;
        let down=ui.event(json!({"type":"down","id":1,"x":x,"y":y,"pointerType":pointer,"button":0,"primary":true}));
        assert_eq!(array(&down["effects"]).iter().filter(|e|e["kind"]=="send"&&e["key"]==104).count(),1,"{width} {pointer}");
        assert!(array(&down["effects"]).iter().any(|e|e["kind"]=="hold-timer"&&e["delay"]==350));
        let pending=ui.event(json!({"type":"hold-tick","id":1}));
        assert!(!array(&pending["effects"]).iter().any(|e|e["kind"]=="send"),"An unfinished C input cannot repeat");
        m["inputRequests"]=json!(11);ui.render(m.clone(),v.clone());
        let repeat=ui.event(json!({"type":"hold-tick","id":1}));
        assert_eq!(array(&repeat["effects"]).iter().filter(|e|e["kind"]=="send"&&e["key"]==(104|rogue_contract::RG_EVENT_REPEAT)).count(),1);
        assert!(array(&repeat["effects"]).iter().any(|e|e["kind"]=="hold-timer"&&e["delay"]==100));
        let up=ui.event(json!({"type":"up","id":1,"x":x,"y":y,"pointerType":pointer,"captured":true}));
        assert!(!array(&up["effects"]).iter().any(|e|e["kind"]=="send"),"Release must not add a second activation");
        m["inputRequests"]=json!(12);ui.render(m,v);
        assert!(array(&ui.event(json!({"type":"hold-tick","id":1}))["effects"]).is_empty());
        assert!(ui.captured_ids().is_empty());
    }
}

#[test]
fn pad_hold_stops_on_cancel_leave_and_prompt() {
    for stop in ["cancel","move-out","leave","prompt"] {
        let mut ui=BrowserUi::new(measure);let v=view(390.,900.);let mut m=shortcut_model();m["inputRequests"]=json!(10);ui.render(m.clone(),v.clone());
        let c=ui.widgets.controls.iter().find(|c|c.id=="touch-l").unwrap().clone();let x=c.rect.x+c.rect.w/2.;let y=c.rect.y+c.rect.h/2.;
        ui.event(json!({"type":"down","id":1,"x":x,"y":y,"pointerType":"mouse","button":0,"primary":true}));
        assert!(ui.holding(1), "The stop boundary starts with an active pad hold");
        match stop {
            "cancel"=>{ui.event(json!({"type":"cancel","id":1}));},
            "move-out"=>{ui.event(json!({"type":"move","id":1,"x":c.rect.x-12.,"y":y,"pointerType":"mouse","buttons":1,"captured":true}));},
            "leave"=>{ui.event(json!({"type":"leave"}));},
            _=>{m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(true);},
        }
        m["inputRequests"]=json!(11);ui.render(m,v);
        assert!(!array(&ui.event(json!({"type":"hold-tick","id":1}))["effects"]).iter().any(|e|e["kind"]=="send"),"{stop}");
    }
}

#[test]
fn pad_hold_direction_choice_remains_a_single_release_activation() {
    for (width,coarse,pointer) in [(1240.,false,"mouse"),(390.,false,"mouse"),(390.,true,"touch")] {
        let mut ui=BrowserUi::new(measure);let mut v=view(width,900.);v["coarse"]=json!(coarse);let mut m=shortcut_model();m["input"]=json!({"kind":"direction"});m["frame"]["ui"]["input"]=m["input"].clone();m["frame"]["ui"]["movement_direction"]=json!(true);m["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&m["frame"]["ui"],false);ui.render(m,v);
        let c=ui.widgets.controls.iter().find(|c|c.id=="touch-l").unwrap().clone();let x=c.rect.x+c.rect.w/2.;let y=c.rect.y+c.rect.h/2.;
        let down=ui.event(json!({"type":"down","id":1,"x":x,"y":y,"pointerType":pointer,"button":0,"primary":true}));
        assert!(!array(&down["effects"]).iter().any(|e|matches!(s(&e["kind"]),"send"|"hold-timer")));
        let up=ui.event(json!({"type":"up","id":1,"x":x,"y":y,"pointerType":pointer,"captured":true}));
        assert_eq!(array(&up["effects"]).iter().filter(|e|e["kind"]=="send"&&e["key"]==108).count(),1);
    }
}

#[test]
fn responsive_phone_direction_preserves_full_map_unavailability() {
    let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();m["frame"]["ui"]["movement_direction"]=json!(true);let mut v=view(390.,900.);v["coarse"]=json!(true);ui.render(m,v);
    assert!(!ui.web_available(WebAction::FullMap));assert!(ui.web_available(WebAction::Settings));let mut effects=Vec::new();ui.activate_web(WebAction::FullMap,&mut effects);assert!(!ui.mobile_full_map);assert!(effects.is_empty());
}

#[test]
fn search_unification_has_one_registry_and_picker_command() {
    assert!(commands::command("web.context").is_none());
    assert_eq!(commands::all_commands().iter().filter(|c|c.id=="game.search").count(),1);
    assert!(!keybindings::default_bindings().contains_key("web.context"));
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();let v=view(390.,900.);ui.render(m.clone(),v.clone());
    ui.open_controls_editor(controls_editor::EditMode::Assignment);ui.controls_editor.as_mut().unwrap().selected=Some(2);ui.render(m,v);
    assert_eq!(ui.widgets.controls.iter().filter(|c|c.id=="control-pick-game.search").count(),1);
    assert!(!ui.widgets.controls.iter().any(|c|c.id=="control-pick-web.context"));
}

#[test]
fn search_unification_migrates_old_roles_and_bindings_without_losing_layout() {
    use control_preferences::ControlForm;
    let mut old=serde_json::to_value(control_preferences::ControlsPreferences::default()).unwrap();
    for form in ["desktop","phone"] {old[form].as_object_mut().unwrap().remove("contextual_search");}
    old["desktop"]["assignments"][1]=json!("web.context");old["phone"]["assignments"][2]=json!("game.search");old["phone"]["assignments"][4]=json!("web.context");
    old["bindings"]["game.search"]=json!([{"key":"s","ctrl":true}]);old["bindings"]["web.context"]=json!([{"key":"F20"}]);old["bindings"]["game.inventory"]=json!([{"key":"F21"}]);
    let mut ui=BrowserUi::new(measure);ui.load_control_preferences(&old.to_string());let saved=ui.control_preferences();
    for (form,index) in [("desktop",1),("phone",4)] {assert_eq!(saved[form]["assignments"][index],"game.search");assert_eq!(saved[form]["contextual_search"],json!([index]));assert_eq!(saved[form]["columns"],old[form]["columns"]);}
    assert_eq!(saved["phone"]["assignments"][2],"game.search","An explicitly fixed old Search remains fixed");
    assert_eq!(ui.command_bindings("game.search").iter().map(keybindings::KeyBinding::label).collect::<Vec<_>>(),["Ctrl+s","F20"]);
    assert_eq!(ui.command_bindings("game.inventory"),vec![keybindings::KeyBinding::plain("F21")]);assert!(saved["bindings"].get("web.context").is_none());
    let mut reload=BrowserUi::new(measure);reload.load_control_preferences(&saved.to_string());assert_eq!(reload.control_preferences(),saved);
    reload.controls_preferences.profile_mut(ControlForm::Phone).swap(4,0);
    assert_eq!(reload.control_preferences()["phone"]["contextual_search"],json!([4]),"The role moves with its logical button when columns exchange it");
}

#[test]
fn search_unification_binding_merge_preserves_conflicts_and_eight_alias_limit() {
    let mut raw=serde_json::to_value(keybindings::default_bindings()).unwrap();raw["game.search"]=json!([{"key":"s","ctrl":true}]);raw["web.context"]=json!([{"key":"i"},{"key":"s","ctrl":true},{"key":"F20"}]);
    let bindings=keybindings::sanitize_bindings(&raw);
    assert!(!bindings.contains_key("web.context"));assert_eq!(bindings["game.search"].iter().map(keybindings::KeyBinding::label).collect::<Vec<_>>(),["Ctrl+s","F20"]);assert_eq!(bindings["game.inventory"],vec![keybindings::KeyBinding::plain("i")]);
    raw["game.search"]=json!((5..=12).map(|i|json!({"key":format!("F{i}")})).collect::<Vec<_>>());raw["web.context"]=json!([{"key":"F20"}]);let bindings=keybindings::sanitize_bindings(&raw);
    assert_eq!(bindings["game.search"].len(),8);assert_eq!(bindings["game.search"][0].label(),"F5");assert_eq!(bindings["game.search"][7].label(),"F12");assert_eq!(bindings["game.inventory"],vec![keybindings::KeyBinding::plain("i")]);
}

#[test]
fn search_unification_ui_role_resolves_labels_keys_and_actions_but_search_stays_fixed() {
    for (width,coarse) in [(1240.,false),(390.,false),(390.,true)] {
        for (key,resolved,surface,ascend,descend) in [(115,"game.search",1,false,false),(62,"game.downstairs",1,false,true),(60,"game.upstairs",1,true,false),(44,"game.pickup",17,false,false),(94,"game.trap",7,false,false)] {
            let mut ui=BrowserUi::new(measure);let mut m=shortcut_model();let mut v=view(width,900.);v["coarse"]=json!(coarse);
            m["frame"]["map_player_surface"]=json!({"tile":surface});m["frame"]["ui"]["map_controls"]["stairs"]=json!({"ascend":ascend,"descend":descend});
            let mut prefs=serde_json::to_value(control_preferences::ControlsPreferences::default()).unwrap();let form=if width<700.||coarse {"phone"}else{"desktop"};prefs[form]["assignments"][1]=json!("game.search");prefs[form]["assignments"][2]=json!("game.search");prefs[form]["contextual_search"]=json!([2]);prefs["bindings"]["game.downstairs"]=json!([{"key":"F20"}]);ui.load_control_preferences(&prefs.to_string());ui.render(m,v);
            let fixed_id=if form=="phone" {"touch-action-action.inventory"}else{"pc-inventory"};let adaptive_id=if form=="phone" {"touch-search"}else{"pc-wield"};
            let fixed=ui.widgets.controls.iter().find(|c|c.id==fixed_id).unwrap().clone();let adaptive=ui.widgets.controls.iter().find(|c|c.id==adaptive_id).unwrap().clone();
            assert_eq!(fixed.action,json!({"kind":"command","id":"game.search"}));assert_eq!(fixed.key,Some(json!(115)));assert_eq!(fixed.shortcut.as_deref(),if coarse {None}else{Some("s")});
            assert_eq!(adaptive.action,json!({"kind":"command","id":resolved}));assert_eq!(adaptive.key,Some(json!(key)));assert!(adaptive.label.contains(&ui.t(ui.mobile_context_command().1)));
            assert_eq!(adaptive.shortcut,if coarse {None}else{ui.command_shortcut(resolved)});
            let mut effects=Vec::new();ui.activate(&adaptive,&Value::Null,&mut effects);assert_eq!(effects,vec![json!({"kind":"send","key":key})]);
            let physical=ui.event(json!({"type":"key","key":"s"}));assert!(array(&physical["effects"]).iter().any(|e|e["kind"]=="send"&&e["key"]==115));
        }
    }
}

#[test]
fn search_unification_editor_clears_changed_role_and_restores_the_default_role() {
    let mut ui=BrowserUi::new(measure);let m=shortcut_model();let mut v=view(390.,900.);v["coarse"]=json!(true);ui.render(m.clone(),v.clone());ui.open_controls_editor(controls_editor::EditMode::Assignment);
    for command in ["game.inventory","game.search"] {ui.controls_editor.as_mut().unwrap().selected=Some(2);ui.render(m.clone(),v.clone());let c=ui.widgets.controls.iter().find(|c|c.id==format!("control-pick-{command}")).unwrap().clone();ui.editor_activate(&c,&mut Vec::new());}
    let draft=serde_json::to_value(&ui.controls_editor.as_ref().unwrap().draft).unwrap();assert_eq!(draft["assignments"][2],"game.search");assert_eq!(draft["contextual_search"],json!([]));
    ui.render(m,v);let c=ui.widgets.controls.iter().find(|c|c.id=="controls-default").unwrap().clone();ui.editor_activate(&c,&mut Vec::new());let draft=serde_json::to_value(&ui.controls_editor.as_ref().unwrap().draft).unwrap();assert_eq!(draft["assignments"][2],"game.search");assert_eq!(draft["contextual_search"],json!([2]));
}
