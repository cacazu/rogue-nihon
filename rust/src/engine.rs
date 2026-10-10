//! FFI-owned Bevy App connecting the three independently implemented plugins.
//! Updates remain synchronous; only C host requests advance this App.
use crate::{
    input,
    session::{Session, SessionMut, SessionRef},
};
use bevy::ecs::schedule::SingleThreadedExecutor;
use bevy::prelude::*;
use rogue_contract::{JournalPort, RogueSystems};
use rogue_display::{DisplayState, FramePort, RogueDisplayPlugin, ViewPort, map::ObservedMap};
use rogue_input::{InputPort, RogueInputPlugin, State as InputState};
use rogue_platform::{RoguePlatformPlugin, SavePort, Session as PlatformSession};
use serde_json::Value;
use std::cell::RefCell;

struct Runtime {
    app: App,
}
impl Default for Runtime {
    fn default() -> Self {
        let mut app = App::new();
        app.add_plugins((RoguePlatformPlugin, RogueDisplayPlugin, RogueInputPlugin))
            .configure_sets(
                Update,
                (
                    RogueSystems::Presentation,
                    RogueSystems::Input,
                    RogueSystems::Journal,
                    RogueSystems::AcceptedInput,
                    RogueSystems::Frame,
                    RogueSystems::Save,
                )
                    .chain(),
            )
            .add_systems(
                Update,
                sync_display_state.before(RogueSystems::Presentation),
            )
            .edit_schedule(Update, |schedule| {
                schedule.set_executor(SingleThreadedExecutor::new());
            });
        // C runs synchronously in this Worker. The browser owns its event loop;
        // winit, TimePlugin and an autonomous App runner must not step C.
        app.finish();
        app.cleanup();
        Self { app }
    }
}
thread_local! { static RUNTIME: RefCell<Runtime> = RefCell::new(Runtime::default()); }

pub(crate) fn reset(session: Session) {
    RUNTIME.with(|runtime| {
        let mut fresh = Runtime::default();
        fresh.app.insert_resource(session.platform);
        fresh.app.insert_resource(session.display);
        fresh.app.insert_resource(session.input);
        *runtime.borrow_mut() = fresh;
    });
}

pub(crate) fn with_session<T>(f: impl FnOnce(&SessionRef<'_>) -> T) -> T {
    RUNTIME.with(|runtime| {
        let runtime = runtime.borrow();
        let world = runtime.app.world();
        f(&SessionRef {
            platform: world.resource::<PlatformSession>(),
            display: world.resource::<DisplayState>(),
            input: world.resource::<InputState>(),
        })
    })
}
pub(crate) fn with_session_mut<T>(f: impl FnOnce(&mut SessionMut<'_>) -> T) -> T {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime
            .app
            .world_mut()
            .resource_scope(|world, mut platform: Mut<PlatformSession>| {
                world.resource_scope(|world, mut display: Mut<DisplayState>| {
                    let mut input = world.resource_mut::<InputState>();
                    f(&mut SessionMut {
                        platform: &mut platform,
                        display: &mut display,
                        input: &mut input,
                    })
                })
            })
    })
}
pub(crate) fn render_ui() -> Value {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<ViewPort>().requested = true;
        runtime.app.update();
        runtime.app.world().resource::<ViewPort>().ui.clone()
    })
}
pub(crate) fn decode(raw: u32) -> input::Input {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<ViewPort>().requested = true;
        runtime.app.world_mut().resource_mut::<InputPort>().raw = Some(raw);
        runtime.app.update();
        runtime
            .app
            .world_mut()
            .resource_mut::<InputPort>()
            .decoded
            .take()
            .unwrap_or(input::Input::Ignore)
    })
}
pub(crate) fn accept_key(key: i32) -> bool {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<JournalPort>().key = Some(key);
        runtime.app.update();
        runtime.app.world().resource::<JournalPort>().accepted
    })
}
pub(crate) fn inventory_key() -> Option<i32> {
    with_session_mut(|session| {
        session
            .input
            .inventory
            .next_key(&session.display.presentation)
    })
}
pub(crate) fn present(frame: Value) -> Value {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<ViewPort>().requested = true;
        runtime
            .app
            .world_mut()
            .resource_mut::<FramePort>()
            .requested = Some(frame);
        runtime.app.update();
        runtime
            .app
            .world_mut()
            .resource_mut::<FramePort>()
            .ready
            .take()
            .expect("Bevy frame system must complete its request")
    })
}
pub(crate) fn map_effect(x: i32, y: i32, glyph: i32, active: i32) {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<FramePort>().effect = Some((x, y, glyph, active));
        runtime.app.update();
    });
}
pub(crate) fn map_terrain(glyphs: Vec<u8>) {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.app.world_mut().resource_mut::<FramePort>().terrain = Some(glyphs);
        runtime.app.update();
    });
}
#[cfg(feature = "test-hooks")]
pub(crate) fn cached_frame() -> Option<Value> {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let world = runtime.app.world_mut();
        world
            .query::<&ObservedMap>()
            .single(world)
            .expect("one observed map")
            .frame()
            .cloned()
    })
}
pub(crate) fn finish_ui() -> Value {
    let ui = render_ui();
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let world = runtime.app.world_mut();
        let mut query = world.query::<&mut ObservedMap>();
        query
            .single_mut(world)
            .expect("one observed map")
            .update_ui(ui.clone());
    });
    ui
}
pub(crate) fn save_bytes() -> Result<Vec<u8>, String> {
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let world = runtime.app.world_mut();
        let mut presentation = world
            .resource::<PlatformSession>()
            .checkpoint_presentation
            .clone();
        world
            .resource::<InputState>()
            .inventory
            .mark(&mut presentation);
        let mut port = world.resource_mut::<SavePort>();
        port.presentation = presentation;
        port.requested = true;
        runtime.app.update();
        runtime
            .app
            .world_mut()
            .resource_mut::<SavePort>()
            .result
            .take()
            .expect("Bevy save system must complete its request")
    })
}

// Cross-layer projection only; each plugin owns and executes its layer's systems.
fn sync_display_state(
    platform: Res<PlatformSession>,
    input: Res<InputState>,
    mut display: ResMut<DisplayState>,
) {
    display.name.clone_from(&platform.name);
    display.inventory = input.inventory.view();
}
