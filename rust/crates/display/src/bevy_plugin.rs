//! Bevy resources, map/window entities and rendering systems owned by display.
use crate::{
    game_window, inventory, inventory::InventoryView, map::ObservedMap, presentation::Presentation,
};
use bevy::prelude::*;
use rogue_contract::{BEVY_VERSION, RogueSystems};
use serde_json::{Value, json};

#[derive(Resource, Default)]
pub struct DisplayState {
    pub language: String,
    pub name: String,
    pub presentation: Presentation,
    pub inventory: InventoryView,
    pub player: crate::player_state::PlayerState,
}

#[derive(Resource, Default)]
pub struct ViewPort {
    pub requested: bool,
    pub ui: Value,
}

/// Immutable input observation, before inventory decoration changes the view.
#[derive(Resource, Default)]
pub struct InputView {
    pub ui: Value,
    pub window_open: bool,
}

#[derive(Resource, Default)]
pub struct FramePort {
    pub requested: Option<Value>,
    pub ready: Option<Value>,
    pub effect: Option<(i32, i32, i32, i32)>,
    pub terrain: Option<Vec<u8>>,
    pub actors: Vec<crate::map::ActorObservation>,
}

#[derive(Component, Default)]
pub struct GameWindowView {
    pub descriptor: Value,
}

pub struct RogueDisplayPlugin;
impl Plugin for RogueDisplayPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<DisplayState>()
            .init_resource::<ViewPort>()
            .init_resource::<InputView>()
            .init_resource::<FramePort>()
            .add_systems(
                Update,
                render_presentation.in_set(RogueSystems::Presentation),
            )
            .add_systems(Update, render_frame.in_set(RogueSystems::Frame));
        app.world_mut().spawn(GameWindowView::default());
        app.world_mut().spawn(ObservedMap::default());
    }
}

fn render_presentation(
    state: Res<DisplayState>,
    mut port: ResMut<ViewPort>,
    mut input: ResMut<InputView>,
    mut window: Single<&mut GameWindowView>,
    map: Single<&ObservedMap>,
) {
    if !port.requested {
        return;
    }
    port.requested = false;
    input.ui = state.presentation.render(&state.language, &state.name);
    input.ui["player_state"] = json!(state.player);
    input.ui["can_drop"] = json!(map.can_drop());
    project_view(&state, &mut input, &mut port, &mut window, map.on_stairs());
}

fn project_view(
    state: &DisplayState,
    input: &mut InputView,
    view: &mut ViewPort,
    window: &mut GameWindowView,
    on_stairs: bool,
) {
    view.ui = input.ui.clone();
    inventory::decorate(&state.inventory, &mut view.ui, &state.language);
    view.ui["map_controls"] = game_window::map_controls(&view.ui, on_stairs);
    window.descriptor = view.ui["window"].clone();
    input.window_open = !window.descriptor.is_null();
}

fn render_frame(
    state: Res<DisplayState>,
    mut view: ResMut<ViewPort>,
    mut input: ResMut<InputView>,
    mut port: ResMut<FramePort>,
    mut map: Single<&mut ObservedMap>,
    mut window: Single<&mut GameWindowView>,
) {
    for observation in port.actors.drain(..) {
        map.observe_actor(observation);
    }
    if let Some(terrain) = port.terrain.take() {
        map.terrain(terrain);
    }
    if let Some((x, y, glyph, active)) = port.effect.take() {
        map.effect(x, y, glyph, active);
    }
    if let Some(frame) = port.requested.take() {
        let mut frame = map.present(frame, &view.ui, BEVY_VERSION);
        if !frame.is_null() {
            // Re-project controls from this frame's observed footing, so the
            // input snapshot and painted actions cannot retain the old floor.
            input.ui["can_drop"] = json!(map.can_drop());
            project_view(&state, &mut input, &mut view, &mut window, map.on_stairs());
            frame["ui"] = view.ui.clone();
            map.update_ui(view.ui.clone());
        }
        port.ready = Some(frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> App {
        let mut app = App::new();
        app.add_plugins(RogueDisplayPlugin).configure_sets(
            Update,
            (RogueSystems::Presentation, RogueSystems::Frame).chain(),
        );
        app.world_mut().resource_mut::<DisplayState>().language = "ja".into();
        app
    }

    #[test]
    fn inventory_input_snapshot_retains_the_original_prompt_before_view_decoration() {
        let mut app = app();
        let row = json!({"scope":"inventory","row":0,"col":0,"id":"ui.inventory.entry",
            "args":[{"kind":"char","value":97},{"kind":"entity","value":{
                "type":"item","category":"weapon","which":0,"count":1,"equipped":"none"}}],
            "fallback":"a) A mace","key":"a","selectable":true});
        {
            let mut state = app.world_mut().resource_mut::<DisplayState>();
            state.presentation.lines = vec![row.clone(), json!({"scope":"browse"})];
            state.presentation.input =
                json!({"kind":"space","id":"input.close","args":[],"fallback":""});
            state.inventory.selected = Some(row);
        }
        app.world_mut().resource_mut::<ViewPort>().requested = true;
        app.update();
        let input = app.world().resource::<InputView>();
        let view = app.world().resource::<ViewPort>();
        assert_eq!(input.ui["input"]["kind"], "space");
        assert_eq!(input.ui["window"]["kind"], "menu");
        assert!(input.window_open);
        assert_eq!(input.ui["lines"][0]["selectable"], true);
        assert_eq!(view.ui["input"]["kind"], "inventory");
        assert_eq!(view.ui["window"]["kind"], "inventory_actions");
        assert_eq!(view.ui["lines"][0]["selectable"], false);
    }

    #[test]
    fn frame_input_and_painted_controls_share_the_current_observed_footing() {
        let mut app = app();
        for (glyph, can_drop, stairs) in [
            (b'.', true, false),
            (b'+', false, false),
            (b'%', false, true),
            (b'.', true, false),
        ] {
            let mut cells = vec![b' '; 80 * 24];
            cells[2 * 80 + 2] = b'@';
            let mut terrain = vec![255; 80 * 24];
            terrain[2 * 80 + 2] = glyph;
            app.world_mut().resource_mut::<ViewPort>().requested = true;
            {
                let mut port = app.world_mut().resource_mut::<FramePort>();
                port.terrain = Some(terrain);
                port.requested = Some(json!({"width":80,"height":24,
                    "cells":String::from_utf8(cells).unwrap(),"player":{"x":2,"y":2}}));
            }
            app.update();
            let frame = app
                .world_mut()
                .resource_mut::<FramePort>()
                .ready
                .take()
                .unwrap();
            let input = app.world().resource::<InputView>();
            let view = app.world().resource::<ViewPort>();
            assert_eq!(input.ui["can_drop"], can_drop);
            assert_eq!(view.ui["can_drop"], can_drop);
            assert_eq!(frame["ui"], view.ui);
            assert_eq!(frame["ui"]["map_controls"]["stairs"]["descend"], stairs);
            let world = app.world_mut();
            assert_eq!(
                world.query::<&ObservedMap>().single(world).unwrap().frame(),
                Some(&frame)
            );
        }
    }

    #[test]
    fn plugin_owns_map_entities_and_renders_observed_actor_terrain() {
        let mut app = app();
        let mut cells = vec![b' '; 80 * 24];
        cells[2 * 80 + 2] = b'@';
        cells[2 * 80 + 3] = b'D';
        let mut terrain = vec![255; 80 * 24];
        terrain[2 * 80 + 2] = b'+';
        terrain[2 * 80 + 3] = b'#';
        app.world_mut().resource_mut::<ViewPort>().requested = true;
        let mut port = app.world_mut().resource_mut::<FramePort>();
        port.terrain = Some(terrain);
        port.requested = Some(
            json!({"width":80,"height":24,"cells":String::from_utf8(cells).unwrap(),"player":{"x":2,"y":2}}),
        );
        app.update();
        let frame = app
            .world_mut()
            .resource_mut::<FramePort>()
            .ready
            .take()
            .unwrap();
        assert_eq!(
            frame["map_underlays"],
            json!([{"x":2,"y":2,"tile":3},{"x":3,"y":2,"tile":2}])
        );
        assert_eq!(frame["engine"]["name"], "Bevy");
        let world = app.world_mut();
        assert_eq!(
            world.query::<&ObservedMap>().single(world).unwrap().frame(),
            Some(&frame)
        );
    }
}
