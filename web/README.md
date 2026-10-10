# Webファイルの配信

起動と操作は [作品README](../README.md)、Rust/JS・Worker・Canvasの責務は [実装の判断](../docs/IMPLEMENTATION-ja.md) を参照してください。

本番は `web/`、`build/game.js`、`build/game.wasm`、`build/browser-ui.wasm` と画像等の静的ファイルを配信します。WorkerのSharedArrayBuffer入力に次のHTTPヘッダーが必要です。

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Wasmは `Content-Type: application/wasm` で配信します。LAN接続はHTTPSを使います。URLの `?lang=ja` / `?lang=en`、`?view=ascii` / `?view=tiles` / `?view=pixels` で起動時の言語・地図表示を指定できます。

ローカルの `start.ps1` は作品外の [開発・テスト用サーバー](../../tools/server.mjs) に配信対象を渡します。このサーバー・tests・開発tools・.localは公開対象に含めません。ライセンス通知と [案内](../docs/LICENSES-ja.md) は保持します。
