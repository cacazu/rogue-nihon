//! Owns browser session state. JS reports observations and executes API effects.
use crate::policies::*;
use rogue_contract::RG_KEY_SAVE;
use rogue_display::{
    browser_ui::{BrowserUi, tiles},
    widgets::{MeasureText, Rect},
};
use serde_json::{Value, json};

pub struct Controller {
    ui: BrowserUi,
    model: Value,
    state: Value,
    inputs: Value,
    environment: Value,
    history: History,
    catalog: Catalog,
    effects: Vec<Value>,
    input: Value,
    composing: bool,
    text_mode: bool,
    draft_dirty: bool,
    window_open: bool,
    restore_pending: bool,
    ending_ack: i64,
    assets_ready: usize,
}
impl Controller {
    pub fn new(measure: MeasureText) -> Self {
        Self {
            ui: BrowserUi::new(measure),
            model: json!({"language":"ja","topOpen":true,"settingsOpen":false,"starting":false,"running":false,"ready":false,"saved":false,"savePending":false,"returnAfterEnd":false,"generation":0,"displayMode":"tiles","tileSize":32,"frame":null,"topNotice":null}),
            state: json!({"exitCode":null,"outcome":null,"runtimeError":null,"frameCount":0,"inputRequestCount":0,"trace":null,"traces":[],"messages":[],"logs":[],"translationFallbacks":[],"savedLength":0}),
            inputs: json!({}),
            environment: Value::Null,
            history: History::default(),
            catalog: Catalog::default(),
            effects: Vec::new(),
            input: Value::Null,
            composing: false,
            text_mode: false,
            draft_dirty: false,
            window_open: false,
            restore_pending: false,
            ending_ack: -1,
            assets_ready: 0,
        }
    }
    fn notice(&mut self, id: &str, args: Value, error: bool) {
        self.history.notice(id, args.clone(), error);
        if flag(&self.model["topOpen"]) {
            self.model["topNotice"] = json!({"id":id,"args":args,"error":error});
        }
    }
    fn log(&mut self, value: Value) {
        push(&mut self.state["logs"], value, 128);
    }
    fn label(&mut self, id: &str, args: &Value) -> String {
        self.catalog.label(text(&self.model["language"]), id, args)
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
        self.model["settingsOpen"] = json!(open);
        self.focus(if !open && self.text_mode {
            "prompt-text"
        } else {
            "canvas"
        });
    }
    fn return_top(&mut self) {
        if flag(&self.model["savePending"]) {
            return;
        }
        self.effects.push(json!({"kind":"worker-stop"}));
        for key in ["starting", "returnAfterEnd", "running", "settingsOpen"] {
            self.model[key] = json!(false);
        }
        self.model["topOpen"] = json!(true);
        self.model["frame"] = Value::Null;
        self.input = Value::Null;
        self.text_mode = false;
        self.draft_dirty = false;
        self.composing = false;
        self.restore_pending = false;
        self.window_open = false;
        self.ending_ack = -1;
        self.history = History::default();
        self.notice("notice.top", json!({}), false);
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
    fn queue(&mut self, events: Value, after: &str) {
        if !flag(&self.model["running"]) {
            return;
        }
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
        let p = self.model["frame"]["ui"].clone();
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
        self.text_mode = next;
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
            self.notice("error.seed", json!({}), true);
            return;
        }
        if !restore && !valid_name {
            self.model["starting"] = json!(false);
            self.notice("error.name", json!({}), true);
            return;
        }
        let name = if valid_name {
            name.to_string()
        } else {
            "Player".into()
        };
        self.effects.push(json!({"kind":"worker-stop"}));
        self.model["generation"] = json!(number(&self.model["generation"]) + 1);
        for key in [
            "topOpen",
            "settingsOpen",
            "running",
            "savePending",
            "returnAfterEnd",
        ] {
            self.model[key] = json!(false);
        }
        self.model["frame"] = Value::Null;
        self.model["topNotice"] = Value::Null;
        self.model["starting"] = json!(true);
        for key in ["trace", "outcome", "exitCode", "runtimeError"] {
            self.state[key] = Value::Null;
        }
        for key in ["traces", "messages", "logs", "translationFallbacks"] {
            self.state[key] = json!([]);
        }
        self.state["frameCount"] = json!(0);
        self.state["inputRequestCount"] = json!(0);
        self.restore_pending = restore;
        self.text_mode = false;
        self.draft_dirty = false;
        self.input = Value::Null;
        self.window_open = false;
        self.ending_ack = -1;
        self.history = History::default();
        self.notice("notice.loading", json!({}), false);
        self.effects.push(json!({"kind":"worker-start","generation":self.model["generation"],"capacity":4096,
            "seed":entered_seed.unwrap_or(0),"name":name,"restore":restore,"locale":self.model["language"],
            "files":if self.environment["parameters"]["trace"]=="1" {json!([["/message-paging.txt","log"],["/trace.enabled","1"]])} else {json!([["/message-paging.txt","log"]])}}));
    }
    fn persist_view(&mut self) {
        self.effects.push(json!({"kind":"storage-write","key":"rogue-map-display-v1","value":json!({"version":1,"mode":self.model["displayMode"],"zoom":self.model["tileSize"]}).to_string()}));
        self.ui.set_context(self.model.clone());
        self.ui.event(json!({"type":"center"}));
    }
    fn select(&mut self, id: &str, value: &str) {
        match id {
            "language" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) => {
                self.model["language"] = json!(if value == "en" { "en" } else { "ja" });
                self.document();
            }
            "display-mode" if mode(value) => {
                self.model["displayMode"] = json!(value);
                if !sizes(value).contains(&number(&self.model["tileSize"])) {
                    self.model["tileSize"] = json!(32);
                }
                self.persist_view();
            }
            _ => {}
        }
    }
    fn document(&mut self) {
        let title = self.label("app.title", &json!({}));
        self.effects
            .push(json!({"kind":"document","language":self.model["language"],"title":title}));
    }
    fn text_batch(&mut self, ending: u32) -> Option<Value> {
        let value = text(&self.inputs["prompt-text"]["value"]);
        let limit = self.input["limit_bytes"]
            .as_u64()
            .filter(|n| *n > 0)
            .unwrap_or(50) as usize;
        if !valid_text(value, limit, true) {
            self.notice("error.prompt_text", json!({"limit":limit}), true);
            return None;
        }
        let mut events = vec![21];
        events.extend(value.chars().map(|c| c as u32));
        events.push(ending);
        Some(json!(events))
    }
    fn submit(&mut self, id: &str) {
        if self.composing || flag(&self.model["settingsOpen"]) {
            return;
        }
        match id {
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
            "credits-repository"=>self.effects.push(json!({"kind":"open","url":"https://github.com/cacazu/jrogue/tree/main/rogue-nihon"})),
            "new-game" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) && !self.composing && flag(&self.model["ready"]) =>self.start(false),
            "load" if flag(&self.model["topOpen"]) && !flag(&self.model["starting"]) => {
                self.model["starting"]=json!(true);self.effects.push(json!({"kind":"save-read","operation":"load","generation":self.model["generation"]}));
            },
            "save" if flag(&self.model["running"]) && !flag(&self.model["savePending"]) && !flag(&self.model["returnAfterEnd"]) => {
                if self.composing {self.notice("error.text_composing",json!({}),true);return;}
                let events=if self.text_mode && self.draft_dirty {self.text_batch(RG_KEY_SAVE)} else {Some(json!([RG_KEY_SAVE]))};
                if let Some(events)=events {self.queue(events,"save");}
            },
            "download-save" if flag(&self.model["saved"])=>self.effects.push(json!({"kind":"download","filename":"rogue-save.json","mime":"application/json","revokeAfter":1000})),
            "center-map"=>{self.ui.event(json!({"type":"center"}));},
            "fullscreen"|"header-fullscreen"=>self.effects.push(json!({"kind":"fullscreen","enter":!flag(&self.environment["fullscreen"])})),
            "settings-toggle" if !flag(&self.model["returnAfterEnd"])=>self.settings(!flag(&self.model["settingsOpen"])),
            "settings-close"=>self.settings(false),"settings-top"=>self.return_top(),
            "result-top"=>{
                if !flag(&self.model["running"]) {self.return_top();}
                else if self.ending() && !flag(&self.model["returnAfterEnd"]) {self.model["returnAfterEnd"]=json!(true);self.finish_ending();}
            },
            "random-seed"|"random-name" if !flag(&self.model["starting"])=>self.effects.push(json!({"kind":"random","id":id})),_=>{}
        }
    }
    fn worker(&mut self, data: Value, generation: &Value) {
        if generation != &self.model["generation"] || flag(&self.model["topOpen"]) {
            return;
        }
        match text(&data["type"]) {
            "ready" => {
                self.model["starting"] = json!(false);
                self.model["running"] = json!(true);
                self.notice(
                    if self.restore_pending {
                        "notice.restoring"
                    } else {
                        "notice.entered"
                    },
                    json!({}),
                    false,
                );
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
                } else if tiles::validate(&data, &tiles::manifest(text(&self.model["displayMode"])))
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
                    return;
                }
                self.fallback(&data, "frame");
                self.model["frame"] = data;
                self.state["frameCount"] = json!(number(&self.state["frameCount"]) + 1);
                self.presentation();
            }
            "presentation" if self.model["frame"].is_object() && data["ui"].is_object() => {
                self.model["frame"]["ui"] = data["ui"].clone();
                self.input = data["ui"]["input"].clone();
                self.presentation();
            }
            "trace" => {
                self.state["trace"] = data.clone();
                push(&mut self.state["traces"], data, 2048);
            }
            "input-context" => self.apply_input(data["input"].clone()),
            "message" => {
                push(&mut self.state["messages"], data.clone(), 128);
                self.history.message(data);
            }
            "input-request" => {
                self.state["inputRequestCount"] =
                    json!(number(&self.state["inputRequestCount"]) + 1);
                if self.restore_pending {
                    self.restore_pending = false;
                    self.notice("notice.restored", json!({}), false);
                }
                self.finish_ending();
            }
            "input-flush" => {
                let discarded = data["events"].as_array().cloned().unwrap_or_default();
                if discarded.iter().any(|v| {
                    number(v) & rogue_contract::RG_EVENT_SCALAR_MASK as u64 == RG_KEY_SAVE as u64
                }) {
                    self.model["savePending"] = json!(false);
                    self.notice("notice.save_cancelled", json!({}), false);
                } else {
                    self.notice("notice.input_flush", json!({"count":data["count"]}), false);
                }
            }
            "save" => self
                .effects
                .push(json!({"kind":"save-write","generation":generation,"bytes":data["bytes"]})),
            "outcome" => {
                self.state["outcome"] = json!({"code":data["code"],"text":data["text"]});
                self.notice("notice.game_ended", json!({}), false);
            }
            "exit" => {
                self.state["exitCode"] = data["code"].clone();
                self.model["running"] = json!(false);
                if data["code"].as_i64().unwrap_or(-1) < 0 {
                    self.notice("error.runtime", json!({}), true);
                } else if flag(&self.model["returnAfterEnd"]) {
                    self.return_top();
                }
            }
            "error" => {
                self.state["runtimeError"] = data["text"].clone();
                self.model["running"] = json!(false);
                self.model["starting"] = json!(false);
                self.notice("error.runtime", json!({}), true);
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
    fn api(&mut self, r: &Value) -> bool {
        let ok = flag(&r["ok"]);
        let operation = text(&r["operation"]);
        if r.get("generation").is_some() && r["generation"] != self.model["generation"] {
            return false;
        }
        match operation {
            "queue" => {
                if !ok {
                    self.notice("error.queue_full", json!({}), true);
                    return false;
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
            "init" | "load" => {
                if ok {
                    self.state["savedLength"] = r["length"].clone();
                    self.model["saved"] = json!(number(&r["length"]) > 0);
                    if operation == "load" {
                        if flag(&self.model["saved"]) {
                            self.start(true);
                        } else {
                            self.model["starting"] = json!(false);
                            self.notice("error.no_save", json!({}), true);
                        }
                    }
                } else {
                    self.log(r["error"].clone());
                    self.model["starting"] = json!(false);
                    self.notice(
                        if operation == "load" {
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
                if ok {
                    self.state["savedLength"] = r["length"].clone();
                    self.model["saved"] = json!(true);
                    self.notice("notice.saved", json!({}), false);
                } else {
                    self.log(r["error"].clone());
                    self.notice("error.save", json!({}), true);
                }
                self.model["savePending"] = json!(false);
            }
            "assets" => {
                let plan = tiles::assets(text(&r["set"]));
                let m = &plan["manifest"];
                let valid = r["images"].as_array().is_some_and(|images| {
                    images.len() == plan["files"].as_array().unwrap().len()
                        && images.iter().all(|image| {
                            image["width"] == m["tile_pixels"]
                                && image["height"] == m["tile_pixels"]
                        })
                });
                if ok && valid {
                    self.assets_ready += 1;
                    self.model["ready"] = json!(self.assets_ready == 2);
                } else {
                    self.state["runtimeError"] =
                        json!("Invalid tile dimensions or unavailable assets");
                    self.notice("error.tiles", json!({}), true);
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
    fn snapshot(&mut self) -> Value {
        let entries = self.history.entries.clone();
        self.model["entries"] = json!(
            entries
                .iter()
                .map(|e| json!({"source":e["source"],"error":e["error"],"text":self.entry_text(e)}))
                .collect::<Vec<_>>()
        );
        self.model["input"] = self.input.clone();
        let m = tiles::manifest(text(&self.model["displayMode"]));
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
        let notice = entries
            .iter()
            .rfind(|e| e["source"] == "system")
            .map(|e| self.entry_text(e))
            .unwrap_or_default();
        let message = entries
            .iter()
            .rfind(|e| e["source"] == "game")
            .map(|e| self.entry_text(e))
            .unwrap_or_default();
        let mut result = self.model.clone();
        for (k, v) in self.state.as_object().expect("State object") {
            result[k] = v.clone();
        }
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
        let mut raw = Value::Null;
        let mut commands = Value::Null;
        let mut surface = Value::Null;
        match text(&r["type"]) {
            "boot" => {
                self.environment = r["environment"].clone();
                let p = preference(text(&r["preference"]));
                self.model["language"] = json!(if self.environment["parameters"]["lang"] == "en" {
                    "en"
                } else {
                    "ja"
                });
                let view = text(&self.environment["parameters"]["view"]);
                let mode = if mode(view) { view } else { text(&p["mode"]) };
                self.model["displayMode"] = json!(mode);
                self.model["tileSize"] = json!(if sizes(mode).contains(&number(&p["zoom"])) {
                    number(&p["zoom"])
                } else {
                    32
                });
                self.document();
                self.field("name", json!({"value":"Player"}));
                self.field("seed", json!({"value":"12345"}));
                self.field("command-key", json!({"maxLength":1}));
                self.notice("notice.start", json!({}), false);
                self.effects
                    .push(json!({"kind":"save-read","operation":"init","generation":0}));
                self.effects.push(tiles::assets("tiles"));
                self.effects.push(tiles::assets("pixels"));
                self.effects.push(json!({"kind":"timer","interval":500}));
            }
            "worker" => self.worker(r["data"].clone(), &r["generation"]),
            "api" => accepted = self.api(&r),
            "event" => {
                let mut e = r["event"].clone();
                match text(&e["type"]) {
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
                            "name" | "seed" | "prompt-text" | "command-key"
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
                        self.snapshot();
                        self.ui.set_context(self.model.clone());
                        let response = self.ui.event(e);
                        consumed = flag(&response["consumed"]);
                        raw = response["raw"].clone();
                        for effect in response["effects"].as_array().into_iter().flatten() {
                            match text(&effect["kind"]) {
                                "invoke" => self.invoke(text(&effect["id"])),
                                "select" => {
                                    self.select(text(&effect["id"]), text(&effect["value"]))
                                }
                                "zoom" => {
                                    let mode = text(&self.model["displayMode"]);
                                    if mode != "ascii"
                                        && let Some(size) = sizes(mode)
                                            .get(effect["index"].as_f64().unwrap_or(0.) as usize)
                                    {
                                        self.model["tileSize"] = json!(size);
                                        self.persist_view();
                                    }
                                }
                                "submit" => self.submit(text(&effect["id"])),
                                "send" => self.queue(json!([effect["key"]]), "send"),
                                _ => self.effects.push(effect.clone()),
                            }
                        }
                    }
                }
            }
            "render" => {
                self.snapshot();
                let mut view = r["view"].clone();
                view["inputs"] = self.inputs.clone();
                let ratio = view["ratio"].as_f64().unwrap_or(1.).clamp(1., 2.);
                view["ratio"] = json!(ratio);
                view["blink"] = json!((number(&view["now"]) / 500).is_multiple_of(2));
                let result = self.ui.render(self.model.clone(), view);
                commands = result["commands"].clone();
                let diagnostics = &result["diagnostics"];
                surface = json!({"width":diagnostics["width"],"height":diagnostics["height"],"ratio":ratio});
                let active = diagnostics["pointer"]["activeId"].as_i64();
                for id in r["captured"].as_array().into_iter().flatten() {
                    if id.as_i64() != active {
                        self.effects.push(json!({"kind":"release","id":id}));
                    }
                }
                for id in ["name", "seed", "prompt-text", "command-key"] {
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
                let m = tiles::manifest(text(&r["mode"]));
                if let Err(error) = tiles::validate(&r["frame"], &m) {
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
            self.controls();
        }
        let state = self.snapshot();
        self.ui.set_context(self.model.clone());
        json!({"commands":commands,"surface":surface,"effects":self.effects,"consumed":consumed,"stopPropagation":consumed && r["event"]["type"]=="key","accepted":accepted,"raw":raw,"state":state,"diagnostics":self.ui.diagnostics()})
    }
}
fn push(values: &mut Value, value: Value, limit: usize) {
    let entries = values.as_array_mut().expect("History array");
    entries.push(value);
    if entries.len() > limit {
        entries.remove(0);
    }
}
