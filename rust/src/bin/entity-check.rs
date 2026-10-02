//! Name/knowledge regression checks; no C state, host callbacks, or RNG.
#[path = "../display.rs"]
mod display;
#[path = "../entities.rs"]
mod entities;
use serde_json::{Value, json};

fn rendered(value: Value) -> String {
    entities::render(&value, "ja").expect("supported semantic fixture")
}

fn main() {
    let mut checks = 0_usize;
    let english: Value = serde_json::from_str(include_str!("../../../locales/entities-en.json"))
        .expect("English catalog");
    let japanese: Value = serde_json::from_str(include_str!("../../../locales/entities-ja.json"))
        .expect("Japanese catalog");
    assert_eq!(
        english["entries"]
            .as_object()
            .expect("entries")
            .keys()
            .collect::<Vec<_>>(),
        japanese["entries"]
            .as_object()
            .expect("entries")
            .keys()
            .collect::<Vec<_>>()
    );
    checks += 1;
    for (table, count) in [
        ("weapon", 9),
        ("armor", 8),
        ("potion", 14),
        ("scroll", 18),
        ("ring", 14),
        ("stick", 14),
        ("monster", 26),
        ("trap", 8),
        ("color", 27),
        ("stone", 26),
        ("wood", 33),
        ("metal", 22),
        ("hit", 8),
        ("miss", 8),
        ("scroll_syllables", 147),
    ] {
        assert_eq!(
            japanese["tables"][table].as_array().expect("table").len(),
            count,
            "{table}"
        );
        checks += 1;
    }
    for (id, value) in japanese["entries"].as_object().expect("entries") {
        assert!(
            !value["text"].as_str().expect("text").is_empty(),
            "empty Japanese {id}"
        );
        assert!(
            english["entries"][id]["text"].as_str().is_some(),
            "missing English {id}"
        );
        checks += 1;
    }
    for category in ["weapon", "armor", "potion", "scroll", "ring", "stick"] {
        for index in 0..japanese["tables"][category]
            .as_array()
            .expect("table")
            .len()
        {
            let value = json!({"type":"item","category":category,"which":index,"known":true,"identified":false,"count":1,"subtype":"wand","equipped":"none"});
            assert!(!rendered(value).is_empty(), "known {category} {index}");
            checks += 1;
        }
    }
    for (kind, count) in [("color", 27), ("stone", 26), ("wood", 33), ("metal", 22)] {
        for index in 0..count {
            let name = rendered(
                json!({"type":"appearance","kind":kind,"id":index,"text":"do not use raw English"}),
            );
            assert!(!name.is_empty());
            checks += 1;
        }
    }
    for index in 0..26 {
        let name =
            rendered(json!({"type":"monster","display":"name","index":index,"article":"definite"}));
        assert!(!name.is_empty());
        checks += 1;
    }
    for index in 0..8 {
        assert!(!rendered(json!({"type":"trap","index":index})).is_empty());
        checks += 1;
    }
    let mut verify = |value: Value, expected: &str| {
        assert_eq!(rendered(value), expected);
        checks += 1;
    };
    verify(
        json!({"type":"item","category":"weapon","which":0,"count":1,"identified":true,"hplus":1,"dplus":1,"equipped":"weapon"}),
        "メイス（命中+1・威力+1）（武器として装備中）",
    );
    verify(
        json!({"type":"item","category":"weapon","which":3,"count":35,"identified":true,"hplus":0,"dplus":0}),
        "矢（命中+0・威力+0） ×35",
    );
    verify(
        json!({"type":"item","category":"armor","which":1,"count":1,"identified":true,"ac":6,"enchantment":1,"equipped":"armor"}),
        "+1 リングメイル［防御力4］（着用中）",
    );
    verify(
        json!({"type":"item","category":"weapon","which":0,"count":1,"identified":false,"hplus":99,"dplus":99}),
        "メイス",
    );
    verify(
        json!({"type":"item","category":"armor","which":4,"count":1,"identified":false,"ac":-99,"enchantment":99}),
        "チェインメイル",
    );
    verify(
        json!({"type":"item","category":"potion","which":5,"count":1,"known":true,"appearance":{"kind":"color","id":17}}),
        "治癒の薬（赤色）",
    );
    verify(
        json!({"type":"item","category":"potion","which":5,"count":2,"known":false,"appearance":{"kind":"color","id":17}}),
        "赤色の薬 ×2",
    );
    verify(
        json!({"type":"item","category":"scroll","which":5,"known":false,"count":1,"appearance":{"kind":"scroll_title","text":"ab foo {count}"}}),
        "「ab foo {count}」と記された巻物",
    );
    verify(
        json!({"type":"item","category":"ring","which":null,"known":false,"identified":true,"bonus":1,"called":"守り?{count}","appearance":{"kind":"stone","id":18},"equipped":"left_ring"}),
        "指輪（命名：守り?{count}）［+1］（ルビー）（左手に装備中）",
    );
    verify(
        json!({"type":"item","category":"stick","which":3,"known":true,"identified":true,"charges":3,"subtype":"wand","appearance":{"kind":"metal","id":8}}),
        "炎のワンド（鉄・残り3回）",
    );
    verify(
        json!({"type":"item","category":"stick","which":3,"known":false,"identified":false,"charges":99,"subtype":"staff","appearance":{"kind":"wood","id":2}}),
        "竹の杖",
    );
    verify(
        json!({"type":"item","category":"food","which":0,"count":2}),
        "食料2食分",
    );
    verify(
        json!({"type":"item","category":"food","which":1,"count":1,"fruit":"slime-mold"}),
        "スライムモールド",
    );
    verify(
        json!({"type":"item","category":"food","which":1,"count":2,"fruit":"100% {name}りんご"}),
        "100% {name}りんご ×2",
    );
    verify(
        json!({"type":"item","category":"gold","count":1,"gold_value":123}),
        "金貨123枚",
    );
    verify(
        json!({"type":"item","category":"gold","count":0,"gold":123}),
        "金貨123枚",
    );
    verify(
        json!({"type":"item","category":"amulet","count":1}),
        "イェンダーの護符",
    );
    verify(
        json!({"type":"monster","display":"you","index":3}),
        "あなた",
    );
    verify(
        json!({"type":"monster","display":"something","index":3}),
        "何か",
    );
    verify(
        json!({"type":"death","code":104,"article":true}),
        "低体温症",
    );
    verify(
        json!({"type":"death","code":65,"article":true}),
        "アクアター",
    );
    verify(
        json!({"type":"appearance","kind":"color","text":"amber"}),
        "琥珀色",
    );
    verify(json!({"type":"item_category","category_code":41}), "武器");
    verify(
        json!({"type":"item_name","category":"potion","which":5,"form":"effect"}),
        "治癒",
    );
    verify(
        json!({"type":"combat_verb","hit":false,"index":2}),
        "攻撃がわずかに外れた",
    );
    verify(
        json!({"type":"fruit","value":"slime-mold"}),
        "スライムモールド",
    );
    verify(
        json!({"type":"fruit","value":"slime-mold","default":false}),
        "slime-mold",
    );
    verify(
        json!({"type":"fruit","value":"100% {name}果実","default":false}),
        "100% {name}果実",
    );
    verify(
        json!({"type":"player_name","value":"勇者100% {name}"}),
        "勇者100% {name}",
    );
    verify(
        json!({"type":"combat","hit":true,"index":1,"actor":{"type":"monster","display":"you"},"target":{"type":"monster","display":"name","index":14}}),
        "あなたの攻撃がオークに命中した",
    );
    verify(
        json!({"type":"combat","hit":true,"index":0,"actor":{"type":"monster","display":"you"},"target":{"type":"monster","display":"name","index":14}}),
        "あなたはオークに痛烈な一撃を与えた",
    );
    verify(
        json!({"type":"combat","hit":false,"index":2,"actor":{"type":"monster","display":"name","index":14},"target":{"type":"monster","display":"you"}}),
        "オークの攻撃はあなたのすぐ脇を通り過ぎた",
    );
    verify(
        json!({"type":"combat","hit":true,"index":0,"terse":true,"actor":{"type":"monster","display":"name","index":14}}),
        "オークの攻撃が命中した",
    );
    assert_eq!(entities::render(&json!({"type":"item","category":"weapon","which":4,"count":2,"identified":true,"hplus":1,"dplus":2}), "en").expect("English weapon"), "2 +1,+2 daggers");
    checks += 1;
    assert_eq!(
        entities::render(
            &json!({"type":"item","category":"potion","which":5,"count":2,"known":true}),
            "en"
        )
        .expect("English potion"),
        "2 potions of healing"
    );
    checks += 1;
    assert_eq!(entities::render(&json!({"type":"item","category":"scroll","which":null,"count":2,"known":false,"appearance":{"kind":"scroll_title","text":"foo bar"}}), "en").expect("English scroll"), "2 scrolls titled 'foo bar'");
    checks += 1;
    for category in ["potion", "scroll", "ring", "stick"] {
        let base = json!({"type":"item","category":category,"count":1,"known":false,"identified":false,"charges":999,"bonus":999,"appearance":{"kind":"color","id":17}});
        let mut hidden_a = base.clone();
        let mut hidden_b = base;
        hidden_a["which"] = json!(0);
        hidden_b["which"] = json!(13);
        assert_eq!(
            rendered(hidden_a),
            rendered(hidden_b),
            "hidden identity {category}"
        );
        checks += 1;
    }
    assert!(entities::render(&json!({"type":"unknown"}), "ja").is_none());
    checks += 1;
    assert!(
        entities::render(&json!({"type":"monster","display":"name","index":26}), "ja").is_none()
    );
    checks += 1;
    assert!(
        entities::render(
            &json!({"type":"item","category":"weapon","which":0,"count":-1}),
            "ja"
        )
        .is_none()
    );
    checks += 1;
    assert!(entities::render(&json!({"type":"player_name"}), "ja").is_none());
    checks += 1;
    let mut verify_display = |id: &str, arguments: Value, fallback: &str, expected: &str| {
        let output = display::message_language(id, &arguments, fallback, "ja");
        assert_eq!(output.text, expected, "Japanese semantic message {id}");
        assert!(
            output.missing_ids.is_empty(),
            "unexpected missing IDs {id}: {:?}",
            output.missing_ids
        );
        checks += 1;
    };
    verify_display(
        "message.entity",
        json!([{"kind":"entity","value":{"type":"item","category":"weapon","which":0,"count":1,"identified":false}}]),
        "Mace",
        "メイス",
    );
    verify_display(
        "message.entity",
        json!([{"kind":"entity","value":{"type":"item","category":"potion","which":5,"known":false,"identified":false,"appearance":{"kind":"color","id":17}}}]),
        "Red potion",
        "赤色の薬",
    );
    verify_display(
        "ui.inventory.entry",
        json!([{"kind":"char","value":97},{"kind":"entity","value":{"type":"item","category":"weapon","which":0,"identified":false,"label":"勇者100% {name}"}}]),
        "a) Mace",
        "a) メイス（命名：勇者100% {name}）",
    );
    verify_display(
        "message.entity",
        json!([{"kind":"entity","value":{"type":"literal","text":"勇者100% {name}"}}]),
        "ascii-alias",
        "勇者100% {name}",
    );
    verify_display(
        "message.sequence",
        json!([
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"monster","display":"you","role":"subject"}}],"fallback":"You"}},
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"combat_verb","hit":true,"index":1}}],"fallback":" hit"}},
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"monster","display":"name","index":14,"role":"object"}}],"fallback":" the orc"}}
        ]),
        "You hit the orc",
        "あなたの攻撃がオークに命中した",
    );
    verify_display(
        "message.sequence",
        json!([
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"monster","display":"name","index":14,"role":"subject"}}],"fallback":"The orc"}},
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"combat_verb","hit":false,"index":2}}],"fallback":" barely misses"}},
            {"kind":"part","value":{"id":"message.entity","args":[{"kind":"entity","value":{"type":"monster","display":"you","role":"object"}}],"fallback":" you"}}
        ]),
        "The orc barely misses you",
        "オークの攻撃はあなたのすぐ脇を通り過ぎた",
    );
    let legacy = display::message_language(
        "message.legacy",
        &json!([]),
        "Untranslated dynamic fragment",
        "ja",
    );
    assert_eq!(legacy.text, "Untranslated dynamic fragment");
    assert_eq!(legacy.missing_ids, vec!["message.legacy"]);
    checks += 1;
    println!(
        "{}",
        json!({"entity_checks":checks,"result":"pass","scope":"semantic name rendering, Japanese display integration, catalogs and hidden-information guards; no C game or browser"})
    );
}
