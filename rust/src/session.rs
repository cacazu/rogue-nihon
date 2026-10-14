//! FFI initialization data and borrowed views over the plugins' actual resources.
use rogue_display::DisplayState;

#[derive(Default)]
pub(crate) struct Session {
    pub(crate) platform: rogue_platform::Session,
    pub(crate) display: DisplayState,
    pub(crate) input: rogue_input::State,
}
pub(crate) struct SessionRef<'a> {
    pub(crate) platform: &'a rogue_platform::Session,
    pub(crate) display: &'a DisplayState,
    pub(crate) input: &'a rogue_input::State,
}
pub(crate) struct SessionMut<'a> {
    pub(crate) platform: &'a mut rogue_platform::Session,
    pub(crate) display: &'a mut DisplayState,
    pub(crate) input: &'a mut rogue_input::State,
}
