//! Bevy session, journal and save systems. This plugin does not import other layers.
use crate::Session;
use bevy::prelude::*;
use rogue_contract::{JournalPort, RogueSystems};
use serde_json::Value;

#[derive(Resource, Default)]
pub struct SavePort {
    pub requested: bool,
    pub presentation: Value,
    pub result: Option<Result<Vec<u8>, String>>,
}

pub struct RoguePlatformPlugin;
impl Plugin for RoguePlatformPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Session>()
            .init_resource::<JournalPort>()
            .init_resource::<SavePort>()
            .add_systems(Update, journal_input.in_set(RogueSystems::Journal))
            .add_systems(Update, serialize_save.in_set(RogueSystems::Save));
    }
}

fn journal_input(mut session: ResMut<Session>, mut port: ResMut<JournalPort>) {
    let Some(key) = port.key.take() else {
        return;
    };
    port.accepted = session.accept_key(key);
    port.committed = port.accepted.then_some(key);
}

fn serialize_save(session: Res<Session>, mut port: ResMut<SavePort>) {
    if !port.requested {
        return;
    }
    port.requested = false;
    let mut presentation = port.presentation.take();
    session.message_paging.mark(&mut presentation);
    port.result = Some(session.save_bytes(presentation));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plugin_commits_keys_and_reports_save_errors_without_other_plugins() {
        let mut app = App::new();
        app.add_plugins(RoguePlatformPlugin);
        app.world_mut().resource_mut::<JournalPort>().key = Some(32);
        app.update();
        assert_eq!(app.world().resource::<Session>().journal, vec![32]);
        assert_eq!(app.world().resource::<JournalPort>().committed, Some(32));
        {
            let mut session = app.world_mut().resource_mut::<Session>();
            session.input_index = u32::MAX;
            session.checkpoint_error = Some("checkpoint unavailable".into());
        }
        app.world_mut().resource_mut::<JournalPort>().key = Some(46);
        app.world_mut().resource_mut::<SavePort>().requested = true;
        app.update();
        assert!(!app.world().resource::<JournalPort>().accepted);
        assert_eq!(app.world().resource::<Session>().journal, vec![32]);
        assert_eq!(
            app.world_mut().resource_mut::<SavePort>().result.take(),
            Some(Err("checkpoint unavailable".into()))
        );
    }
}
