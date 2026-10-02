# 現在の成果物から検証記録を作る

`tools/record-verification.py` は既存の試験証拠を読み取り、`verification.json` と `artifacts-manifest.json` を更新する。ビルド、ゲーム、ブラウザ試験を実行する機能はない。最終ビルドと各担当の試験が完了してから実行する。

件数は固定値から作らない。C ソース数と成果物一覧は build manifest、ゲーム試験とケース数は game summary、ブラウザ件数は evidence の check 名一覧、保存試験は各 seed の生ログから集計する。保存ログの集計と manifest の数値を照合する。カタログは game・ui-game・runtime・endings・ui-web・entities の EN/JA を読み、各 ID 集合と現在の件数を記録する。

現在のファイル SHA-256 と試験時の SHA-256 が違う場合は停止する。通常ゲームだけでなく fixture・baseline・baseline fixture も照合する。`all_raw_results` の全実行記録を4種類の module に結び付け、日本語ケースの `raw_files` がその全記録にも同じハッシュで含まれることを確認する。取得原本55ファイルと配布アーカイブの固定ハッシュは引き続き保護する。新しく増えた `semantic-c-objects` などの中間生成物を配布 inventory の対象から外す。

ブラウザ証拠の既定は `tests/browser-smoke/output-ja/evidence.json`。別の最終証拠は `--browser-evidence` で明示する。旧英語段階の9件を現在の日本語ブラウザ試験として引き継がない。復元件数は `restore_cases` を使用し、全ケースが入力途中や More の途中だったとは扱わない。

Rust 単体、host、カタログ、翻訳、メッセージ、UTF-8 入力、fmt/clippy などの追加試験は `--supplementary-results` で実行記録を渡す。記録のない試験に以前の成功数を引き継がず、`unrecorded` と表示する。ドキュメント内の過去の数値を現在の成功として読み取らない。

追加記録の形式は次の通り。数値とハッシュは実際の試験後に作り、例の文字列を成功記録として使用しない。

```json
{
  "schema": 1,
  "tests": {
    "localization": {
      "status": "passed",
      "exit_code": 0,
      "passed": 16,
      "failed": 0,
      "skipped": 0,
      "files": [
        {"path": "tests/localization.test.py", "sha256": "実測ハッシュ"},
        {"path": "locales/ja.json", "sha256": "実測ハッシュ"},
        {"path": "build/localization-test.log", "sha256": "実測ハッシュ"}
      ]
    }
  }
}
```

`files` には、実行ログと試験したソースまたは実行物を含める。翻訳試験では対象となった全 EN/JA カタログも含める。記録を作った後に入力ファイルを編集した場合は、再実行して証拠を更新する。成功 exit がない、失敗・skip が残る、入力またはログが存在しない、ハッシュが合わない記録は受け付けない。

`--remaining` は残る範囲を明示して繰り返し指定できる。既定の残件はスマホ／ゲームパッド、永続ランキング、独立 native curses・網羅的互換性検証、公開配備。日本語辞書未完という旧段階の残件は自動で追加しない。

記録 parser の試験は `tests/record-verification.test.py`。この試験は合成した証拠を検査し、ゲームを実行したと主張するものではない。記録生成を依頼された時だけ実成果物を確認して最終 JSON を生成する。
