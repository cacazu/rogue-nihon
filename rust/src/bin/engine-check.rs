use rogue_contract as abi;
use rogue_input as input;
use rogue_platform as platform;
// Run the real Bevy App in Wasm without importing C or the browser host.
#[allow(dead_code)] // This fixture deliberately exercises a subset of the integration API.
#[path = "../engine.rs"]
mod engine;
#[path = "../session.rs"]
#[allow(dead_code)] // This fixture uses a subset of the borrowed C/JS session view.
mod session;
use input::Input;
use serde_json::{Value, json};
use session::Session;
fn fresh() {
    engine::reset(Session {
        platform: platform::Session {
            name: "勇者".into(),
            ..platform::Session::default()
        },
        display: rogue_display::DisplayState {
            language: "ja".into(),
            ..Default::default()
        },
        ..Session::default()
    });
}
fn frame(cells: String) -> Value {
    json!({"type":"frame","width":80,"height":24,"cells":cells,"player":{"x":2,"y":2},"stats":{"turn":0}})
}
fn terrain(x: usize, y: usize, glyph: u8) {
    let mut glyphs = vec![255; 80 * 24];
    glyphs[y * 80 + x] = glyph;
    engine::map_terrain(glyphs);
}
fn main() {
    fresh();
    assert_eq!(
        engine::decode(abi::RG_KEY_UP | abi::RG_EVENT_SHIFT),
        Input::Key(75)
    );
    assert_eq!(engine::decode(abi::RG_KEY_SAVE), Input::Save);
    assert_eq!(engine::decode(abi::RG_KEY_END_INPUT), Input::End);
    assert_eq!(engine::decode(abi::RG_EVENT_ALT | 27), Input::Ignore);
    assert_eq!(engine::with_session(|s| s.input_index), 0);
    engine::with_session_mut(|s| {
        s.display.presentation.update(
            "menu",
            1,
            0,
            "ui.inventory.empty",
            json!([]),
            "You are empty handed.",
        );
        s.display
            .presentation
            .update("input", -2, 0, "input.close", json!([]), "");
    });
    assert!(!engine::render_ui()["window"].is_null());
    for key in [13, 27] {
        assert_eq!(engine::decode(key), Input::Key(32));
        assert!(engine::accept_key(32));
    }
    assert_eq!(engine::with_session(|s| s.journal.clone()), vec![32, 32]);
    fresh();
    engine::with_session_mut(|s| {
        s.input.text_mode = true;
        s.input.text_limit = 6;
        s.display.presentation.input = json!({"kind":"text"});
    });
    for character in ['勇', '者'] {
        let Input::Key(first) = engine::decode(character as u32) else {
            panic!("UTF-8 scalar must be accepted");
        };
        assert!(engine::accept_key(first));
        while let Some(key) = engine::with_session_mut(|s| s.input.text_pending.pop_front()) {
            assert!(engine::accept_key(key));
        }
    }
    assert_eq!(
        engine::with_session(|s| s.input.text_bytes.clone()),
        "勇者".as_bytes()
    );
    assert_eq!(engine::decode('界' as u32), Input::Ignore);
    assert_eq!(engine::with_session(|s| s.input.text_pending.len()), 0);
    assert_eq!(engine::decode(127), Input::Key(8));
    assert!(engine::accept_key(8));
    assert_eq!(
        engine::with_session(|s| s.input.text_bytes.clone()),
        "勇".as_bytes()
    );
    engine::with_session_mut(|s| {
        s.checkpoint = vec![1, 2, 3];
        s.checkpoint_presentation = serde_json::to_value(&s.display.presentation).unwrap();
    });
    let bytes = engine::save_bytes().expect("save envelope");
    let saved = platform::Envelope::parse(&bytes).expect("valid envelope");
    assert_eq!(saved.name, "勇者");
    assert_eq!(saved.inputs.len(), 7);
    assert_eq!(saved.input_index, 7);
    fresh();
    let mut cells = vec![b' '; 80 * 24];
    cells[2 * 80 + 2] = b'@';
    cells[2 * 80 + 3] = b'.';
    let raw = String::from_utf8(cells).unwrap();
    terrain(2, 2, b'#');
    let game = engine::present(frame(raw.clone()));
    assert_eq!(game["map_player_underlay"], json!({"x":2,"y":2,"tile":2}));
    assert_eq!(game["engine"]["name"], "Bevy");
    assert_eq!(game["cells"], raw);
    engine::with_session_mut(|s| {
        s.display.presentation.update(
            "menu",
            1,
            0,
            "ui.inventory.empty",
            json!([]),
            "You are empty handed.",
        );
        s.display
            .presentation
            .update("input", -2, 0, "input.close", json!([]), "");
    });
    let menu = engine::present(frame(" ".repeat(80 * 24)));
    assert_eq!(menu["map_cells"], game["map_cells"]);
    assert_eq!(menu["map_tiles"], game["map_tiles"]);
    assert_eq!(menu["map_player_underlay"], game["map_player_underlay"]);
    assert_eq!(menu["map_underlays"], game["map_underlays"]);
    assert!(!menu["ui"]["window"].is_null());
    for _ in 0..40 {
        engine::render_ui();
    }
    assert_eq!(engine::cached_frame(), Some(menu));
    assert_eq!(engine::with_session(|s| s.input_index), 0);
    fresh();
    assert!(engine::cached_frame().is_none());
    assert!(engine::render_ui()["window"].is_null());
    for (glyph, tile) in [
        (b' ', 0),
        (b'.', 1),
        (b'#', 2),
        (b'+', 3),
        (b'%', 6),
        (b'^', 7),
    ] {
        terrain(2, 2, glyph);
        let presented = engine::present(frame(raw.clone()));
        assert_eq!(
            presented["map_player_underlay"],
            json!({"x":2,"y":2,"tile":tile})
        );
    }
    terrain(3, 2, b'+');
    assert!(engine::present(frame(raw.clone()))["map_player_underlay"].is_null());
    terrain(2, 2, b'X');
    assert!(engine::present(frame(raw.clone()))["map_player_underlay"].is_null());
    let mut actors = raw.as_bytes().to_vec();
    actors[2 * 80 + 3] = b'E';
    actors[2 * 80 + 4] = b'Z';
    let mut glyphs = vec![255; 80 * 24];
    glyphs[2 * 80 + 2] = b'+';
    glyphs[2 * 80 + 3] = b'#';
    glyphs[2 * 80 + 4] = b' ';
    engine::map_terrain(glyphs);
    let actors = String::from_utf8(actors).unwrap();
    let observed = engine::present(frame(actors.clone()));
    assert_eq!(
        observed["map_underlays"],
        json!([
            {"x":2,"y":2,"tile":3}, {"x":3,"y":2,"tile":2}, {"x":4,"y":2,"tile":0}
        ])
    );
    assert_eq!(observed["cells"], actors);
    engine::map_terrain(vec![255; 80 * 24]);
    let cleared = engine::present(frame(actors));
    assert_eq!(cleared["map_underlays"], json!([]));
    assert!(cleared["map_player_underlay"].is_null());
    assert_eq!(engine::with_session(|s| s.input_index), 0);
    println!(
        "{{\"engine\":\"Bevy\",\"version\":\"{}\",\"checks\":46,\"passed\":true}}",
        abi::BEVY_VERSION
    );
}
