//! Log parameters use semantic items. Wrapping never rewinds Japanese at spaces.
use super::*;
use super::inventory_item::parameter_icon;

#[derive(Clone)]
pub(super) struct LogUnit {
    text: String,
    icon: String,
    width: f64,
}

fn mobile_item_template(id: &str, japanese: bool) -> Option<&'static str> {
    Some(match (id, japanese) {
        ("weapons.wield.wielding", true) => "{0}を構えた。",
        ("weapons.wield.wielding", false) => "wielding {0}",
        ("rings.ring_off.was_wearing", true) => "外した指輪：{0}",
        ("rings.ring_off.was_wearing", false) => "was wearing {0}",
        ("armor.take_off.wearing" | "command.current.character_string"
            | "pack.picky_inven.character_string" | "ui.inventory.entry", _) => "{1}",
        ("pack.add_pack.string_character" | "rings.ring_on.string_character"
            | "pack.picky_inven.a", _) => "{0}",
        _ => return None,
    })
}

fn player_subject_fragment(id: &str) -> bool {
    matches!(id, "armor.wear.you_are_now" | "weapons.wield.you_are_now"
        | "pack.move_msg.you" | "fight.killed.you_have")
}

fn player_combat_message(message: &Value) -> bool {
    let self_actor = |value: &Value| value["type"] == "monster" && value["display"] == "you";
    let args = array(&message["args"]);
    if s(&message["id"]) == "message.sequence" {
        let values: Vec<&Value> = args.iter().flat_map(|part| array(&part["value"]["args"]))
            .filter(|arg| arg["kind"] == "entity").map(|arg| &arg["value"]).collect();
        return values.iter().any(|v| self_actor(v) && v["role"] == "subject")
            && values.iter().any(|v| v["type"] == "combat_verb");
    }
    args.iter().any(|arg| arg["kind"] == "entity" && arg["value"]["type"] == "combat"
        && self_actor(&arg["value"]["actor"]))
}

impl BrowserUi {
    pub(super) fn log_runs(&self, entry: &Value, mobile: bool) -> Vec<Value> {
        let mut message = entry["message"].clone();
        if !message.is_object() { return vec![json!({"text":entry["text"]})]; }
        crate::identity::replace_player_names(&mut message,s(&self.model["frame"]["ui"]["name"]));
        // Markers are generated only after ensuring the prefix cannot occur in
        // any input/name. They carry structural runs through the existing
        // localized formatter; no translated labels or English are parsed.
        let input = format!("{}{}",message,s(&entry["text"]));
        let mut counter = 0;
        let prefix = loop {
            let prefix = format!("\u{f0000}log{counter}:");
            if !input.contains(&prefix) { break prefix; }
            counter += 1;
        };
        let mut atoms: Vec<(String, Vec<Value>)> = Vec::new();
        let mut changed = false;
        self.log_rewrite_message(&mut message,mobile,&prefix,&mut atoms,&mut changed,0);
        if !changed { return vec![json!({"text":entry["text"]})]; }
        let rendered = crate::display::message_language(s(&message["id"]),&message["args"],"",s(&self.model["language"]));
        if !rendered.missing_ids.is_empty() { return vec![json!({"text":entry["text"]})]; }
        let mut remaining = rendered.text.as_str();
        let mut runs = Vec::new();
        while let Some((index,(marker,parts))) = atoms.iter()
            .filter_map(|atom| remaining.find(&atom.0).map(|index| (index,atom)))
            .min_by_key(|(index,_)| *index)
        {
            if index > 0 { runs.push(json!({"text":&remaining[..index]})); }
            runs.extend(parts.iter().cloned());
            remaining = &remaining[index+marker.len()..];
        }
        if !remaining.is_empty() { runs.push(json!({"text":remaining})); }
        runs
    }

    fn log_rewrite_message(&self, message: &mut Value, mobile: bool, prefix: &str,
        atoms: &mut Vec<(String,Vec<Value>)>, changed: &mut bool, depth: usize) {
        if depth > 16 { return; }
        message["fallback"] = json!("");
        let omit_subject = mobile && self.model["language"] == "ja";
        if omit_subject && player_subject_fragment(s(&message["id"])) {
            message["id"] = json!("ui.text");
            message["args"] = json!([{"kind":"string","value":""}]);
            *changed = true;
            return;
        }
        if let Some(args) = message["args"].as_array_mut() {
            for arg in args {
                match s(&arg["kind"]) {
                    "message_part" | "part" => self.log_rewrite_message(&mut arg["value"],mobile,prefix,atoms,changed,depth+1),
                    "entity" if arg["value"]["type"] == "message" => {
                        self.log_rewrite_message(&mut arg["value"],mobile,prefix,atoms,changed,depth+1);
                    }
                    "entity" if omit_subject && arg["value"]["type"] == "term"
                        && player_subject_fragment(s(&arg["value"]["id"])) => {
                        arg["value"] = json!({"type":"literal","text":""});
                        *changed = true;
                    }
                    "term" if omit_subject && player_subject_fragment(s(&arg["value"])) => {
                        *arg = json!({"kind":"string","value":""});
                        *changed = true;
                    }
                    "entity" if arg["value"]["type"] == "item" => {
                        let item = &arg["value"];
                        if b(&item["pickup"]) { *changed = true; }
                        let parameters = crate::inventory::parameters(item);
                        if parameters.is_empty() { continue; }
                        let mut base = item.clone();
                        for field in ["hplus","dplus","ac","ring_bonus","charges"] {
                            base["visible_fields"][field] = json!(false);
                        }
                        let Some(name) = crate::entities::render(&base,s(&self.model["language"])) else { continue; };
                        let mut parts = vec![json!({"text":name}),json!({"text":" ("})];
                        for (index,(field,value)) in parameters.iter().enumerate() {
                            if index > 0 { parts.push(json!({"text":" "})); }
                            let value = if matches!(*field,"hplus"|"dplus"|"enchantment"|"bonus") {
                                format!("{value:+}")
                            } else { value.to_string() };
                            let kind = crate::inventory::parameter_kind(item,field);
                            let label = if mobile { String::new() } else {
                                self.t(&format!("log.parameter.{kind}")) + if self.model["language"] == "en" { " " } else { "" }
                            };
                            parts.push(json!({"icon":parameter_icon(kind),"text":format!("{label}{value}")}));
                        }
                        parts.push(json!({"text":")"}));
                        let marker = format!("{prefix}{}\u{f0001}",atoms.len());
                        atoms.push((marker.clone(),parts));
                        arg["value"] = json!({"type":"literal","text":marker});
                        *changed = true;
                    }
                    _ => {}
                }
            }
        }
        if mobile && let Some(template) = mobile_item_template(s(&message["id"]),self.model["language"] == "ja") {
            let prepared: Vec<Value> = array(&message["args"]).iter().map(|arg| {
                json!({"kind":"string","value":crate::display::message_language(
                    "message.entity",&json!([arg]),"",s(&self.model["language"])).text})
            }).collect();
            if let Ok(text) = crate::display::format_template(template,&prepared) {
                message["id"] = json!("ui.text");
                message["args"] = json!([{"kind":"string","value":text}]);
                *changed = true;
            }
        }
        if omit_subject && player_combat_message(message) {
            let rendered = crate::display::message_language(s(&message["id"]),&message["args"],"","ja");
            if rendered.missing_ids.is_empty()
                && let Some(text) = rendered.text.strip_prefix("あなたは")
                    .or_else(|| rendered.text.strip_prefix("あなたが")) {
                message["id"] = json!("ui.text");
                message["args"] = json!([{"kind":"string","value":text}]);
                *changed = true;
            }
        }
    }

    pub(super) fn log_lines(&self, runs: &[Value], width: f64, font: f64) -> Vec<Vec<LogUnit>> {
        let mut units = Vec::new();
        for run in runs {
            let icon = s(&run["icon"]);
            if !icon.is_empty() {
                units.push(LogUnit {text:s(&run["text"]).into(),icon:icon.into(),width:font+2.+(self.measure)(s(&run["text"]),font,false,false).width});
                continue;
            }
            let mut word = String::new();
            let flush = |word: &mut String, units: &mut Vec<LogUnit>| {
                if word.is_empty() { return; }
                let w = (self.measure)(word,font,false,false).width;
                if w <= width {
                    units.push(LogUnit {text:std::mem::take(word),icon:String::new(),width:w});
                } else {
                    for ch in word.chars() { let text=ch.to_string();units.push(LogUnit {width:(self.measure)(&text,font,false,false).width,text,icon:String::new()}); }
                    word.clear();
                }
            };
            for ch in s(&run["text"]).chars() {
                if ch.is_ascii_alphanumeric() || matches!(ch,'+'|'-'|'\'') { word.push(ch);continue; }
                flush(&mut word,&mut units);
                let text = ch.to_string();
                units.push(LogUnit {width:(self.measure)(&text,font,false,false).width,text,icon:String::new()});
            }
            flush(&mut word,&mut units);
        }
        let mut lines = Vec::new();
        let mut line: Vec<LogUnit> = Vec::new();
        let mut used = 0.;
        for unit in units {
            if unit.text == "\n" { lines.push(std::mem::take(&mut line));used=0.;continue; }
            if !line.is_empty() && used+unit.width > width {
                let mut carry = Vec::new();
                // Keep opening brackets off line ends and closing punctuation
                // off line starts, without moving a Japanese phrase to a space.
                if unit.icon.is_empty() && ")）]］}｝、。！？!?：:」』".contains(unit.text.as_str()) {
                    while let Some(last)=line.pop() {
                        let punctuation=last.icon.is_empty() &&
                            (")）]］}｝、。！？!?：:」』".contains(last.text.as_str()) || last.text.trim().is_empty());
                        carry.insert(0,last);
                        if !punctuation { break; }
                    }
                } else if line.last().is_some_and(|last| last.icon.is_empty() && "(（[［{｛「『".contains(last.text.as_str())) {
                    while line.last().is_some_and(|last| last.icon.is_empty() && "(（[［{｛「『".contains(last.text.as_str())) {
                        carry.insert(0,line.pop().unwrap());
                    }
                }
                while line.last().is_some_and(|last| last.text.trim().is_empty()) {line.pop();}
                if !line.is_empty() { lines.push(std::mem::take(&mut line)); }
                line=carry;used=line.iter().map(|unit|unit.width).sum();
            }
            if line.is_empty() && unit.text.trim().is_empty(){continue;}
            used+=unit.width;line.push(unit);
        }
        if !line.is_empty(){lines.push(line);}
        lines
    }

    pub(super) fn draw_log_line(&mut self, line: &[LogUnit], x: f64, y: f64, font: f64, color: &str) {
        let mut x=x;
        let mut text=String::new();
        let mut text_x=x;
        for unit in line {
            if !unit.icon.is_empty() {
                if !text.is_empty(){self.widgets.raw_text(&text,text_x,y,TextStyle::new(font,color,false));text.clear();}
                self.draw_parameter_icon(&unit.icon,Rect::new(x,y,font,font));
                self.widgets.raw_text(&unit.text,x+font+2.,y,TextStyle::new(font,color,false));
                x+=unit.width;text_x=x;
            } else {text.push_str(&unit.text);x+=unit.width;}
        }
        if !text.is_empty(){self.widgets.raw_text(&text,text_x,y,TextStyle::new(font,color,false));}
    }
}
