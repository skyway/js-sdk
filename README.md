# SkyWay JS-SDK

このリポジトリは、2023 年 1 月 31 日にリリースされた SkyWay の JavaScript SDK です。旧 SkyWay の JavaScript SDK とは互換性がありません。

# 本リポジトリの運用方針について

このリポジトリは公開用のミラーリポジトリであり、こちらで開発は行いません。

## Issue / Pull Request

受け付けておりません。

Enterprise プランをご契約のお客様はテクニカルサポートをご利用ください。
詳しくは[SkyWay サポート](https://support.skyway.ntt.com/hc/ja)をご確認ください。

# SDK のインストール方法

ユーザアプリケーションで利用する際は NPM と CDN の2通りのインストール方法があります

## NPM を利用する場合

npm がインストールされている環境下で以下のコマンドを実行します

**Room ライブラリ**

```sh
npm install @skyway-sdk/room
```

**Core ライブラリ**

```sh
npm install @skyway-sdk/core
```

**その他のプラグインやユーティリティライブラリ**

```sh
npm install @skyway-sdk/sfu-bot
npm install @skyway-sdk/token
```

## CDN を利用する場合

以下のスクリプト要素を HTML に追加します

**Room ライブラリ**

```html
<script src="https://cdn.jsdelivr.net/npm/@skyway-sdk/room/dist/skyway_room-latest.js"></script>
```

モジュールはグローバル変数の `skyway_room` に格納されるので以下のようにモジュールを取得することができます。

```js
const { SkyWayContext, SkyWayStreamFactory, SkyWayRoom } = skyway_room;
```

# ドキュメント

## 公式サイト

[https://skyway.ntt.com/ja/docs/user-guide/javascript-sdk/](https://skyway.ntt.com/ja/docs/user-guide/javascript-sdk/)

## API リファレンス

- [Room ライブラリ](https://javascript-sdk.api-reference.skyway.ntt.com/room)
- [Core ライブラリ](https://javascript-sdk.api-reference.skyway.ntt.com/core)
- [SFU Bot ライブラリ](https://javascript-sdk.api-reference.skyway.ntt.com/sfu-bot)
- [Token ライブラリ](https://javascript-sdk.api-reference.skyway.ntt.com/token)

# このリポジトリのセットアップ方法(環境構築)

このリポジトリのサンプルアプリを起動したり、SDK を利用者自身でビルドするために必要な手順。

## 初期設定時

- Node.js をインストールする（バージョンは v20.0.0 以降）
- corepack を有効化するために次のコマンドを実行する
  - `corepack enable pnpm`
- ルートディレクトリで次のコマンドを実行する
  - `pnpm run first`
- `env.ts.template`を`env.ts`にリネームし、ファイル中の appId と secret にダッシュボードで発行した appId と secret を入力する
  - appId と secret の発行方法は[こちら](https://skyway.ntt.com/ja/docs/user-guide/javascript-sdk/quickstart/#199)

## 更新時

git で更新を同期した時や packages ディレクトリ以下のソースコードを編集した際にはルートディレクトリで以下のコマンドを実行する必要がある。

```sh
pnpm run compile
```

# サンプルアプリの起動方法

- examples ディレクトリ以下の任意のサンプルアプリのディレクトリに移動する
- そのディレクトリで以下のコマンドを実行する

  - `npm i`
  - `npm run dev`

- コマンドを実行するとローカルサーバが起動するので Web ブラウザでアクセスする

# SDK のビルド方法

- 環境構築のセクションの作業を実施する
- ルートディレクトリで次のコマンドを実行する
  - `pnpm run build`

# License

- [LICENSE](/LICENSE)
- [THIRD_PARTY_LICENSE](/THIRD_PARTY_LICENSE)
