//! Bevy event decoding and editor updates after a platform journal commit.
use crate::{Input, State};
use bevy::prelude::*;
use rogue_contract::{JournalPort, RogueSystems};
use rogue_display::{DisplayState, GameWindowView, map::ObservedMap};
use serde_json::{Value, json};

#[derive(Resource, Default)]
pub struct InputPort {
    pub raw: Option<u32>,
    pub decoded: Option<Input>,
}

pub struct RogueInputPlugin;
impl Plugin for RogueInputPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<State>()
            .init_resource::<InputPort>()
            .init_resource::<JournalPort>()
            .add_systems(Update, decode_input.in_set(RogueSystems::Input))
            .add_systems(
                Update,
                update_accepted_input.in_set(RogueSystems::AcceptedInput),
            );
    }
}

fn decode_input(
    mut state: ResMut<State>,
    display: Res<DisplayState>,
    window: Single<&GameWindowView>,
    map: Single<&ObservedMap>,
    mut port: ResMut<InputPort>,
) {
    let Some(raw) = port.raw.take() else {
        return;
    };
    let mut ui = display
        .presentation
        .render(&display.language, &display.name);
    ui["can_drop"] = json!(map.can_drop());
    port.decoded = Some(state.decode(raw, &ui, !window.descriptor.is_null()));
}

fn update_accepted_input(
    mut state: ResMut<State>,
    mut display: ResMut<DisplayState>,
    mut port: ResMut<JournalPort>,
) {
    let Some(key) = port.committed.take() else {
        return;
    };
    if let Some(text) = state.accepted(key) {
        display.presentation.input["current_text"] = Value::String(text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rogue_display::RogueDisplayPlugin;
    #[test]
    fn plugin_decodes_unicode_and_only_committed_bytes_update_the_editor() {
        let mut app = App::new();
        app.add_plugins((RogueDisplayPlugin, RogueInputPlugin));
        app.world_mut().resource_mut::<DisplayState>().language = "ja".into();
        app.world_mut()
            .resource_mut::<DisplayState>()
            .presentation
            .input = json!({"kind":"text"});
        {
            let mut state = app.world_mut().resource_mut::<State>();
            state.text_mode = true;
            state.text_limit = 4;
        }
        app.world_mut().resource_mut::<InputPort>().raw = Some('🗡' as u32);
        app.update();
        assert_eq!(
            app.world_mut().resource_mut::<InputPort>().decoded.take(),
            Some(Input::Key(0xf0))
        );
        assert!(app.world().resource::<State>().text_bytes.is_empty());
        for byte in "🗡".as_bytes() {
            app.world_mut().resource_mut::<JournalPort>().committed = Some(i32::from(*byte));
            app.update();
        }
        assert_eq!(app.world().resource::<State>().text_bytes, "🗡".as_bytes());
        assert_eq!(
            app.world().resource::<DisplayState>().presentation.input["current_text"],
            "🗡"
        );
    }
}
