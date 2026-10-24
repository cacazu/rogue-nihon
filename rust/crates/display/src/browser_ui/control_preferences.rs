//! Persisted logical dock columns; viewport coordinates never enter preferences.
use super::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub(super) enum ControlForm { Desktop, Phone }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="kind",content="buttons",rename_all="lowercase")]
pub(super) enum Column { Pad, Buttons([usize;3]) }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct ControlProfile {
    pub columns: Vec<Column>,
    pub assignments: Vec<String>,
}
impl ControlProfile {
    pub fn defaults(form:ControlForm)->Self {
        let commands: &[&str] = match form {
            ControlForm::Desktop => &["web.movement","game.inventory","game.wield","game.wear","game.search","game.throw","game.zap","game.read","web.repeat","web.full-map","game.eat","game.quaff"],
            ControlForm::Phone => &["web.movement","game.inventory","web.context","web.full-map","web.commands","web.repeat"],
        };
        let count=commands.len()/3;
        let mut columns=(0..count).map(|column|Column::Buttons([column,column+count,column+count*2])).collect::<Vec<_>>();
        match form { ControlForm::Desktop=>columns.insert(0,Column::Pad),ControlForm::Phone=>{columns.reverse();columns.push(Column::Pad);} }
        Self {columns,assignments:commands.iter().map(|id|(*id).into()).collect()}
    }
    pub fn swap(&mut self,from:usize,to:usize) {
        let locate=|id|self.columns.iter().enumerate().find_map(|(column,value)|match value {
            Column::Pad if id==usize::MAX => Some((column,0)),
            Column::Buttons(ids) => ids.iter().position(|button|*button==id).map(|row|(column,row)),
            _=>None,
        });
        let (Some((a,ar)),Some((b,br)))=(locate(from),locate(to)) else{return;};
        if from==usize::MAX || to==usize::MAX {self.columns.swap(a,b);return;}
        if let Column::Buttons(ids)=&mut self.columns[a] {ids[ar]=to;}
        if let Column::Buttons(ids)=&mut self.columns[b] {ids[br]=from;}
    }
    pub fn valid(&self,form:ControlForm)->bool {
        let count=match form {ControlForm::Desktop=>12,ControlForm::Phone=>6};
        let mut buttons:Vec<usize>=Vec::new();let mut pads=0;
        for column in &self.columns {match column {Column::Pad=>pads+=1,Column::Buttons(ids)=>buttons.extend(ids)}}
        buttons.sort_unstable();
        pads==1 && buttons==(0..count).collect::<Vec<_>>() && self.assignments.len()==count
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_default_is_exact_twelve_in_three_rows_and_four_columns() {
        let p=ControlProfile::defaults(ControlForm::Desktop);
        assert_eq!(p.columns,vec![Column::Pad,Column::Buttons([0,4,8]),Column::Buttons([1,5,9]),Column::Buttons([2,6,10]),Column::Buttons([3,7,11])]);
        assert_eq!(p.assignments,["web.movement","game.inventory","game.wield","game.wear","game.search","game.throw","game.zap","game.read","web.repeat","web.full-map","game.eat","game.quaff"]);
    }
    #[test]
    fn pad_swaps_a_whole_column_while_buttons_swap_individually() {
        let mut p=ControlProfile::defaults(ControlForm::Desktop);
        let assignments=p.assignments.clone();
        p.swap(usize::MAX,4);
        assert_eq!(p.columns[0],Column::Buttons([0,4,8]));
        assert_eq!(p.columns[1],Column::Pad);
        p.swap(0,11);
        assert_eq!(p.columns[0],Column::Buttons([11,4,8]));
        assert_eq!(p.columns[4],Column::Buttons([3,7,0]));
        assert_eq!(p.assignments,assignments);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct ControlsPreferences {
    pub version: u32,
    pub desktop: ControlProfile,
    pub phone: ControlProfile,
    #[serde(default)]
    pub bindings: BTreeMap<String,Vec<super::keybindings::KeyBinding>>,
}
impl Default for ControlsPreferences {
    fn default()->Self {Self {version:1,desktop:ControlProfile::defaults(ControlForm::Desktop),phone:ControlProfile::defaults(ControlForm::Phone),bindings:super::keybindings::default_bindings()}}
}
impl ControlsPreferences {
    pub fn profile(&self,form:ControlForm)->&ControlProfile {match form {ControlForm::Desktop=>&self.desktop,ControlForm::Phone=>&self.phone}}
    pub fn profile_mut(&mut self,form:ControlForm)->&mut ControlProfile {match form {ControlForm::Desktop=>&mut self.desktop,ControlForm::Phone=>&mut self.phone}}
}
impl BrowserUi {
    pub fn control_preferences(&self)->Value {serde_json::to_value(&self.controls_preferences).expect("controls preferences")}
    pub fn load_control_preferences(&mut self,raw:&str) {
        let Ok(value)=serde_json::from_str::<Value>(raw) else{return;};
        if value["version"]!=1 {return;}
        let mut prefs=ControlsPreferences::default();
        for (form,key) in [(ControlForm::Desktop,"desktop"),(ControlForm::Phone,"phone")] {
            if let Ok(mut profile)=serde_json::from_value::<ControlProfile>(value[key].clone()) {
                if profile.valid(form) {
                    let defaults=ControlProfile::defaults(form);
                    for (index,id) in profile.assignments.iter_mut().enumerate() {
                        if commands::command(id).is_none() {*id=defaults.assignments[index].clone();}
                    }
                    *prefs.profile_mut(form)=profile;
                }
            }
        }
        prefs.bindings=super::keybindings::sanitize_bindings(&value["bindings"]);
        self.controls_preferences=prefs;
    }
    pub(super) fn control_form(&self)->ControlForm {
        if self.compact_layout() {ControlForm::Phone} else {ControlForm::Desktop}
    }
    pub(super) fn dock_profile(&self,form:ControlForm)->ControlProfile {
        self.controls_editor.as_ref().filter(|e|e.form==form).map(|e|e.draft.clone()).unwrap_or_else(||self.controls_preferences.profile(form).clone())
    }
}
