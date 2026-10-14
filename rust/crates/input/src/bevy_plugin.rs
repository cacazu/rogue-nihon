//! Bevy event decoding and editor updates after a platform journal commit.
use crate::{Input, State};
use bevy::prelude::*;
use rogue_contract::{JournalPort, RogueSystems};
use rogue_display::InputView;

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
    view: Res<InputView>,
    mut port: ResMut<InputPort>,
) {
    let Some(raw) = port.raw.take() else {
        return;
    };
    port.decoded = Some(state.decode(raw, &view.ui, view.window_open));
}

fn update_accepted_input(
    mut state: ResMut<State>,
    mut port: ResMut<JournalPort>,
) {
    let Some(key) = port.committed.take() else {
        return;
    };
    state.accepted(key);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rogue_display::RogueDisplayPlugin;
    use serde_json::json;
    #[test]
    fn plugin_decodes_unicode_and_only_committed_bytes_update_the_editor() {
        let mut app = App::new();
        app.add_plugins((RogueDisplayPlugin, RogueInputPlugin));
        app.world_mut().resource_mut::<InputView>().ui = json!({"input":{"kind":"text"}});
        {
            let mut state = app.world_mut().resource_mut::<State>();
            state.begin_text(4, "");
        }
        app.world_mut().resource_mut::<InputPort>().raw = Some('🗡' as u32);
        app.update();
        assert_eq!(
            app.world_mut().resource_mut::<InputPort>().decoded.take(),
            Some(Input::Key(0xf0))
        );
        assert_eq!(app.world().resource::<State>().current_text(), Some(""));
        for byte in "🗡".as_bytes() {
            app.world_mut().resource_mut::<JournalPort>().committed = Some(i32::from(*byte));
            app.update();
        }
        assert_eq!(app.world().resource::<State>().current_text(), Some("🗡"));
    }
}
