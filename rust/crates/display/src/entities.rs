//! Visible semantic descriptors become names without consulting C game state.
//! Unknown magic types never use `which`; hidden object bonuses stay hidden.
use serde_json::Value;
use std::sync::OnceLock;

fn japanese(language: &str) -> bool {
    language.starts_with("ja")
}

fn catalog(language: &str) -> &'static Value {
    static ENGLISH: OnceLock<Value> = OnceLock::new();
    static JAPANESE: OnceLock<Value> = OnceLock::new();
    let (slot, source) = if japanese(language) {
        (
            &JAPANESE,
            include_str!("../../../../locales/entities-ja.json"),
        )
    } else {
        (
            &ENGLISH,
            include_str!("../../../../locales/entities-en.json"),
        )
    };
    slot.get_or_init(|| serde_json::from_str(source).unwrap_or(Value::Null))
}

fn text(language: &str, id: &str) -> Option<&'static str> {
    catalog(language)["entries"][id]["text"].as_str()
}

fn table_text(language: &str, table: &str, index: u64) -> Option<&'static str> {
    let index = usize::try_from(index).ok()?;
    let id = catalog(language)["tables"][table].get(index)?.as_str()?;
    text(language, id)
}

// Substitute only in the catalog template, never recursively in user labels.
fn form(language: &str, key: &str, arguments: &[(&str, String)]) -> Option<String> {
    let mut remaining = catalog(language)["forms"][key].as_str()?;
    let mut output = String::new();
    while let Some(open) = remaining.find('{') {
        output.push_str(&remaining[..open]);
        remaining = &remaining[open + 1..];
        let close = remaining.find('}')?;
        let key = &remaining[..close];
        output.push_str(&arguments.iter().find(|(name, _)| *name == key)?.1);
        remaining = &remaining[close + 1..];
    }
    output.push_str(remaining);
    Some(output)
}

fn number(value: &Value, name: &str) -> Option<i64> {
    value.get(name)?.as_i64()
}

fn boolean(value: &Value, name: &str) -> bool {
    value.get(name).and_then(Value::as_bool).unwrap_or(false)
}

fn field_visible(value: &Value, name: &str, original_branch: bool) -> bool {
    original_branch
        && value["visible_fields"][name]
            .as_bool()
            .unwrap_or(original_branch)
}

fn type_known(value: &Value) -> bool {
    match (
        value.get("known").and_then(Value::as_bool),
        value.get("type_known").and_then(Value::as_bool),
    ) {
        (Some(first), Some(second)) => first && second,
        (Some(known), None) | (None, Some(known)) => known,
        _ => false,
    }
}

fn category(value: &Value) -> Option<&str> {
    if let Some(category) = value.get("category").and_then(Value::as_str) {
        return Some(category);
    }
    let code = value
        .get("category_code")
        .or_else(|| value.get("category"))?
        .as_u64()?;
    Some(match code {
        33 => "potion",
        63 => "scroll",
        61 => "ring",
        47 => "stick",
        41 => "weapon",
        93 => "armor",
        58 => "food",
        42 => "gold",
        44 => "amulet",
        _ => return None,
    })
}

fn kind_name(value: &Value, language: &str, category: &str) -> Option<String> {
    let kind = if category == "stick" {
        match value.get("subtype").and_then(Value::as_str) {
            Some("wand") => "wand",
            Some("staff") => "staff",
            _ => "stick",
        }
    } else {
        category
    };
    Some(text(language, &format!("category.{kind}"))?.into())
}

fn appearance(value: &Value, language: &str) -> Option<String> {
    let raw_kind = value.get("kind")?.as_str()?;
    let kind = match raw_kind {
        "potion_color" => "color",
        "ring_stone" => "stone",
        "stick_material" => value.get("material")?.as_str()?,
        other => other,
    };
    if kind == "scroll_title" {
        // A randomized magical proper name has no translatable English meaning.
        return value.get("text").and_then(Value::as_str).map(str::to_owned);
    }
    if !matches!(kind, "color" | "stone" | "wood" | "metal") {
        return None;
    }
    if let Some(id) = value.get("id").and_then(Value::as_str)
        && let Some(name) = text(language, id)
    {
        return Some(name.into());
    }
    if let Some(index) = value
        .get("id")
        .or_else(|| value.get("index"))
        .and_then(Value::as_u64)
        && let Some(name) = table_text(language, kind, index)
    {
        return Some(name.into());
    }
    if let Some(original) = value.get("text").and_then(Value::as_str) {
        for id in catalog("en")["tables"][kind].as_array()? {
            let id = id.as_str()?;
            if text("en", id) == Some(original) {
                return text(language, id).map(str::to_owned);
            }
        }
    }
    text(language, "appearance.unknown").map(str::to_owned)
}

fn signed(value: i64) -> String {
    format!("{value:+}")
}

fn render_fruit(value: &Value, language: &str) -> Option<String> {
    let raw = value
        .get("value")
        .or_else(|| value.get("fruit"))
        .or_else(|| value.get("text"))?
        .as_str()?;
    let default = value
        .get("default")
        .and_then(Value::as_bool)
        .unwrap_or(raw == "slime-mold");
    fruit_name(raw, default, language)
}

fn fruit_name(raw: &str, default: bool, language: &str) -> Option<String> {
    if default && raw == "slime-mold" {
        text(language, "food.slime_mold").map(str::to_owned)
    } else {
        Some(raw.to_owned())
    }
}

fn capitalize_english(mut name: String, uppercase: bool) -> String {
    if let Some(first) = name.as_bytes().first()
        && first.is_ascii_alphabetic()
    {
        let first = if uppercase {
            first.to_ascii_uppercase()
        } else {
            first.to_ascii_lowercase()
        };
        name.replace_range(..1, &char::from(first).to_string());
    }
    name
}

fn indefinite(language: &str, name: String, vowel_name: &str) -> Option<String> {
    let article = if vowel_name
        .as_bytes()
        .first()
        .is_some_and(|c| b"aeiouAEIOU".contains(c))
    {
        "An"
    } else {
        "A"
    };
    form(
        language,
        "indefinite",
        &[("article", article.into()), ("name", name)],
    )
}

fn render_item(value: &Value, language: &str) -> Option<String> {
    let category = category(value)?;
    let count = number(value, "count").unwrap_or(1);
    // Original room gold and the unique Amulet are calloc-initialized with
    // o_count == 0. Neither original name branch uses it as a stack count.
    if count < 1 && !(count == 0 && matches!(category, "gold" | "amulet")) {
        return None;
    }
    let known = type_known(value);
    let identified = boolean(value, "identified");
    let which = value.get("which").and_then(Value::as_u64);
    let called = value
        .get("called")
        .and_then(Value::as_str)
        .filter(|_| !known);
    let appearance_name = value
        .get("appearance")
        .and_then(|v| appearance(v, language));
    let mut kind = kind_name(value, language, category)?;
    if !japanese(language)
        && count > 1
        && matches!(category, "potion" | "scroll" | "ring" | "stick")
    {
        kind.push('s');
    }
    let mut already_counted = false;
    let mut name = match category {
        "weapon" | "armor" => {
            let mut name = which
                .and_then(|index| table_text(language, category, index))
                .unwrap_or(&kind)
                .to_owned();
            if category == "weapon" && !japanese(language) && count > 1 {
                name.push('s');
            }
            name
        }
        "potion" | "scroll" | "ring" | "stick" => {
            if known {
                if let Some(effect) = which.and_then(|index| table_text(language, category, index))
                {
                    form(
                        language,
                        "effect",
                        &[("kind", kind.clone()), ("effect", effect.into())],
                    )?
                } else {
                    kind.clone()
                }
            } else if let Some(label) = called {
                form(
                    language,
                    "called",
                    &[("name", kind.clone()), ("label", label.into())],
                )?
            } else if category == "scroll" {
                let title = appearance_name.clone().unwrap_or_default();
                form(
                    language,
                    "scroll_title",
                    &[("title", title), ("kind", kind.clone())],
                )?
            } else {
                let visible = appearance_name
                    .clone()
                    .unwrap_or_else(|| text(language, "appearance.unknown").unwrap_or("").into());
                form(
                    language,
                    "appearance",
                    &[("kind", kind.clone()), ("appearance", visible)],
                )?
            }
        }
        "food" => {
            already_counted = true;
            if which == Some(1) {
                let raw = value
                    .get("fruit")
                    .and_then(Value::as_str)
                    .unwrap_or("slime-mold");
                let fruit = fruit_name(raw, raw == "slime-mold", language)?;
                if count == 1 {
                    if japanese(language) {
                        fruit
                    } else {
                        indefinite(language, fruit.clone(), &fruit)?
                    }
                } else {
                    form(
                        language,
                        "fruit_count",
                        &[("fruit", fruit), ("count", count.to_string())],
                    )?
                }
            } else if count == 1 {
                text(language, "food.ration")?.into()
            } else {
                form(language, "food_count", &[("count", count.to_string())])?
            }
        }
        "gold" => {
            already_counted = true;
            let gold = number(value, "gold_value")
                .or_else(|| number(value, "gold"))
                .unwrap_or(count);
            if gold < 0 {
                return None;
            }
            form(language, "gold", &[("count", gold.to_string())])?
        }
        "amulet" => {
            already_counted = true;
            text(language, "item.amulet.yendor")?.into()
        }
        _ => return None,
    };
    let article_base = name.clone();
    if category == "weapon"
        && field_visible(value, "hplus", identified)
        && field_visible(value, "dplus", identified)
        && let (Some(hit), Some(damage)) = (number(value, "hplus"), number(value, "dplus"))
    {
        name = form(
            language,
            "weapon_bonus",
            &[
                ("name", name),
                ("hit", signed(hit)),
                ("damage", signed(damage)),
            ],
        )?;
    }
    if category == "armor"
        && field_visible(value, "ac", identified)
        && let Some(ac) = number(value, "ac")
    {
        let protection = number(value, "protection").or_else(|| 10_i64.checked_sub(ac))?;
        if let Some(enchantment) = number(value, "enchantment") {
            name = form(
                language,
                if !japanese(language) && boolean(value, "terse") {
                    "armor_bonus_brief"
                } else {
                    "armor_bonus"
                },
                &[
                    ("name", name),
                    ("bonus", signed(enchantment)),
                    ("protection", protection.to_string()),
                ],
            )?;
        }
    }
    if category == "ring"
        && field_visible(
            value,
            "ring_bonus",
            identified && (known || called.is_some()),
        )
        && let Some(bonus) = number(value, "bonus")
    {
        name = form(
            language,
            "ring_bonus",
            &[("name", name), ("bonus", signed(bonus))],
        )?;
    }
    if matches!(category, "weapon" | "armor")
        && let Some(label) = value.get("label").and_then(Value::as_str)
    {
        name = form(
            language,
            "called",
            &[("name", name), ("label", label.into())],
        )?;
    }
    if matches!(category, "potion" | "ring" | "stick") && (known || called.is_some()) {
        if !japanese(language) {
            if category == "stick"
                && field_visible(value, "charges", identified && (known || called.is_some()))
                && let Some(charges) = number(value, "charges")
            {
                name = form(
                    language,
                    if boolean(value, "terse") {
                        "charges_brief"
                    } else {
                        "charges_known"
                    },
                    &[("name", name), ("charges", charges.to_string())],
                )?;
            }
            if let Some(appearance) = appearance_name {
                name = form(
                    language,
                    "appearance_known",
                    &[("name", name), ("appearance", appearance)],
                )?;
            }
        } else {
            let mut details = appearance_name.into_iter().collect::<Vec<_>>();
            if category == "stick"
                && field_visible(value, "charges", identified && (known || called.is_some()))
                && let Some(charges) = number(value, "charges")
            {
                details.push(form(
                    language,
                    "charges",
                    &[("charges", charges.to_string())],
                )?);
            }
            if !details.is_empty() {
                name = form(
                    language,
                    "details",
                    &[
                        ("name", name),
                        (
                            "details",
                            details.join(if japanese(language) { "・" } else { ", " }),
                        ),
                    ],
                )?;
            }
        }
    }
    if !already_counted {
        if count > 1 {
            name = form(
                language,
                "quantity",
                &[("name", name), ("count", count.to_string())],
            )?;
        } else if !japanese(language) && category != "armor" {
            name = indefinite(language, name, &article_base)?;
        }
    }
    if value
        .get("describe")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && let Some(equipped) = value.get("equipped").and_then(Value::as_str)
        && let Some(description) = text(language, &format!("equipped.{equipped}"))
    {
        name = form(
            language,
            "details",
            &[("name", name), ("details", description.into())],
        )?;
    }
    if japanese(language) {
        Some(name)
    } else {
        Some(capitalize_english(name, !boolean(value, "drop")))
    }
}

fn render_monster(value: &Value, language: &str) -> Option<String> {
    let display = value
        .get("display")
        .and_then(Value::as_str)
        .unwrap_or("name");
    let mut name = match display {
        "you" | "it" | "something" => text(language, &format!("monster.{display}"))?.to_owned(),
        "name" => table_text(language, "monster", value.get("index")?.as_u64()?)?.to_owned(),
        _ => return None,
    };
    if display == "name" && value.get("article").and_then(Value::as_str) == Some("definite") {
        name = form(language, "definite", &[("name", name)])?;
    }
    if !japanese(language) && boolean(value, "upper") {
        name = capitalize_english(name, true);
    }
    Some(name)
}

fn render_death(value: &Value, language: &str) -> Option<String> {
    let code = value.get("code")?;
    let code = code.as_u64().or_else(|| {
        code.as_str()
            .and_then(|s| s.as_bytes().first().map(|byte| u64::from(*byte)))
    })?;
    let (name, uses_article) = if (65..=90).contains(&code) {
        (table_text(language, "monster", code - 65)?.to_owned(), true)
    } else {
        let (id, article) = match code {
            97 => ("arrow", true),
            98 => ("bolt", true),
            100 => ("dart", true),
            104 => ("hypothermia", false),
            115 => ("starvation", false),
            _ => ("badger", false),
        };
        (text(language, &format!("death.{id}"))?.to_owned(), article)
    };
    if !japanese(language) && boolean(value, "article") && uses_article {
        let original = name.clone();
        return indefinite(language, name, &original).map(|name| capitalize_english(name, false));
    }
    Some(name)
}

fn render_combat(value: &Value, language: &str) -> Option<String> {
    let actor_value = value.get("actor")?;
    if actor_value.get("type")?.as_str()? != "monster" {
        return None;
    }
    let actor = render_monster(actor_value, language)?;
    let hit = boolean(value, "hit");
    let event = if hit { "hit" } else { "miss" };
    let target = value
        .get("target")
        .filter(|target| target.get("type").and_then(Value::as_str) == Some("monster"))
        .and_then(|target| render_monster(target, language));
    if boolean(value, "terse") || target.is_none() {
        return form(
            language,
            &format!("combat.{event}.terse"),
            &[("actor", actor)],
        );
    }
    let index = usize::try_from(value.get("index")?.as_u64()?).ok()?;
    let identifier = catalog(language)["tables"][event].get(index)?.as_str()?;
    form(
        language,
        &format!("{identifier}.sentence"),
        &[("actor", actor), ("target", target?)],
    )
}

/// Render only information supplied by C's original visible-name branch.
pub fn render(value: &Value, language: &str) -> Option<String> {
    match value.get("type")?.as_str()? {
        "item" => render_item(value, language),
        "item_category" => kind_name(value, language, category(value)?),
        "item_name" => {
            let category = category(value)?;
            let which = value.get("which")?.as_u64()?;
            let effect = table_text(language, category, which)?;
            if value.get("form").and_then(Value::as_str) == Some("effect")
                || matches!(category, "weapon" | "armor")
            {
                Some(effect.into())
            } else {
                form(
                    language,
                    "effect",
                    &[
                        ("kind", kind_name(value, language, category)?),
                        ("effect", effect.into()),
                    ],
                )
            }
        }
        "appearance" => appearance(value, language),
        "fruit" => render_fruit(value, language),
        // Production substitutes Session's Unicode name before rendering.
        // A supplied value is useful for isolated descriptors; an absent value
        // must not reveal the C-side ASCII alias or invent a player name.
        "player_name" => value
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_owned),
        "trap" => table_text(language, "trap", value.get("index")?.as_u64()?).map(str::to_owned),
        "monster" => render_monster(value, language),
        "death" => render_death(value, language),
        "combat" => render_combat(value, language),
        "combat_verb" => {
            let hit = value
                .get("hit")
                .and_then(Value::as_bool)
                .unwrap_or(value.get("event").and_then(Value::as_str) == Some("hit"));
            let index = value
                .get("index")
                .or_else(|| value.get("variant"))?
                .as_u64()?;
            table_text(language, if hit { "hit" } else { "miss" }, index).map(str::to_owned)
        }
        _ => None,
    }
}
