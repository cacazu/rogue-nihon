use super::*;
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
fn responsive_hud_has_one_row_and_centered_icons() {
    let mut ui = BrowserUi::new(measure);
    for (width, height, fullscreen) in [
        (320., 844., false),
        (320., 844., true),
        (390., 844., false),
        (390., 844., true),
        (700., 900., false),
        (700., 900., true),
        (1240., 900., false),
        (1240., 900., true),
        (844., 390., false),
        (844., 390., true),
    ] {
        let mut surface = view(width, height);
        surface["fullscreen"] = json!(fullscreen);
        let output = ui.render(model(), surface);
        let hud = &output["diagnostics"]["hud"];
        let row: Rect = serde_json::from_value(hud["row"].clone()).unwrap();
        assert_eq!(array(&hud["items"]).len(), 8);
        let name: Rect = serde_json::from_value(hud["nameRect"].clone()).unwrap();
        assert_eq!(name.y, row.y);
        assert_eq!(name.x, row.x);
        let mut right = name.x + name.w;
        for item in array(&hud["items"]) {
            let rect: Rect = serde_json::from_value(item["rect"].clone()).unwrap();
            assert_eq!(rect.y, row.y);
            let gap = if item["id"] == "experience" { 0. } else { 10. };
            assert!((rect.x - right - gap).abs() < 0.01);
            right = rect.x + rect.w;
            assert!(n(&item["size"]) >= 18.);
        }
        assert_eq!(hud["items"][0]["text"], "-1");
        assert_eq!(hud["items"][5]["id"], "level");
        assert_eq!(hud["items"][5]["text"], "1");
        assert_eq!(hud["items"][6]["id"], "experience");
        assert_eq!(hud["items"][6]["text"], "0");
        assert_eq!(hud["items"][6]["separator"], "=");
        assert!(ui.widgets.icons.iter().any(|icon| icon["name"] == "stairs"));
        assert!(ui.widgets.icons.iter().any(|icon| icon["glyph"] == "👑"));
        assert!(ui.widgets.icons.iter().any(|icon| icon["glyph"] == "☆"));
        let button = ui
            .widgets
            .controls
            .iter()
            .find(|c| c.id == "settings-toggle")
            .unwrap();
        let icon = ui
            .widgets
            .icons
            .iter()
            .find(|i| i["name"] == "settings")
            .unwrap();
        let rect: Rect = serde_json::from_value(icon["rect"].clone()).unwrap();
        let panel: Rect = serde_json::from_value(hud["panel"].clone()).unwrap();
        assert!(!button.rect.overlaps(panel));
        assert_eq!(rect.x + rect.w / 2., button.rect.x + button.rect.w / 2.);
        assert_eq!(rect.y + rect.h / 2., button.rect.y + button.rect.h / 2.);
        let map: Rect = serde_json::from_value(output["diagnostics"]["mapRect"].clone()).unwrap();
        for id in ["settings-toggle", "header-fullscreen"] {
            let control = ui.widgets.controls.iter().find(|c| c.id == id).unwrap();
            assert!(map.contains(control.rect.x, control.rect.y));
            assert!(control.rect.x + control.rect.w <= map.x + map.w);
            assert!(control.rect.y + control.rect.h <= map.y + map.h);
            assert!(!control.rect.overlaps(panel));
            assert_eq!(control.rect.w, 44.);
            assert_eq!(control.rect.h, 44.);
        }
        assert!(
            ui.widgets
                .icons
                .iter()
                .any(|icon| icon["name"] == if fullscreen { "collapse" } else { "expand" })
        );
        let mut depth = 0;
        for command in array(&output["commands"]) {
            match s(&command["op"]) {
                "save" | "clip" => depth += 1,
                "restore" => depth -= 1,
                _ => {}
            }
            assert!(depth >= 0);
        }
        assert_eq!(depth, 0);
    }
}
#[test]
fn hud_click_and_escape_are_local_and_never_send_game_input() {
    let mut ui = BrowserUi::new(measure);
    ui.render(model(), view(390., 844.));
    let clicked = click(&mut ui, "hud-hp");
    assert!(
        array(&clicked["effects"])
            .iter()
            .all(|e| e["kind"] != "send")
    );
    let output = ui.render(model(), view(390., 844.));
    assert_eq!(output["diagnostics"]["hud"]["tooltip"]["id"], "hp");
    let escape = ui.event(json!({"type":"key","key":"Escape"}));
    assert_eq!(escape["consumed"], true);
    assert!(array(&escape["effects"]).is_empty());
    ui.render(model(), view(390., 844.));
    assert!(ui.hud.layout["tooltip"].is_null());
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
fn hud_swipe_and_keyboard_reveal_items_without_game_commands() {
    let mut ui = BrowserUi::new(measure);
    ui.render(model(), view(320., 844.));
    let row: Rect = serde_json::from_value(ui.hud.layout["row"].clone()).unwrap();
    let x = row.x + row.w - 30.;
    let y = row.y + row.h / 2.;
    ui.event(
        json!({"type":"down","id":8,"x":x,"y":y,"pointerType":"touch","button":0,"primary":true}),
    );
    let moved = ui.event(json!({"type":"move","id":8,"x":x-120.,"y":y,"pointerType":"touch","buttons":1,"captured":true}));
    assert!(
        array(&moved["effects"])
            .iter()
            .all(|effect| effect["kind"] != "send")
    );
    ui.event(json!({"type":"up","id":8,"x":x-120.,"y":y,"pointerType":"touch","captured":true}));
    ui.render(model(), view(320., 844.));
    assert!(n(&ui.hud.layout["offset"]) > 0.);
    ui.widgets.focus = "hud-experience".into();
    ui.event(json!({"type":"key","key":"Tab"}));
    ui.render(model(), view(320., 844.));
    let control = ui
        .widgets
        .controls
        .iter()
        .find(|control| control.id == "hud-hunger")
        .unwrap();
    assert!(
        control.rect.w > 0. && control.full_rect.x + control.full_rect.w <= row.x + row.w + 0.01
    );
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
