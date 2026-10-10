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
}

#[derive(Resource, Default)]
pub struct ViewPort {
    pub requested: bool,
    pub ui: Value,
}

#[derive(Resource, Default)]
pub struct FramePort {
    pub requested: Option<Value>,
    pub ready: Option<Value>,
    pub effect: Option<(i32, i32, i32, i32)>,
    pub terrain: Option<Vec<u8>>,
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
    mut window: Single<&mut GameWindowView>,
    map: Single<&ObservedMap>,
) {
    if !port.requested {
        return;
    }
    port.requested = false;
    port.ui = state.presentation.render(&state.language, &state.name);
    port.ui["can_drop"] = json!(map.can_drop());
    inventory::decorate(&state.inventory, &mut port.ui, &state.language);
    port.ui["map_controls"] = game_window::map_controls(&port.ui, map.on_stairs());
    window.descriptor = port.ui["window"].clone();
}

fn render_frame(
    view: Res<ViewPort>,
    mut port: ResMut<FramePort>,
    mut map: Single<&mut ObservedMap>,
) {
    if let Some(terrain) = port.terrain.take() {
        map.terrain(terrain);
    }
    if let Some((x, y, glyph, active)) = port.effect.take() {
        map.effect(x, y, glyph, active);
    }
    if let Some(frame) = port.requested.take() {
        port.ready = Some(map.present(frame, &view.ui, BEVY_VERSION));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plugin_owns_map_entities_and_renders_observed_actor_terrain() {
        let mut app = App::new();
        app.add_plugins(RogueDisplayPlugin).configure_sets(
            Update,
            (RogueSystems::Presentation, RogueSystems::Frame).chain(),
        );
        app.world_mut().resource_mut::<DisplayState>().language = "ja".into();
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
