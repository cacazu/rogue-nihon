//! FFI initialization data and borrowed views over the plugins' actual resources.
use rogue_display::DisplayState;
use std::ops::{Deref, DerefMut};

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
impl Deref for Session {
    type Target = rogue_platform::Session;
    fn deref(&self) -> &Self::Target {
        &self.platform
    }
}
impl DerefMut for Session {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.platform
    }
}
impl Deref for SessionRef<'_> {
    type Target = rogue_platform::Session;
    fn deref(&self) -> &Self::Target {
        self.platform
    }
}
impl Deref for SessionMut<'_> {
    type Target = rogue_platform::Session;
    fn deref(&self) -> &Self::Target {
        self.platform
    }
}
impl DerefMut for SessionMut<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.platform
    }
}
