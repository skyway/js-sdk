# チュートリアル

「クイックスタート」[記事](https://skyway.ntt.com/ja/docs/user-guide/javascript-sdk/quickstart/)のサンプルアプリ

## 起動方法

[こちらを参照](/README.md#サンプルアプリの起動方法)

## 注意

このサンプルは `SkyWayContext.CreateForDevelopment(appId, secret)` を使用しており、`secret` がクライアントコードに含まれます。開発用途で使用してください。

本番環境では、`SkyWayAuthToken` をサーバーサイドで生成し、`SkyWayContext.Create(token)` で初期化してください。
