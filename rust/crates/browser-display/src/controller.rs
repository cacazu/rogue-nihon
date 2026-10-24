//! Owns browser session policy. The Rust browser host reports observations and executes effects.
use crate::policies::*;
use crate::save_operations::{PendingSave, SaveOperation, SaveOperations};
use rogue_contract::RG_KEY_SAVE;
use rogue_display::{
    animation::Animator,
    browser_ui::{BrowserUi, tiles},
    widgets::{MeasureText, Rect},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub struct Controller {
    ui: BrowserUi,
    autowalk: crate::autowalk::AutoWalk,
    animations: Animator,
    model: Value,
    state: Value,
    inputs: Value,
    environment: Value,
    history: History,
    catalog: Catalog,
    effects: Vec<Value>,
    input: Value,
    composing: bool,
    waiting_for_request: bool,
    run_stop_request: Option<u64>,
    text_mode: bool,
    draft_dirty: bool,
    window_open: bool,
    restore_pending: bool,
    terminal_error: bool,
    last_level: Option<u64>,
    autosave_due: bool,
    return_after_save: bool,
    session_ended: bool,
    ending_ack: i64,
    window_close_ack: String,
    assets_ready: BTreeSet<String>,
    assets_error: bool,
    saves: SaveOperations,
    inventory_preference_cache: String,
    inventory_lifetime: crate::inventory_lifetime::InventoryLifetime,
    control_preference_cache: String,
    ranking_book: crate::rankings::Book,
    ranking_pending: Vec<crate::rankings::Score>,
    ranking_request: u64,
    ranking_io: Option<(u64,Option<String>)>,
    ranking_finalized: BTreeSet<String>,
    adventure_id: String,
    restore_adventure: Option<String>,
}
impl Controller {
    pub fn new(measure: MeasureText) -> Self {
        Self {
            ui: BrowserUi::new(measure),
            autowalk: crate::autowalk::AutoWalk::default(),
            animations: Animator::new(tiles::animation_manifest("tiles"), tiles::animation_manifest("pixels"))
                .expect("Character animation manifests"),
            model: json!({"language":"ja","topOpen":true,"settingsOpen":false,"starting":false,"running":false,"ready":false,"saved":false,"downloadAvailable":false,"savePending":false,"returnAfterEnd":false,"itemHistoryOpen":false,"returnToInventory":false,"generation":0,"displayMode":"tiles","tileSize":32,"animationEnabled":true,"handedness":"right","theme":rogue_display::theme::Theme::default().id(),"frame":null,"topNotice":null,"fieldErrors":{}}),
            state: json!({"exitCode":null,"outcome":null,"runtimeError":null,"frameCount":0,"inputRequestCount":0,"trace":null,"traces":[],"playerEvents":[],"messages":[],"logs":[],"translationFallbacks":[],"savedLength":0}),
            inputs: json!({}),
            environment: Value::Null,
            history: History::default(),
            catalog: Catalog::default(),
            effects: Vec::new(),
            input: Value::Null,
            composing: false,
            waiting_for_request: false,
            run_stop_request: None,
            text_mode: false,
            draft_dirty: false,
            window_open: false,
            restore_pending: false,
            terminal_error: false,
            last_level: None,
            autosave_due: false,
            return_after_save: false,
            session_ended: false,
            ending_ack: -1,
            window_close_ack: String::new(),
            assets_ready: BTreeSet::new(),
            assets_error: false,
            saves: SaveOperations::default(),
            inventory_preference_cache: String::new(),
            inventory_lifetime: Default::default(),
            control_preference_cache: String::new(),
            ranking_book: Default::default(),ranking_pending:Vec::new(),ranking_request:0,ranking_io:None,
            ranking_finalized:BTreeSet::new(),adventure_id:String::new(),restore_adventure:None,
        }
    }
    fn ranking_preview(&mut self) {
        let mut book=self.ranking_book.clone();
        for score in &self.ranking_pending {if let Ok(next)=book.merge(score.clone()) {book=next;}}
        self.model["rankings"]=book.value();
    }
    fn ranking_begin(&mut self) {
        if self.ranking_io.is_some() {return;}
        self.ranking_request=self.ranking_request.wrapping_add(1);
        self.model["rankingLoading"]=json!(true);
        if let Some(score)=self.ranking_pending.first() {
            self.ranking_io=Some((self.ranking_request,Some(score.adventure.clone())));
            self.effects.push(json!({"kind":"rankings-write","request":self.ranking_request,"score":score.value()}));
        } else {
            self.ranking_io=Some((self.ranking_request,None));
            self.effects.push(json!({"kind":"rankings-read","request":self.ranking_request}));
        }
    }
    fn ranking_result(&mut self,data:&Value) {
        if self.restore_pending || self.ranking_finalized.contains(&self.adventure_id) {return;}
        let Some(score)=crate::rankings::Score::from_result(data,&self.adventure_id) else {return;};
        self.ranking_finalized.insert(self.adventure_id.clone());self.ranking_pending.push(score);
        self.ranking_preview();self.ranking_begin();
    }
    fn ranking_api(&mut self,r:&Value)->bool {
        let Some((request,adventure))=self.ranking_io.clone() else {return false;};
        if r["request"].as_u64()!=Some(request) {return false;}
        self.ranking_io=None;self.model["rankingLoading"]=json!(false);
        let loaded=if flag(&r["ok"]) {crate::rankings::Book::parse(Some(&r["rankings"].to_string()))} else {Err("Ranking IO failed".into())};
        match loaded {
            Ok(book)=>{
                self.ranking_book=book;self.model["rankingError"]=json!(false);self.model["rankingErrorId"]=Value::Null;
                if let Some(id)=adventure {self.ranking_pending.retain(|score|score.adventure!=id);}
                self.ranking_preview();if !self.ranking_pending.is_empty() {self.ranking_begin();}true
            },
            Err(_)=>{
                self.model["rankingError"]=json!(true);self.model["rankingErrorId"]=json!(if adventure.is_some(){"error.rankings_save"}else{"error.rankings_load"});self.ranking_preview();
                self.notice(if adventure.is_some() {"error.rankings_save"}else{"error.rankings_load"},json!({}),true);false
            }
        }
    }
    fn stop_autowalk(&mut self, reason: &'static str) {
        if self.autowalk.stop(reason) {
            self.effects.push(json!({"kind":"run-interrupt"}));
            self.effects.push(json!({"kind":"autowalk-timer"}));
        }
        self.release_target_run();
    }
    fn release_target_run(&mut self) {
        let request = number(&self.state["inputRequestCount"]);
        if self.input["kind"] == "run-boundary" && !self.waiting_for_request
            && self.run_stop_request != Some(request) {
            self.queue(json!([rogue_contract::RG_KEY_TARGET_RUN_STOP]), "target-run-stop");
        }
    }
    fn autowalk_available(&self) -> bool {
        flag(&self.model["running"]) && !flag(&self.model["topOpen"])
            && !flag(&self.model["settingsOpen"]) && !flag(&self.model["savePending"])
            && !flag(&self.model["returnAfterEnd"]) && !self.restore_pending && !self.session_ended
            && matches!(text(&self.input["kind"]), "command" | "run-boundary") && self.model["frame"]["ui"]["mode"] == "game"
            && !self.model["frame"]["ui"]["window"].is_object() && self.ui.map_navigation_available()
    }
    fn schedule_autowalk(&mut self) {
        if !self.autowalk.active() {
            self.release_target_run();
            return;
        }
        if self.waiting_for_request { return; }
        if !self.autowalk_available() { self.stop_autowalk("context"); return; }
        if let Some(mut effect) = self.autowalk.schedule(&self.model["frame"],&self.input,number(&self.state["inputRequestCount"])) {
            effect["generation"] = self.model["generation"].clone();
            if self.autowalk.uses_run() {
                let request=number(&self.state["inputRequestCount"]);
                if let Some(key)=self.autowalk.tick(&self.model["frame"],&self.input,request,number(&effect["token"])) {
                    self.queue(json!([key]),"autowalk");
                }
            } else {
                self.effects.push(effect);
            }
        } else if !self.autowalk.active() {
            self.release_target_run();
        }
    }
    fn notice(&mut self, id: &str, args: Value, error: bool) {
        self.history.notice(id, args.clone(), error);
        if flag(&self.model["topOpen"]) {
            self.model["topNotice"] = json!({"id":id,"args":args,"error":error});
        }
    }
    fn field_error(&mut self, field: &str, id: &str) {
        self.model["fieldErrors"][field] = json!({"id":id});
        self.focus(field);
    }
    fn log(&mut self, value: Value) {
        push(&mut self.state["logs"], value, 128);
    }
    fn label(&mut self, id: &str, args: &Value) -> String {
        self.catalog.label(text(&self.model["language"]), id, args)
    }
    fn validate_save(&mut self, bytes: &Value) -> Option<usize> {
        match crate::save_loading::validate(bytes) {
            Ok(length) => Some(length),
            Err(error) => {
                self.model["starting"] = json!(false);
                self.log(json!(error));
                self.notice("error.save_invalid", json!({}), true);
                None
            }
        }
    }
    fn save_operation(&mut self, operation: SaveOperation) -> PendingSave {
        self.saves.begin(operation, number(&self.model["generation"]))
    }
    fn read_save(&mut self, operation: SaveOperation) {
        let pending = self.save_operation(operation);
        self.effects.push(json!({"kind":"save-read","operation":operation.name(),"request":pending.request,"generation":pending.generation}));
    }
    fn save_candidate(&mut self, request: &Value, accepted: bool) {
        if request.is_u64() {
            self.effects.push(json!({"kind":if accepted {"save-accept"} else {"save-discard"},"request":request}));
        }
    }
    fn saved(&mut self, request: &Value, length: usize) {
        self.save_candidate(request, true);
        self.state["savedLength"] = json!(length);
        self.model["downloadAvailable"] = json!(length > 0);
    }
    fn retire_saves(&mut self) {
        for request in self.saves.retire() {
            self.save_candidate(&json!(request), false);
        }
    }
    fn restore_failed(&mut self) {
        self.return_top();
        self.notice("error.load", json!({}), true);
        self.terminal_error = true;
    }
    fn request_save(&mut self, return_after: bool) {
        if !flag(&self.model["running"]) || self.session_ended || self.ending() {
            if return_after { self.return_top(); }
            return;
        }
        if self.restore_pending { return; }
        if flag(&self.model["savePending"]) {
            self.return_after_save |= return_after;
            return;
        }
        if self.composing {
            self.field_error("prompt-text", "error.text_composing");
            self.settings(false);
            return;
        }
        let events = if self.text_mode && self.draft_dirty {
            self.text_batch(RG_KEY_SAVE)
        } else {
            Some(json!([RG_KEY_SAVE]))
        };
        if let Some(events) = events {
            self.autosave_due = false;
            self.return_after_save = return_after;
            self.queue(events, "save");
        }
    }
    fn cancel_save(&mut self) {
        self.model["savePending"] = json!(false);
        self.return_after_save = false;
        self.autosave_due = false;
    }
    fn discard_save(&mut self) {
        // Retire callbacks before deleting so an older write/read cannot adopt
        // bytes again after this slot has been consumed or the game has ended.
        self.retire_saves();
        self.cancel_save();
        self.model["saved"] = json!(false);
        self.model["downloadAvailable"] = json!(false);
        self.state["savedLength"] = json!(0);
        self.effects.push(json!({"kind":"save-clear"}));
        let pending = self.save_operation(SaveOperation::Delete);
        self.effects.push(json!({"kind":"save-delete","request":pending.request,"generation":pending.generation}));
    }
    fn end_session(&mut self) {
        self.stop_autowalk("end");
        if !self.session_ended {
            self.session_ended = true;
            self.discard_save();
        }
    }
    fn field(&mut self, id: &str, properties: Value) {
        if let Some(value) = properties.get("value") {
            self.inputs[id]["value"] = value.clone();
        }
        self.effects
            .push(json!({"kind":"field","id":id,"properties":properties}));
    }
    fn controls(&mut self) {
        let pending = std::mem::take(&mut self.effects);
        let disabled = flag(&self.model["starting"]) || !flag(&self.model["topOpen"]);
        self.field("name", json!({"disabled":disabled}));
        self.field("seed", json!({"disabled":disabled}));
        let disabled = !flag(&self.model["running"]) || flag(&self.model["settingsOpen"]);
        self.field(
            "prompt-text",
            json!({"disabled":disabled || !self.text_mode}),
        );
        self.field("command-key",json!({"disabled":disabled || !flag(&self.model["frame"]["ui"]["window"]["key_entry"])}));
        self.field("repeat-count",json!({"disabled":disabled || !self.ui.repeat_count_open()}));
        self.effects.extend(pending);
    }
    fn focus(&mut self, id: &str) {
        self.effects.push(if id == "canvas" {
            json!({"kind":"canvas-focus"})
        } else {
            json!({"kind":"native-focus","id":id})
        });
    }
    fn settings(&mut self, open: bool) {
        if open { self.stop_autowalk("context"); }
        self.model["settingsOpen"] = json!(open);
        self.focus(if !open && self.text_mode {
            "prompt-text"
        } else {
            "canvas"
        });
    }
    fn return_top(&mut self) {
        self.stop_autowalk("scene");
        if flag(&self.model["savePending"]) {
            return;
        }
        self.retire_saves();
        self.effects.push(json!({"kind":"worker-stop"}));
        self.animations.reset();
        self.state["animation"] = json!([]);
        for key in ["starting", "returnAfterEnd", "running", "settingsOpen", "windowClosing", "itemHistoryOpen", "returnToInventory"] {
            self.model[key] = json!(false);
        }
        self.model["topOpen"] = json!(true);
        self.model["frame"] = Value::Null;
        self.input = Value::Null;
        self.text_mode = false;
        self.draft_dirty = false;
        self.composing = false;
        self.restore_pending = false;
        self.inventory_lifetime.cancel_restore();
        self.restore_adventure=None;
        self.last_level = None;
        self.autosave_due = false;
        self.return_after_save = false;
        self.window_open = false;
        self.ending_ack = -1;
        self.history = History::default();
        self.model["topNotice"] = Value::Null;
        self.model["fieldErrors"] = json!({});
        self.focus("canvas");
        if flag(&self.environment["fullscreen"]) {
            self.effects
                .push(json!({"kind":"fullscreen","enter":false}));
        }
    }
    fn ending(&self) -> bool {
        matches!(
            text(&self.model["frame"]["ui"]["mode"]),
            "death" | "tombstone" | "score" | "victory"
        )
    }
    fn close_window(&mut self, first: bool) {
        if !flag(&self.model["running"]) {
            self.model["windowClosing"] = json!(false);
            if first { self.return_top(); }
            return;
        }
        let kind = text(&self.input["kind"]);
        if !first && !matches!(kind, "space" | "space_cancel" | "enter" | "inventory") {
            self.model["windowClosing"] = json!(false);
            return;
        }
        let request = format!("{}:{}", self.state["inputRequestCount"], self.model["frame"]["ui"]["window"]["kind"]);
        if !first && self.window_close_ack == request { return; }
        self.model["windowClosing"] = json!(true);
        self.window_close_ack = request;
        self.queue(json!([if kind == "confirm" { 110 } else { 27 }]), "send");
    }
    fn finish_ending(&mut self) {
        if !flag(&self.model["returnAfterEnd"])
            || !flag(&self.model["running"])
            || !self.ending()
            || self.ending_ack == number(&self.state["inputRequestCount"]) as i64
        {
            return;
        }
        let key = match text(&self.input["kind"]) {
            "space" => 32,
            "enter" => 13,
            _ => return,
        };
        self.queue(json!([key]), "end");
    }
    fn queue(&mut self, mut events: Value, after: &str) {
        if !flag(&self.model["running"]) {
            return;
        }
        let request = number(&self.state["inputRequestCount"]);
        if self.input["kind"] == "run-boundary" && self.run_stop_request != Some(request) {
            let gate_key = events.as_array().and_then(|a| a.first()).and_then(Value::as_u64);
            if !matches!(gate_key, Some(key) if key == rogue_contract::RG_KEY_TARGET_RUN_CONTINUE as u64
                || key == rogue_contract::RG_KEY_TARGET_RUN_STOP as u64
                || u32::try_from(key).ok().and_then(rogue_contract::target_run_permit).is_some()) {
                if let Some(keys) = events.as_array_mut() { keys.insert(0, json!(rogue_contract::RG_KEY_TARGET_RUN_STOP)); }
                self.run_stop_request = Some(request);
            } else if gate_key == Some(rogue_contract::RG_KEY_TARGET_RUN_STOP as u64) {
                self.run_stop_request = Some(request);
            }
        }
        self.waiting_for_request = true;
        self.effects.push(json!({"kind":"queue","events":events,"after":after,"generation":self.model["generation"],"request":self.state["inputRequestCount"]}));
    }
    fn fallback(&mut self, value: &Value, location: &str) -> bool {
        let missing = value["missing_ids"]
            .as_array()
            .is_some_and(|ids| !ids.is_empty());
        if flag(&value["fallback_used"]) || flag(&value["missing_translation"]) || missing {
            push(
                &mut self.state["translationFallbacks"],
                json!({"location":location,"id":value["id"],"missing_ids":value["missing_ids"].as_array().cloned().unwrap_or_default()}),
                2048,
            );
            return self.model["language"] == "ja";
        }
        false
    }
    fn translated(&mut self, value: &Value, location: &str) -> String {
        if !value["text"].is_string() {
            return String::new();
        }
        if self.fallback(value, location) {
            self.label("error.translation", &json!({}))
        } else {
            text(&value["text"]).into()
        }
    }
    fn entry_text(&mut self, entry: &Value) -> String {
        if entry["message"].is_object() {
            self.translated(&entry["message"], "log")
        } else {
            self.label(text(&entry["id"]), &entry["args"])
        }
    }
    fn presentation(&mut self) {
        let mut p = self.model["frame"]["ui"].clone();
        if crate::log_visibility::removed_guidance(&p["message"]) { p["message"] = Value::Null; }
        if crate::log_visibility::removed_guidance(&p["window"]["message"]) { p["window"]["message"] = Value::Null; }
        if let Some(lines) = p["lines"].as_array_mut() {
            lines.retain(|line| !crate::log_visibility::removed_guidance(line));
        }
        self.model["frame"]["ui"] = p.clone();
        let was_open = self.window_open;
        self.window_open = p["window"].is_object();
        if p.is_object() {
            for (value, where_) in [
                (&p, "ui"),
                (&p["status"], "status"),
                (&p["window"]["message"], "window-message"),
                (&p["more"], "more"),
                (&p["message"], "ui-message"),
            ] {
                self.fallback(value, where_);
            }
            for line in p["lines"].as_array().into_iter().flatten() {
                self.fallback(line, "line");
            }
            if p["message"].is_object()
                && !self.history.entries.iter().any(|e| e["source"] == "game")
            {
                self.history.message(p["message"].clone());
            }
            self.apply_input(if self.input.is_object() {
                self.input.clone()
            } else {
                p["input"].clone()
            });
        }
        if !flag(&self.model["settingsOpen"])
            && !self.text_mode
            && (was_open || self.window_open)
            && !(flag(&p["window"]["key_entry"]) && flag(&self.inputs["command-key"]["active"]))
        {
            self.focus("canvas");
        }
    }
    fn apply_input(&mut self, input: Value) {
        if !matches!(text(&input["kind"]), "command" | "run-boundary") { self.stop_autowalk("context"); }
        let next = input["kind"] == "text";
        let was = self.text_mode;
        self.field(
            "prompt-text",
            json!({"placeholder":text(&input["placeholder"])}),
        );
        if next && !was {
            self.draft_dirty = false;
        }
        if next && !self.draft_dirty {
            let value = input
                .get("current_text")
                .or(input.get("initial"))
                .and_then(Value::as_str)
                .unwrap_or("");
            self.field("prompt-text", json!({"value":value}));
        }
        if !next { self.model["fieldErrors"]["prompt-text"] = Value::Null; }
        self.text_mode = next;
        if input["kind"] == "discovery" { self.model["itemHistoryOpen"] = json!(true); }
        self.input = input;
        if !flag(&self.model["settingsOpen"]) {
            if next && !was {
                self.focus("prompt-text");
            } else if was && !next {
                self.focus("canvas");
            }
        }
    }
    fn start(&mut self, restore: bool) {
        self.stop_autowalk("scene");
        self.waiting_for_request = false;
        self.run_stop_request = None;
        if !restore && self.composing {
            let field = if flag(&self.inputs["seed"]["active"]) { "seed" } else { "name" };
            self.field_error(field, "error.text_composing");
            return;
        }
        if !flag(&self.environment["isolated"]) {
            self.model["starting"] = json!(false);
            self.notice("error.isolation", json!({}), true);
            return;
        }
        let entered_seed = seed(text(&self.inputs["seed"]["value"]));
        let entered_name = text(&self.inputs["name"]["value"]);
        let name = if entered_name.is_empty() {
            "Player"
        } else {
            entered_name
        };
        let valid_name = valid_text(name, 49, false);
        if !restore && entered_seed.is_none() {
            self.model["starting"] = json!(false);
            self.field_error("seed", "error.seed");
            return;
        }
        if !restore && !valid_name {
            self.model["starting"] = json!(false);
            self.field_error("name", if name.len() > 49 { "error.name" } else { "error.name_characters" });
            return;
        }
        let name = if valid_name {
            name.to_string()
        } else {
            "Player".into()
        };
        self.field("command-key", json!({"value":""}));
        if !restore {self.adventure_id=format!("{}:{}",text(&self.environment["instanceId"]),number(&self.model["generation"])+1);self.restore_adventure=None;}
        self.inventory_lifetime.start(restore);
        if !restore { self.ui.reset_adventure_view(); }
        self.retire_saves();
        self.effects.push(json!({"kind":"worker-stop"}));
        self.model["generation"] = json!(number(&self.model["generation"]) + 1);
        self.animations.reset();
        self.state["animation"] = json!([]);
        for key in [
            "topOpen",
            "settingsOpen",
            "running",
            "savePending",
            "returnAfterEnd",
            "windowClosing",
            "itemHistoryOpen",
            "returnToInventory",
        ] {
            self.model[key] = json!(false);
        }
        self.model["frame"] = Value::Null;
        self.model["topNotice"] = Value::Null;
        self.model["starting"] = json!(true);
        for key in ["trace", "outcome", "exitCode", "runtimeError"] {
            self.state[key] = Value::Null;
        }
        for key in ["traces", "playerEvents", "messages", "logs", "translationFallbacks"] {
            self.state[key] = json!([]);
        }
        self.state["frameCount"] = json!(0);
        self.state["inputRequestCount"] = json!(0);
        self.restore_pending = restore;
        self.terminal_error = false;
        self.model["fieldErrors"] = json!({});
        self.last_level = None;
        self.autosave_due = false;
        self.return_after_save = false;
        self.session_ended = false;
        self.text_mode = false;
        self.draft_dirty = false;
        self.input = Value::Null;
        self.window_open = false;
        self.ending_ack = -1;
        self.history = History::default();
        self.effects.push(json!({"kind":"worker-start","generation":self.model["generation"],"capacity":4096,
            "seed":entered_seed.unwrap_or(0),"name":name,"restore":restore,"locale":self.model["language"],
            "trace":self.environment["parameters"]["trace"]=="1","message_paging":"log"}));
    }
    fn persist_view(&mut self) {
        self.effects.push(json!({"kind":"storage-write","key":"rogue-map-display-v1","value":json!({"version":1,"mode":self.model["displayMode"],"zoom":self.model["tileSize"],"animation":self.model["animationEnabled"],"handedness":self.model["handedness"],"theme":self.model["theme"]}).to_string()}));
    }
    fn select(&mut self, id: &str, value: &str) {
        match id {
            "language" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) => {
                self.model["language"] = json!(if value == "en" { "en" } else { "ja" });
                self.document();
            }
            "theme" if rogue_display::theme::Theme::known(value)
                && !flag(&self.model["starting"]) && !flag(&self.model["savePending"]) => {
                self.model["theme"] = json!(value);
                self.persist_view();
                self.document();
            }
            "display-mode" if mode(value) => {
                self.model["displayMode"] = json!(value);
                self.persist_view();
            }
            _ => {}
        }
    }
    fn document(&mut self) {
        let title = self.label("app.title", &json!({}));
        let heading = self.label("app.heading", &json!({}));
        let theme = rogue_display::theme::Theme::named(text(&self.model["theme"]));
        self.effects
            .push(json!({"kind":"document","language":self.model["language"],"title":title,"heading":heading,
                "themeTarget":"canvas-stage","theme":theme.id(),"background":theme.color("@background"),"foreground":theme.color("@text.primary")}));
    }
    fn text_batch(&mut self, ending: u32) -> Option<Value> {
        let value = text(&self.inputs["prompt-text"]["value"]);
        let limit = self.input["limit_bytes"]
            .as_u64()
            .filter(|n| *n > 0)
            .unwrap_or(50) as usize;
        if !valid_text(value, limit, true) {
            let id = if value.len() > limit { "error.prompt_text" } else { "error.prompt_text_characters" };
            self.settings(false);
            self.field_error("prompt-text", id);
            return None;
        }
        self.model["fieldErrors"]["prompt-text"] = Value::Null;
        let mut events = vec![21];
        events.extend(value.chars().map(|c| c as u32));
        events.push(ending);
        Some(json!(events))
    }
    fn submit(&mut self, id: &str) {
        if flag(&self.model["settingsOpen"]) { return; }
        if self.composing {
            self.field_error(id, "error.text_composing");
            return;
        }
        match id {
            "repeat-count" => {
                if self.ui.confirm_repeat_count(text(&self.inputs[id]["value"])) {
                    self.focus("canvas");
                }
            }
            "name" | "seed" => self.invoke("new-game"),
            "command-key" if flag(&self.model["frame"]["ui"]["window"]["key_entry"]) => {
                let result = self
                    .ui
                    .event(json!({"type":"raw-key","key":self.inputs[id]["value"]}));
                if let Some(raw) = result["raw"].as_u64() {
                    self.queue(json!([raw]), "command");
                }
            }
            "prompt-text" if self.text_mode => {
                if let Some(events) = self.text_batch(13) {
                    self.queue(events, "submit");
                }
            }
            _ => {}
        }
    }
    fn invoke(&mut self, id: &str) {
        match id {
            "auto-explore" if self.autowalk_available() => {
                self.autowalk.start_explore(&self.model["frame"]);
                self.schedule_autowalk();
            },
            "handedness-toggle" if !flag(&self.model["starting"]) && !flag(&self.model["savePending"]) && !flag(&self.model["returnAfterEnd"]) => {
                self.model["handedness"] = json!(if self.model["handedness"] == "left" { "right" } else { "left" });
                self.persist_view();
            },
            "animation-toggle" if !flag(&self.model["starting"]) && !flag(&self.model["savePending"]) => {
                let enabled=!flag(&self.model["animationEnabled"]);
                self.model["animationEnabled"]=json!(enabled);
                self.animations.set_enabled(enabled);
                self.persist_view();
            },
            "import-save" if !flag(&self.model["starting"]) && !flag(&self.model["savePending"]) && !flag(&self.model["returnAfterEnd"]) => {
                self.model["starting"]=json!(true);
                let pending = self.save_operation(SaveOperation::Import);
                self.effects.push(json!({"kind":"save-import","request":pending.request,"generation":pending.generation}));
            },
            "credits-repository"=>self.effects.push(json!({"kind":"open","url":"https://github.com/cacazu/rogue-nihon"})),
            "rankings-read"=>self.ranking_begin(),
            "new-game" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) && flag(&self.model["ready"]) =>self.start(false),
            "load" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) => {
                self.model["starting"]=json!(true);self.read_save(SaveOperation::Load);
            },
            "settings-load" if !flag(&self.model["starting"]) && !flag(&self.model["savePending"]) && flag(&self.model["saved"]) => {
                self.model["starting"]=json!(true);self.read_save(SaveOperation::Load);
            },
            "save" if flag(&self.model["running"]) && !flag(&self.model["savePending"]) && !flag(&self.model["returnAfterEnd"]) => {
                self.request_save(false);
            },
            "download-save" if flag(&self.model["downloadAvailable"])=>self.effects.push(json!({"kind":"download","filename":"rogue-save.json","mime":"application/json","revokeAfter":1000})),
            "center-map"=>{self.ui.event(json!({"type":"center"}));},
            "fullscreen"|"header-fullscreen"=>self.effects.push(json!({"kind":"fullscreen","enter":!flag(&self.environment["fullscreen"])})),
            "settings-toggle" if !flag(&self.model["topOpen"]) && !flag(&self.model["returnAfterEnd"])=>self.settings(!flag(&self.model["settingsOpen"])),
            "settings-close"=>self.settings(false),"settings-top"=>self.request_save(true),
            "window-close" if !flag(&self.model["windowClosing"]) => self.close_window(true),
            "inventory-return" if flag(&self.model["itemHistoryOpen"]) && !flag(&self.model["windowClosing"]) => {
                self.model["returnToInventory"] = json!(true);
                self.close_window(true);
            },
            "result-top"=>{
                if !flag(&self.model["running"]) {self.return_top();}
                else if self.ending() && !flag(&self.model["returnAfterEnd"]) {self.model["returnAfterEnd"]=json!(true);self.finish_ending();}
            },
            "random-seed"|"random-name" if !flag(&self.model["starting"])=>self.effects.push(json!({"kind":"random","id":id})),_=>{}
        }
    }
    fn worker(&mut self, data: Value, generation: &Value, now: f64) {
        if generation != &self.model["generation"] || flag(&self.model["topOpen"]) {
            return;
        }
        match text(&data["type"]) {
            "ready" => {
                self.model["starting"] = json!(false);
                self.model["running"] = json!(true);

                if !flag(&self.model["settingsOpen"]) {
                    self.focus("canvas");
                }
            }
            "frame" => {
                let w = number(&data["width"]);
                let h = number(&data["height"]);
                let valid = w > 0
                    && w <= 256
                    && h > 0
                    && h <= 128
                    && data["cells"]
                        .as_str()
                        .is_some_and(|v| v.len() as u64 == w * h);
                let translated = data["map_cells"]
                    .as_str()
                    .is_some_and(|v| v.len() as u64 == w * h)
                    && data["ui"].is_object();
                let error = if !valid {
                    Some(("Invalid Rust frame", "error.frame"))
                } else if self.model["language"] == "ja" && !translated {
                    Some(("Missing translated presentation", "error.presentation"))
                } else if tiles::validate(&data, tiles::manifest_ref(text(&self.model["displayMode"])))
                    .is_err()
                {
                    Some(("Unmapped graphical map cell", "error.frame"))
                } else {
                    None
                };
                if let Some((error, id)) = error {
                    self.state["runtimeError"] = json!(error);
                    self.model["running"] = json!(false);
                    self.notice(id, json!({}), true);
                    self.terminal_error = true;
                    return;
                }
                if let Err(error) = self.animations.observe(&data, now) {
                    self.state["runtimeError"] = json!(error);
                    self.model["running"] = json!(false);
                    self.notice("error.frame", json!({}), true);
                    self.terminal_error = true;
                    return;
                }
                self.fallback(&data, "frame");
                if let Some(level) = data["stats"]["level"].as_u64().filter(|level| *level > 0) {
                    if self.last_level.is_some_and(|previous| previous != level)
                        && !self.restore_pending && !self.session_ended {
                        self.autosave_due = true;
                    }
                    self.last_level = Some(level);
                }
                if self.autowalk.observe(&data) { self.effects.push(json!({"kind":"autowalk-timer"})); }
                self.model["frame"] = data;
                self.state["frameCount"] = json!(number(&self.state["frameCount"]) + 1);
                self.presentation();
                if self.ending() { self.end_session(); }
            }
            "presentation" if self.model["frame"].is_object() && data["ui"].is_object() => {
                self.model["frame"]["ui"] = data["ui"].clone();
                self.input = data["ui"]["input"].clone();
                self.presentation();
                if self.ending() { self.end_session(); }
                if flag(&self.model["windowClosing"]) && flag(&self.model["frame"]["ui"]["inventory"]) {
                    self.close_window(false);
                }
            }
            "player-event" => {
                if matches!(text(&data["kind"]), "attacked" | "trap" | "attack")
                    && data["sequence"].as_u64().is_some_and(|s| s > 0) {
                    self.stop_autowalk(match text(&data["kind"]) {
                        "attacked" => "attacked", "trap" => "trap", _ => "attack",
                    });
                    push(&mut self.state["playerEvents"], data, 128);
                }
            }
            "target-run-ended" => self.stop_autowalk("natural"),
            "trace" => {
                self.state["trace"] = data.clone();
                push(&mut self.state["traces"], data, 2048);
            }
            "input-context" => self.apply_input(data["input"].clone()),
            "message" => {
                if crate::log_visibility::removed_guidance(&data) { return; }
                if data["id"] == "platform.restore_error" && self.restore_pending {
                    self.log(data);
                    return;
                }
                if data["id"] == "platform.name_error" && self.text_mode {
                    self.log(data);
                    self.field_error("prompt-text", "platform.name_error");
                    return;
                }
                if matches!(text(&data["id"]), "platform.input_limit" | "platform.error" | "platform.name_error" | "platform.restore_error") {
                    self.terminal_error = true;
                }
                if data["id"] == "platform.save_error" { self.cancel_save(); }
                push(&mut self.state["messages"], data.clone(), 128);
                self.history.message(data);
            }
            "input-request" => {
                self.waiting_for_request = false;
                self.state["inputRequestCount"] =
                    json!(number(&self.state["inputRequestCount"]) + 1);
                if self.restore_pending {
                    let view=self.inventory_lifetime.restored();self.ui.reset_inventory_view();
                    if let Some(view)=view {self.ui.load_inventory_preference(&view.to_string());}
                    self.restore_pending = false;
                    self.adventure_id=self.restore_adventure.take().unwrap_or_else(||format!("{}:restore:{}",text(&self.environment["instanceId"]),number(&self.model["generation"])));
                    self.discard_save();
                }
                if self.autosave_due && !flag(&self.model["savePending"]) {
                    self.request_save(false);
                }
                if flag(&self.model["windowClosing"]) { self.close_window(false); }
                if self.input["kind"] == "command" {
                    self.model["itemHistoryOpen"] = json!(false);
                    if flag(&self.model["returnToInventory"]) {
                        self.model["returnToInventory"] = json!(false);
                        self.queue(json!([105]), "send");
                    }
                }
                self.finish_ending();
                self.schedule_autowalk();
            }
            "input-flush" => {
                let discarded = data["events"].as_array().cloned().unwrap_or_default();
                if discarded.iter().any(|v| {
                    number(v) & rogue_contract::RG_EVENT_SCALAR_MASK as u64 == RG_KEY_SAVE as u64
                }) {
                    self.cancel_save();
                    self.notice("notice.save_cancelled", json!({}), true);
                }
            }
            "save" if !self.session_ended => {
                let pending = self.save_operation(SaveOperation::Write);
                self.effects.push(json!({"kind":"save-write","request":pending.request,"generation":pending.generation,"bytes":data["bytes"],"inventory":{"version":1,"view":self.ui.inventory_preference(),"adventure":self.adventure_id}}));
            }
            "score-result" => self.ranking_result(&data),
            "outcome" => {
                if data["code"].as_i64().is_some_and(|code| code >= 0) { self.end_session(); }
                self.state["outcome"] = json!({"code":data["code"],"text":data["text"]});
            }
            "exit" => {
                self.stop_autowalk("exit");
                self.cancel_save();
                self.state["exitCode"] = data["code"].clone();
                self.model["running"] = json!(false);
                self.animations.reset();
                if data["code"].as_i64().unwrap_or(-1) < 0 {
                    if self.restore_pending {
                        self.restore_failed();
                    } else if !self.terminal_error {
                        self.notice("error.runtime", json!({}), true);
                        self.terminal_error = true;
                    }
                } else if flag(&self.model["returnAfterEnd"]) {
                    self.return_top();
                }
            }
            "error" => {
                self.stop_autowalk("error");
                self.cancel_save();
                let starting = flag(&self.model["starting"]);
                self.state["runtimeError"] = data["text"].clone();
                self.model["running"] = json!(false);
                self.animations.reset();
                self.model["starting"] = json!(false);
                if self.restore_pending {
                    self.restore_failed();
                } else {
                    if starting { self.return_top(); }
                    if !self.terminal_error {
                        self.notice("error.runtime", json!({}), true);
                        self.terminal_error = true;
                    }
                }
                self.effects
                    .push(json!({"kind":"console","level":"error","text":data["text"]}));
            }
            "log" => {
                self.log(data["text"].clone());
                self.effects
                    .push(json!({"kind":"console","level":"info","text":data["text"]}));
            }
            _ => {}
        }
    }
    fn api(&mut self, r: &Value, redraw: &mut bool) -> bool {
        let ok = flag(&r["ok"]);
        let operation = text(&r["operation"]);
        if matches!(operation,"rankings-read"|"rankings-write") {return self.ranking_api(r);}
        if matches!(operation, "init" | "load" | "import" | "save-write" | "save-delete") {
            if self.saves.finish(r, number(&self.model["generation"])).is_none() {
                self.save_candidate(&r["request"], false);
                return false;
            }
        } else if r.get("generation").is_some() && r["generation"] != self.model["generation"] {
            return false;
        }
        match operation {
            "queue" => {
                if !ok {
                    self.waiting_for_request = false;
                    if r["after"] == "autowalk" { self.stop_autowalk("queue"); }
                    if r["after"] == "save" { self.cancel_save(); }
                    self.model["windowClosing"] = json!(false);
                    if r["after"] == "submit" || (r["after"] == "save" && self.text_mode) {
                        self.settings(false);
                        self.field_error("prompt-text", "error.queue_full");
                    } else if r["after"] == "command" {
                        self.field_error("command-key", "error.queue_full");
                    } else {
                        self.notice("error.queue_full", json!({}), true);
                    }
                    return false;
                }
                let interrupted = self.animations.interrupt();
                if r["after"] == "send" && !interrupted {
                    *redraw = false;
                }
                match text(&r["after"]) {
                    "save" => {
                        self.draft_dirty = false;
                        self.model["savePending"] = json!(true);
                        self.notice("notice.save_pending", json!({}), false);
                    }
                    "submit" => {
                        self.draft_dirty = false;
                        self.focus("canvas");
                    }
                    "command" => {
                        self.field("command-key", json!({"value":""}));
                        self.focus("canvas");
                    }
                    "end" => self.ending_ack = number(&r["request"]) as i64,
                    "send" => self.focus("canvas"),
                    _ => {}
                }
            }
            "import" => {
                self.model["starting"] = json!(false);
                if ok {
                    if let Some(length) = self.validate_save(&r["bytes"]) {
                        self.saved(&r["request"], length);
                        self.inventory_lifetime.stage_restore(&r["inventory"]);
                        self.restore_adventure=crate::rankings::restored_id(&r["inventory"]);
                        self.start(true);
                    } else {
                        self.save_candidate(&r["request"], false);
                        return false;
                    }
                } else {
                    self.save_candidate(&r["request"], false);
                    if !flag(&r["cancelled"]) {
                        self.log(r["error"].clone());
                        self.notice("error.load", json!({}), true);
                    }
                }
            }
            "init" | "load" => {
                if ok {
                    let length = if r["bytes"].is_null() && number(&r["length"]) == 0 {
                        0
                    } else if let Some(length) = self.validate_save(&r["bytes"]) {
                        length
                    } else {
                        self.save_candidate(&r["request"], false);
                        return false;
                    };
                    self.saved(&r["request"], length);
                    self.model["saved"] = json!(length > 0);
                    if operation == "load" {
                        if flag(&self.model["saved"]) {
                            self.inventory_lifetime.stage_restore(&r["inventory"]);
                            self.restore_adventure=crate::rankings::restored_id(&r["inventory"]);
                            self.start(true);
                        } else {
                            self.model["starting"] = json!(false);
                            self.notice("error.no_save", json!({}), true);
                        }
                    }
                } else {
                    self.save_candidate(&r["request"], false);
                    self.log(r["error"].clone());
                    self.model["starting"] = json!(false);
                    self.notice(
                        if text(&r["error"]).contains("Save database blocked") {
                            "error.storage_blocked"
                        } else if operation == "load" {
                            "error.load"
                        } else {
                            "error.storage_init"
                        },
                        json!({}),
                        true,
                    );
                }
            }
            "save-write" => {
                self.model["savePending"] = json!(false);
                if ok {
                    self.inventory_lifetime.committed(&r["inventory"]);
                    self.saved(&r["request"], number(&r["length"]) as usize);
                    self.model["saved"] = json!(true);
                    self.notice("notice.saved", json!({}), false);
                    if self.return_after_save {
                        self.return_after_save = false;
                        self.return_top();
                    } else if self.autosave_due {
                        self.request_save(false);
                    }
                } else {
                    self.save_candidate(&r["request"], false);
                    self.log(r["error"].clone());
                    self.notice(if text(&r["error"]).contains("Save database blocked") { "error.storage_blocked" } else { "error.save" }, json!({}), true);
                    self.cancel_save();
                }
            }
            "save-delete" => {
                if ok {self.inventory_lifetime.deleted();}
                if !ok {
                    self.log(r["error"].clone());
                    self.notice(if text(&r["error"]).contains("Save database blocked") { "error.storage_blocked" } else { "error.save" }, json!({}), true);
                }
            }
            "assets" => {
                let set = text(&r["set"]);
                if !matches!(set, "tiles" | "pixels") { return false; }
                let plan = tiles::assets(set);
                let expected = plan["expectedDimensions"].as_array().unwrap();
                let valid = r["images"].as_array().is_some_and(|images| {
                    images.len() == expected.len()
                        && images.iter().zip(expected).all(|(image, expected)| {
                            image["width"] == expected["width"]
                                && image["height"] == expected["height"]
                        })
                });
                if ok && valid {
                    self.assets_ready.insert(set.to_string());
                    self.model["ready"] = json!(self.assets_ready.contains("tiles") && self.assets_ready.contains("pixels"));
                    if flag(&self.model["ready"]) { self.assets_error = false; }
                } else {
                    self.state["runtimeError"] =
                        json!("Invalid tile dimensions or unavailable assets");
                    if !self.assets_error {
                        self.notice("error.tiles", json!({}), true);
                        self.assets_error = true;
                    }
                }
            }
            "fullscreen" => {
                if ok {
                    if !flag(&self.model["settingsOpen"]) && self.model["frame"].is_object() {
                        self.focus("canvas");
                    }
                } else {
                    self.log(r["error"].clone());
                    self.notice("error.fullscreen", json!({}), true);
                }
            }
            "random" => {
                let n = number(&r["value"]) as u32;
                if r["id"] == "random-seed" {
                    let value = if seed(text(&self.inputs["seed"]["value"])) == Some(n) {
                        n.wrapping_add(1)
                    } else {
                        n
                    };
                    self.field("seed", json!({"value":value.to_string()}));
                } else {
                    let n = n % 1_000_000;
                    let name = self.label("random.name", &json!({"number":n}));
                    let name = if name == text(&self.inputs["name"]["value"]) {
                        self.label("random.name", &json!({"number":(n+1)%1_000_000}))
                    } else {
                        name
                    };
                    self.field("name", json!({"value":name}));
                }
                self.model["topNotice"] = Value::Null;
                let field = if r["id"] == "random-seed" { "seed" } else { "name" };
                self.model["fieldErrors"][field] = Value::Null;
            }
            _ => {}
        }
        ok
    }
    fn observe(&mut self, r: &Value) {
        if r["inputs"].is_object() {
            self.inputs = r["inputs"].clone();
        }
        if let Some(values) = r["environment"].as_object() {
            for (k, v) in values {
                self.environment[k] = v.clone();
            }
        }
    }
    fn sync_model(&mut self) -> &'static Value {
        let entries = self.history.entries.clone();
        self.model["entries"] = json!(
            entries
                .iter()
                .map(|e| json!({
                    "source":e["source"],
                    "id":if e["message"].is_object() { &e["message"]["id"] } else { &e["id"] },
                    "error":e["error"],
                    "mobile_keyboard_hint":crate::log_visibility::keyboard_hint(&e["message"]),
                    "transient_prompt":crate::log_visibility::interaction_prompt(&e["message"]),
                    "message":e["message"],
                    "text":self.entry_text(e),
                }))
                .collect::<Vec<_>>()
        );
        self.model["loading"] = json!(flag(&self.model["starting"]) || self.restore_pending);
        // The dedicated C gate is interruptible with the same controls as a
        // command wait. Only this UI projection is normalized; queue policy
        // retains the actual gate and sends STOP before a manual command.
        self.model["input"] = if self.input["kind"] == "run-boundary" {
            json!({"kind":"command"})
        } else { self.input.clone() };
        self.model["inputRequests"] = self.state["inputRequestCount"].clone();
        let m = tiles::manifest_ref(text(&self.model["displayMode"]));
        let locale = text(&self.model["language"]);
        self.model["tileDescriptions"] = json!(
            m["entries"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|e| e["labels"][locale]
                    .as_str()
                    .or(e["meaning"].as_str())
                    .unwrap_or(""))
                .collect::<Vec<_>>()
        );
        m
    }
    pub(crate) fn snapshot(&mut self) -> Value {
        let m = self.sync_model();
        let entries = self.history.entries.clone();
        let notice = entries
            .iter()
            .rfind(|e| e["source"] == "system")
            .map(|e| self.entry_text(e))
            .unwrap_or_default();
        let message = entries
            .iter()
            .rfind(|e| e["source"] == "game" && !crate::log_visibility::interaction_prompt(&e["message"]))
            .map(|e| self.entry_text(e))
            .unwrap_or_default();
        let mut result = self.model.clone();
        for (k, v) in self.state.as_object().expect("State object") {
            result[k] = v.clone();
        }
        result["autowalk"] = self.autowalk.snapshot();
        result["input"] = self.input.clone();
        result["notice"] = json!(notice);
        result["message"] = json!(message);
        result["uiMissing"] = json!(self.catalog.missing);
        result["presentation"] = self.model["frame"]["ui"].clone();
        result["inputRequests"] = self.state["inputRequestCount"].clone();
        result["graphics"] = json!({"mode":self.model["displayMode"],"set":m["browser_mode"],"assetStyle":m["style"],"tileSize":self.model["tileSize"],"ids":m["entries"].as_array().into_iter().flatten().map(|e|e["id"].clone()).collect::<Vec<_>>(),"unknown":self.model["frame"]["map_unknown_glyphs"].as_array().cloned().unwrap_or_default()});
        result
    }
    pub fn request(&mut self, r: Value) -> Value {
        self.effects.clear();
        self.observe(&r);
        let mut consumed = false;
        let mut accepted = false;
        let mut redraw = true;
        let mut raw = Value::Null;
        let mut commands = Value::Null;
        let mut surface = Value::Null;
        match text(&r["type"]) {
            "boot" => {
                self.environment = r["environment"].clone();
                self.ui.load_control_preferences(text(&r["controlsPreference"]));
                self.control_preference_cache = self.ui.control_preferences().to_string();
                let (lifetime,active)=crate::inventory_lifetime::InventoryLifetime::load(text(&r["inventoryPreference"]));
                self.inventory_lifetime=lifetime;
                if let Some(active)=active {self.ui.reset_inventory_view();self.ui.load_inventory_preference(&active.to_string());}
                self.inventory_preference_cache=self.inventory_lifetime.storage(self.ui.inventory_preference()).to_string();
                let p = preference(text(&r["preference"]));
                self.model["language"] = json!(if self.environment["parameters"]["lang"] == "en" {
                    "en"
                } else {
                    "ja"
                });
                let view = text(&self.environment["parameters"]["view"]);
                let mode = if mode(view) { view } else { text(&p["mode"]) };
                self.model["displayMode"] = json!(mode);
                self.model["tileSize"] = p["zoom"].clone();
                self.model["animationEnabled"] = p["animation"].clone();
                self.model["handedness"] = p["handedness"].clone();
                self.model["theme"] = p["theme"].clone();
                self.animations.set_enabled(flag(&p["animation"]));
                self.document();
                self.field("name", json!({"value":"Player"}));
                self.field("seed", json!({"value":"12345"}));
                self.field("command-key", json!({"maxLength":1}));
                self.retire_saves();
                self.read_save(SaveOperation::Init);
                self.effects.push(tiles::assets("tiles"));
                self.effects.push(tiles::assets("pixels"));
                self.effects.push(json!({"kind":"timer","interval":500}));
            }
            "worker" => self.worker(
                r["data"].clone(),
                &r["generation"],
                r["now"].as_f64().unwrap_or(0.),
            ),
            "api" => accepted = self.api(&r, &mut redraw),
            "event" => {
                let mut e = r["event"].clone();
                if matches!(text(&e["type"]), "key" | "invoke" | "select" | "submit"
                    | "enqueue" | "blur" | "pagehide" | "surface-change" | "compositionstart")
                    || e["type"] == "visibilitychange" && flag(&e["hidden"]) {
                    self.stop_autowalk("input");
                }
                match text(&e["type"]) {
                    "autowalk-tick" => {
                        if e["generation"] != self.model["generation"] || !self.autowalk.accepts_tick(number(&e["token"])) {
                            // Retired timers cannot cancel a new route, even while
                            // it is waiting for outstanding manual input to finish.
                        } else if self.autowalk_available() && !self.waiting_for_request {
                            if let Some(key) = self.autowalk.tick(&self.model["frame"],&self.input,number(&self.state["inputRequestCount"]),number(&e["token"])) {
                                self.queue(json!([key]), "autowalk");
                            }
                        } else { self.stop_autowalk("context"); }
                    }
                    "touchstart" | "contextmenu" => consumed = true,
                    "visibilitychange" if flag(&e["hidden"]) => {
                        self.ui.event(json!({"type":"cancel"}));
                    }
                    "surface-change" | "blur" => {
                        let result=self.ui.event(json!({"type":"cancel","clearFocus":e["reason"]=="fullscreen" || e["type"]=="blur"}));
                        self.effects
                            .extend(result["effects"].as_array().into_iter().flatten().cloned());
                        if e["reason"] == "fullscreen" {
                            self.ui.event(json!({"type":"center"}));
                        }
                    }
                    "compositionstart" => self.composing = true,
                    "compositionend" => self.composing = false,
                    "native-input" => {
                        let id = text(&e["id"]);
                        self.model["fieldErrors"][id] = Value::Null;
                        if e["id"] == "prompt-text" {
                            self.draft_dirty = true;
                        }
                    }
                    "pagehide" => {
                        let result = self.ui.event(json!({"type":"cancel"}));
                        self.effects
                            .extend(result["effects"].as_array().into_iter().flatten().cloned());
                        self.effects.push(json!({"kind":"queue-close"}));
                    }
                    "enqueue" => self.queue(e["events"].clone(), "enqueue"),
                    "invoke" => self.invoke(text(&e["id"])),
                    "select" => self.select(text(&e["id"]), text(&e["value"])),
                    "submit" => self.submit(text(&e["id"])),
                    _ => {
                        if e["type"] == "key" {
                            e["composing"] = json!(
                                self.composing || flag(&e["composing"]) || e["keyCode"] == 229
                            );
                        }
                        if !matches!(
                            text(&e["native"]),
                            "name" | "seed" | "prompt-text" | "command-key" | "repeat-count"
                        ) {
                            e["native"] = json!("");
                        }
                        if matches!(text(&e["type"]), "down" | "move" | "up") {
                            e["captured"] = json!(if e["type"] == "down" {
                                e["captures"].as_array().is_some_and(|ids| !ids.is_empty())
                            } else {
                                flag(&e["hasCapture"])
                            });
                        }
                        self.sync_model();
                        self.ui.set_context(self.model.clone());
                        let pointer_down=e["type"]=="down";
                        let response = self.ui.event(e);
                        if pointer_down && !response["effects"].as_array().into_iter().flatten().any(|effect|effect["kind"]=="map-contact"
                            && self.autowalk.same_target(&self.model["frame"],effect,number(&effect["movement"]) as u32)) {self.stop_autowalk("input");}
                        consumed = flag(&response["consumed"]);
                        raw = response["raw"].clone();
                        for effect in response["effects"].as_array().into_iter().flatten() {
                            match text(&effect["kind"]) {
                                "invoke" => self.invoke(text(&effect["id"])),
                                "select" => {
                                    self.select(text(&effect["id"]), text(&effect["value"]))
                                }
                                "zoom" => {
                                    if valid_zoom(&effect["size"]) {
                                        self.model["tileSize"] = effect["size"].clone();
                                        self.persist_view();
                                    }
                                }
                                "submit" => self.submit(text(&effect["id"])),
                                "map-contact"=>{},
                                "map-cancel"=>self.stop_autowalk("input"),
                                "map-target" => {
                                    if self.autowalk_available() {
                                        self.autowalk.start(&self.model["frame"], effect,number(&effect["movement"]) as u32);
                                        self.schedule_autowalk();
                                    }
                                }
                                "send" => {
                                    self.stop_autowalk("input");
                                    if effect["redraw"] == false {
                                        redraw = false;
                                    }
                                    let keys = if effect["keys"].is_array() {
                                        effect["keys"].clone()
                                    } else {
                                        json!([effect["key"]])
                                    };
                                    if self.ending()
                                        && self.input["id"] == "input.finish_game"
                                        && (keys == json!([13]) || keys == json!([27]))
                                    {
                                        self.invoke("result-top");
                                    } else {
                                        self.queue(keys, "send");
                                    }
                                }
                                _ => self.effects.push(effect.clone()),
                            }
                        }
                        if flag(&response["feedbackChanged"]) {redraw=true;}
                    }
                }
            }
            "render" => {
                self.sync_model();
                let mut view = r["view"].clone();
                view["inputs"] = self.inputs.clone();
                let ratio = view["ratio"].as_f64().unwrap_or(1.).clamp(1., 2.);
                view["ratio"] = json!(ratio);
                view["blink"] = json!((number(&view["now"]) / 500).is_multiple_of(2));
                self.ui.set_context(self.model.clone());
                self.animations.set_player_paused(self.ui.wait_held());
                let animation = self.animations.sample(view["now"].as_f64().unwrap_or(0.), text(&self.model["displayMode"]));
                self.state["animation"] = animation.frames.clone();
                self.state["projectiles"] = animation.projectiles.clone();
                if self.model["frame"].is_object() {
                    self.model["frame"]["map_animation"] = animation.frames;
                    self.model["frame"]["map_projectile_animation"] = animation.projectiles;
                }
                let visible = view["visible"].as_bool() != Some(false);
                let mut result = self.ui.render(self.model.clone(), view);
                commands = result["commands"].take();
                let animated_map = commands.as_array().into_iter().flatten().any(|command| {
                    (command["op"] == "image" && text(&command["image"]).starts_with("animations-v1/")) || flag(&command["projectile"])
                });
                let actor_delay=if visible && animated_map && flag(&self.model["running"]) && !flag(&self.model["topOpen"]) {animation.next_delay_ms.map(f64::from)}else{None};
                let ui_delay=visible.then(||result["nextUiDelayMs"].as_f64()).flatten().filter(|v|v.is_finite()&&*v>=0.);
                let delay=match (actor_delay,ui_delay) {(Some(a),Some(b))=>Some(a.min(b)),(a,b)=>a.or(b)};
                self.effects.push(json!({"kind":"animation-wake","delay":delay}));
                if flag(&result["animate"]) {
                    self.effects.push(json!({"kind":"animation-frame"}));
                }
                let diagnostics = &result["diagnostics"];
                surface = json!({"width":diagnostics["width"],"height":diagnostics["height"],"ratio":ratio});
                let active = diagnostics["pointer"]["capturedIds"].as_array();
                for id in r["captured"].as_array().into_iter().flatten() {
                    if !active.is_some_and(|ids| ids.contains(id)) {
                        self.effects.push(json!({"kind":"release","id":id}));
                    }
                }
                for id in ["name", "seed", "prompt-text", "command-key", "repeat-count"] {
                    let control = diagnostics["controls"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|c| c["field"] == id);
                    if let Some(control) = control {
                        if flag(&self.inputs[id]["active"]) {
                            self.effects.push(json!({"kind":"native-position","id":id,"rect":control["fullRect"]}));
                        }
                    } else {
                        if flag(&self.inputs[id]["active"]) {
                            self.effects.push(json!({"kind":"native-blur","id":id}));
                            self.focus("canvas");
                        }
                        self.effects.push(json!({"kind":"native-position","id":id,"rect":Rect::new(-1000.,0.,0.,0.)}));
                    }
                }
            }
            "tile-plan" => {
                let m = tiles::manifest_ref(text(&r["mode"]));
                if let Err(error) = tiles::validate(&r["frame"], m) {
                    return json!({"error":error});
                }
                return json!({"commands":tiles::plan(&r["frame"],&r["camera"],Rect::new(0.,0.,0.,0.),r["camera"]["ratio"].as_f64().unwrap_or(1.),text(&r["mode"]))});
            }
            "asset-plan" => {
                return tiles::assets(
                    if text(&r["url"]).contains("pixels-v2") || r["mode"] == "pixels" {
                        "pixels"
                    } else {
                        "tiles"
                    },
                );
            }
            _ => {}
        }
        if r["type"] != "render" {
            self.sync_model();
            self.ui.set_context(self.model.clone());
            if self.animations.set_player_paused(self.ui.wait_held()) { redraw = true; }
            self.controls();
        }
        let inspect = r["inspect"].as_bool().unwrap_or(true);
        let state = if inspect { self.snapshot() } else { Value::Null };
        let control_preference = self.ui.control_preferences().to_string();
        if control_preference != self.control_preference_cache {
            self.control_preference_cache.clone_from(&control_preference);
            self.effects.push(json!({"kind":"storage-write","key":"rogue-controls-v1","value":control_preference}));
        }
        let active_inventory=self.ui.inventory_preference();
        self.inventory_lifetime.observe(&active_inventory);
        let inventory_preference=self.inventory_lifetime.storage(active_inventory).to_string();
        if inventory_preference != self.inventory_preference_cache {
            self.inventory_preference_cache.clone_from(&inventory_preference);
            self.effects.push(json!({"kind":"storage-write","key":"rogue-inventory-view-v1","value":inventory_preference}));
        }
        let mut response = json!({"consumed":consumed,"stopPropagation":consumed && r["event"]["type"]=="key","accepted":accepted,"redraw":redraw,"raw":raw});
        response["diagnostics"] = if inspect { self.ui.diagnostics() } else { Value::Null };
        response["commands"] = commands;
        response["surface"] = surface;
        response["effects"] = Value::Array(std::mem::take(&mut self.effects));
        response["state"] = state;
        response
    }
}
fn push(values: &mut Value, value: Value, limit: usize) {
    let entries = values.as_array_mut().expect("History array");
    entries.push(value);
    if entries.len() > limit {
        entries.remove(0);
    }
}

#[cfg(test)]
mod target_run_tests {
    use super::*;
    fn measure(text: &str, size: f64, _bold: bool, _mono: bool) -> rogue_display::widgets::TextSize {
        rogue_display::widgets::TextSize { width:text.len() as f64 * size, ascent:0., descent:size }
    }
    fn gate() -> Controller {
        let mut c = Controller::new(measure);
        c.model["running"] = json!(true);
        c.input = json!({"kind":"run-boundary","direction":108});
        c.state["inputRequestCount"] = json!(7);
        c
    }
    #[test]
    fn manual_input_releases_gate_once_and_preserves_the_command() {
        let mut c = gate();
        c.stop_autowalk("input");
        c.queue(json!([115]), "send");
        c.stop_autowalk("input");
        let queues: Vec<_> = c.effects.iter().filter(|e| e["kind"] == "queue").collect();
        assert_eq!(queues.len(),2);
        assert_eq!(queues[0]["events"],json!([rogue_contract::RG_KEY_TARGET_RUN_STOP]));
        assert_eq!(queues[1]["events"],json!([115]));
        // Input arriving after an already sent permission still carries STOP
        // before the raw command, so it cannot vanish into the next gate.
        let mut c = gate();
        c.queue(json!([rogue_contract::RG_KEY_TARGET_RUN_CONTINUE]), "autowalk");
        c.stop_autowalk("input");
        c.queue(json!([115]), "send");
        assert_eq!(c.effects.last().unwrap()["events"],json!([rogue_contract::RG_KEY_TARGET_RUN_STOP,115]));
    }
    #[test]
    fn straight_permit_crosses_the_gate_unchanged_but_manual_input_still_stops() {
        let permit=rogue_contract::target_run_permit_key(b'l',3).unwrap();
        let mut c=gate();
        c.queue(json!([permit]),"autowalk");
        assert_eq!(c.effects.last().unwrap()["events"],json!([permit]));
        assert_eq!(c.run_stop_request,None);
        c.stop_autowalk("input");
        c.queue(json!([115]),"send");
        assert_eq!(c.effects.last().unwrap()["events"],json!([rogue_contract::RG_KEY_TARGET_RUN_STOP,115]));
    }
    #[test]
    fn restored_gate_without_route_is_released_without_moving() {
        let mut c = gate();
        c.schedule_autowalk();
        c.schedule_autowalk();
        assert_eq!(c.effects.len(),1);
        assert_eq!(c.effects[0]["events"],json!([rogue_contract::RG_KEY_TARGET_RUN_STOP]));
        assert_eq!(c.input["kind"],"run-boundary");
        c.sync_model();
        assert_eq!(c.model["input"]["kind"],"command");
        assert_eq!(c.input["kind"],"run-boundary");
    }
}

#[cfg(test)]
mod inventory_lifetime_tests {
    use super::*;
    fn measure(text:&str,size:f64,_bold:bool,_mono:bool)->rogue_display::widgets::TextSize {rogue_display::widgets::TextSize{width:text.len() as f64*size,ascent:0.,descent:size}}
    fn view(tab:&str)->Value {json!({"version":1,"tab":tab,"positions":{"food":120.},"horizontal":70.})}
    fn slot(token:&str,view:Value)->Value {json!({"version":1,"token":token,"view":view})}
    fn boot(raw:Value)->Controller {let mut c=Controller::new(measure);c.request(json!({"type":"boot","inventoryPreference":raw.to_string(),"environment":{"isolated":true,"parameters":{}}}));c}
    fn stored(c:&mut Controller)->Value {c.request(json!({"type":"event","event":{"type":"inventory-audit"}}));serde_json::from_str(&c.inventory_preference_cache).unwrap()}
    fn complete(c:&mut Controller,operation:SaveOperation,ok:bool,inventory:Value)->Value {
        let generation=number(&c.model["generation"]);let pending=c.saves.begin(operation,generation);
        let bytes=rogue_platform::Envelope::new(17,"Inventory".into(),&[1],vec![],0).unwrap().bytes().unwrap();
        c.request(json!({"type":"api","operation":operation.name(),"ok":ok,"generation":generation,"request":pending.request,"bytes":bytes,"length":bytes.len(),"inventory":inventory,"error":"aborted"}))
    }
    fn restored(c:&mut Controller) {let generation=number(&c.model["generation"]);c.request(json!({"type":"worker","generation":generation,"data":{"type":"input-request"}}));}
    #[test]
    fn inventory_lifetime_new_adventure_resets_only_after_validation() {
        for invalid in ["seed","name","isolation","composition"] {
            let mut c=boot(view("food"));let before=c.ui.inventory_preference();
            match invalid {"seed"=>c.inputs["seed"]["value"]=json!("-1"),"name"=>c.inputs["name"]["value"]=json!("bad\nname"),"isolation"=>c.environment["isolated"]=json!(false),_=>c.composing=true}
            c.start(false);assert_eq!(c.ui.inventory_preference(),before,"{invalid}");assert_eq!(c.model["generation"],0);
        }
        let mut c=boot(view("food"));c.ui.load_control_preferences(r#"{"version":1,"bindings":{"game.search":[{"key":"F8"}]}}"#);let controls=c.ui.control_preferences();c.model["tileSize"]=json!(48);c.start(false);
        assert_eq!(c.ui.inventory_preference(),json!({"version":1,"tab":"all","positions":{},"horizontal":0.}));assert_eq!(c.ui.control_preferences(),controls);assert_eq!(c.model["tileSize"],48);
        assert_eq!(stored(&mut c)["active"]["tab"],"all");
    }
    #[test]
    fn inventory_lifetime_restore_applies_slot_view_only_after_c_success() {
        for success in [false,true] {
            let mut c=boot(view("potion"));complete(&mut c,SaveOperation::Load,true,slot("A",view("food")));
            assert_eq!(c.ui.inventory_preference()["tab"],"potion","Reading valid bytes is not a successful C restore");
            if success {restored(&mut c);assert_eq!(c.ui.inventory_preference()["tab"],"food");}
            else {let generation=number(&c.model["generation"]);c.request(json!({"type":"worker","generation":generation,"data":{"type":"error","text":"restore failed"}}));assert_eq!(c.ui.inventory_preference()["tab"],"potion");}
        }
        let mut c=boot(view("potion"));complete(&mut c,SaveOperation::Load,false,slot("A",view("food")));assert_eq!(c.ui.inventory_preference()["tab"],"potion");
    }
    #[test]
    fn inventory_lifetime_save_slot_tracks_its_owner_and_keeps_latest_view() {
        let mut c=boot(json!({"version":2,"active":view("food"),"saved":slot("A",view("food")),"legacy":null}));c.start(false);
        complete(&mut c,SaveOperation::Write,false,slot("B",view("all")));assert_eq!(stored(&mut c)["saved"]["token"],"A");
        let generation=number(&c.model["generation"]);let stale=c.saves.begin(SaveOperation::Write,generation);c.return_top();c.start(false);
        c.request(json!({"type":"api","operation":"save-write","ok":true,"generation":generation,"request":stale.request,"length":100,"inventory":slot("stale",view("potion"))}));assert_eq!(stored(&mut c)["saved"]["token"],"A");
        complete(&mut c,SaveOperation::Write,true,slot("B",view("all")));c.ui.load_inventory_preference(&view("food").to_string());let same=stored(&mut c);assert_eq!(same["saved"]["token"],"B");assert_eq!(same["saved"]["view"]["tab"],"food");
        c.return_top();c.start(false);let new=stored(&mut c);assert_eq!(new["active"]["tab"],"all");assert_eq!(new["saved"]["view"]["tab"],"food");
        let mut reload=boot(new);complete(&mut reload,SaveOperation::Load,true,slot("B",view("all")));restored(&mut reload);assert_eq!(reload.ui.inventory_preference()["tab"],"food","Latest view wins over the earlier save-time snapshot");
        complete(&mut reload,SaveOperation::Delete,false,Value::Null);assert_eq!(stored(&mut reload)["saved"]["token"],"B");
        complete(&mut reload,SaveOperation::Delete,true,Value::Null);assert!(stored(&mut reload)["saved"].is_null());assert_eq!(reload.ui.inventory_preference()["tab"],"food");
    }
    #[test]
    fn inventory_lifetime_legacy_save_view_survives_a_new_unsaved_adventure() {
        let mut c=boot(view("food"));c.start(false);let saved=stored(&mut c);assert_eq!(saved["active"]["tab"],"all");assert_eq!(saved["legacy"]["tab"],"food");
        let mut reload=boot(saved);complete(&mut reload,SaveOperation::Load,true,Value::Null);restored(&mut reload);assert_eq!(reload.ui.inventory_preference()["tab"],"food");
        let mut c=boot(json!({"version":2,"active":view("potion"),"saved":slot("old",view("food")),"legacy":null}));complete(&mut c,SaveOperation::Load,true,slot("other",view("scroll")));restored(&mut c);assert_eq!(c.ui.inventory_preference()["tab"],"scroll","A mismatched local token cannot supply another slot's view");
        for missing in [Value::Null,json!({"version":1,"token":"","view":view("food")})] {
            let mut c=boot(json!({"version":2,"active":view("potion"),"saved":slot("old",view("food")),"legacy":null}));complete(&mut c,SaveOperation::Load,true,missing);restored(&mut c);
            assert_eq!(c.ui.inventory_preference(),json!({"version":1,"tab":"all","positions":{},"horizontal":0.}),"Missing slot UI cannot adopt another adventure's active view");
        }
    }
}

#[cfg(test)]
mod adventure_boundary_tests {
    use super::*;
    fn measure(text:&str,size:f64,_bold:bool,_mono:bool)->rogue_display::widgets::TextSize {rogue_display::widgets::TextSize{width:text.len() as f64*size,ascent:0.,descent:size}}
    fn prepared()->Controller {
        let mut c=Controller::new(measure);c.environment=json!({"isolated":true});
        c.inputs=json!({"name":{"value":"Keep name"},"seed":{"value":"17"},"command-key":{"value":"Z"}});
        c.model["running"]=json!(true);c.model["topOpen"]=json!(false);c.model["input"]=json!({"kind":"command"});
        c.model["frame"]=json!({"width":80,"height":24,"player":{"x":10,"y":10},"ui":{"mode":"game","input":{"kind":"command"}}});
        c.ui.render(c.model.clone(),json!({"width":1240,"height":800,"inputs":c.inputs}));
        c.ui.event(json!({"type":"key","key":"g"}));c
    }
    fn movement(c:&mut Controller)->Value {
        let mut model=c.model.clone();model["running"]=json!(true);model["topOpen"]=json!(false);model["starting"]=json!(false);
        model["frame"]=json!({"width":80,"height":24,"player":{"x":10,"y":10},"ui":{"mode":"game","input":{"kind":"command"}}});
        c.ui.render(model,json!({"width":1240,"height":800,"inputs":c.inputs}));
        c.ui.event(json!({"type":"key","key":"l"}))["effects"].clone()
    }
    #[test]
    fn adventure_boundary_new_resets_mode_restore_preserves_it_and_both_clear_native_draft() {
        for restore in [false,true] {
            let mut c=prepared();assert_eq!(movement(&mut c)[0]["key"],76);
            c.start(restore);
            assert_eq!(movement(&mut c)[0]["key"],if restore {76}else{108});
            assert_eq!(c.inputs["command-key"]["value"],"");
            assert!(c.effects.iter().any(|e|e["kind"]=="field"&&e["id"]=="command-key"&&e["properties"]["value"]==""),"The actual native input is cleared too");
            assert_eq!(c.inputs["name"]["value"],"Keep name");assert_eq!(c.inputs["seed"]["value"],"17");
        }
    }
    #[test]
    fn adventure_boundary_invalid_start_and_same_adventure_keep_unsent_draft_and_mode() {
        for invalid in ["seed","name","isolation","composition"] {
            let mut c=prepared();match invalid {"seed"=>c.inputs["seed"]["value"]=json!("-1"),"name"=>c.inputs["name"]["value"]=json!("bad\nname"),"isolation"=>c.environment["isolated"]=json!(false),_=>c.composing=true}
            c.start(false);assert_eq!(c.inputs["command-key"]["value"],"Z","{invalid}");assert_eq!(movement(&mut c)[0]["key"],76,"{invalid}");
        }
        let mut c=prepared();c.request(json!({"type":"event","event":{"type":"hover","x":0,"y":0}}));assert_eq!(c.inputs["command-key"]["value"],"Z");
    }
}

#[cfg(test)]
mod rankings_boundary_tests {
 use super::*;
 fn measure(text:&str,size:f64,_:bool,_:bool)->rogue_display::widgets::TextSize {rogue_display::widgets::TextSize{width:text.len() as f64*size,ascent:0.,descent:size}}
 #[test] fn rankings_final_result_records_a_zero_point_adventure_only_once() {
    let mut c=Controller::new(measure);c.request(json!({"type":"boot","environment":{"isolated":true,"instanceId":"test-instance","parameters":{}}}));c.start(false);
    let generation=c.model["generation"].clone();let result=json!({"type":"score-result","score":0,"flags":1,"level":1,"monster":0,"name":"Player","eligible":true});
    let out=c.request(json!({"type":"worker","generation":generation,"data":result}));assert!(out["effects"].as_array().unwrap().iter().any(|e|e["kind"]=="rankings-write"),"A finalized zero-point adventure is recorded");
    let duplicate=c.request(json!({"type":"worker","generation":generation,"data":result}));assert!(!duplicate["effects"].as_array().unwrap().iter().any(|e|e["kind"]=="rankings-write"));
 }
}

#[cfg(test)]
mod rankings_lifecycle_tests {
 use super::*;
 fn measure(text:&str,size:f64,_:bool,_:bool)->rogue_display::widgets::TextSize {rogue_display::widgets::TextSize{width:text.len() as f64*size,ascent:0.,descent:size}}
 fn fresh()->Controller {let mut c=Controller::new(measure);c.request(json!({"type":"boot","environment":{"isolated":true,"instanceId":"test-runtime","parameters":{}}}));c.start(false);c}
 fn score(c:&mut Controller)->Value {let generation=c.model["generation"].clone();c.request(json!({"type":"worker","generation":generation,"data":{"type":"score-result","score":0,"flags":1,"name":"Player","level":1,"monster":0,"eligible":true}}))}
 fn io(c:&mut Controller,operation:&str,request:u64,ok:bool,book:Value)->Value {c.request(json!({"type":"api","operation":operation,"request":request,"ok":ok,"rankings":book}))}
 #[test] fn rankings_failed_write_retries_same_result_and_global_callbacks_do_not_change_the_new_adventure() {
    let mut c=fresh();let active=c.adventure_id.clone();score(&mut c);let first=c.ranking_io.as_ref().unwrap().0;
    io(&mut c,"rankings-write",first,false,Value::Null);assert_eq!(c.ranking_pending.len(),1);assert_eq!(c.model["rankingErrorId"],"error.rankings_save");
    c.start(false);let next=c.adventure_id.clone();assert_ne!(active,next);assert_eq!(c.ranking_pending[0].adventure,active);
    io(&mut c,"rankings-write",first,true,crate::rankings::Book::default().value());assert_eq!(c.ranking_pending.len(),1,"A retired response cannot lose the candidate");
    c.request(json!({"type":"event","event":{"type":"invoke","id":"rankings-read"}}));let retry=c.ranking_io.as_ref().unwrap().0;assert_ne!(first,retry);
    let committed=c.ranking_book.merge(c.ranking_pending[0].clone()).unwrap();io(&mut c,"rankings-write",retry,true,committed.value());
    assert!(c.ranking_pending.is_empty());assert_eq!(c.ranking_book.entries[0].adventure,active);assert_eq!(c.adventure_id,next);assert_eq!(c.model["rankingErrorId"],Value::Null);
    score(&mut c);let current=c.ranking_io.as_ref().unwrap().0;io(&mut c,"rankings-write",retry,true,crate::rankings::Book::default().value());assert_eq!(c.ranking_io.as_ref().unwrap().0,current);assert_eq!(c.ranking_pending[0].adventure,next);
 }
 #[test] fn rankings_read_failure_preserves_history_and_uses_read_error_and_save_does_not_score() {
    let mut c=fresh();c.ranking_begin();let request=c.ranking_io.as_ref().unwrap().0;io(&mut c,"rankings-read",request,false,Value::Null);
    assert_eq!(c.model["rankingErrorId"],"error.rankings_load");assert!(c.ranking_pending.is_empty());
    let generation=c.model["generation"].clone();let saved=c.request(json!({"type":"worker","generation":generation,"data":{"type":"save","bytes":[1]}}));
    let effect=saved["effects"].as_array().unwrap().iter().find(|e|e["kind"]=="save-write").unwrap();assert_eq!(effect["inventory"]["adventure"],c.adventure_id);assert!(c.ranking_pending.is_empty());
    c.request(json!({"type":"worker","generation":generation,"data":{"type":"outcome","code":-1,"text":"input ended"}}));assert!(c.ranking_pending.is_empty());
 }
 #[test] fn rankings_restore_identity_waits_for_c_success_for_slot_and_import() {
    for operation in [SaveOperation::Load,SaveOperation::Import] {for success in [false,true] {
        let mut c=fresh();let previous=c.adventure_id.clone();let generation=number(&c.model["generation"]);let pending=c.saves.begin(operation,generation);
        let bytes=rogue_platform::Envelope::new(17,"Player".into(),&[1],vec![],0).unwrap().bytes().unwrap();
        c.request(json!({"type":"api","operation":operation.name(),"request":pending.request,"generation":generation,"ok":true,"bytes":bytes,"length":bytes.len(),"inventory":{"version":1,"token":"slot-A","adventure":"saved-A","view":{"version":1,"tab":"all","positions":{},"horizontal":0}}}));
        assert_eq!(c.adventure_id,previous);score(&mut c);assert!(c.ranking_pending.is_empty(),"Replay is not a new ending");
        let generation=c.model["generation"].clone();if success {c.request(json!({"type":"worker","generation":generation,"data":{"type":"input-request"}}));assert_eq!(c.adventure_id,"saved-A");}else{c.request(json!({"type":"worker","generation":generation,"data":{"type":"error","text":"restore failed"}}));assert_eq!(c.adventure_id,previous);assert!(c.restore_adventure.is_none());}
    }}
 }
}
