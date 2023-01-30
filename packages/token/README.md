# Token

SkyWay サービスの認証認可に使用する SkyWay Auth Token を生成するユーティリティライブラリです。

# インストール方法

```sh
npm i @skyway-sdk/token
```

# SkyWay Auth Token について

> **❗ 本ページの情報は SkyWay Beta 提供期間中に予告なく変更される可能性があります。**

## 概要

SkyWay Auth Token は、SkyWay を利用するために必要な JWT（JSON Web Token）形式のトークンです。

エンドユーザー毎に権限を細かく設定することでき、例えば `Channel` ごとの入室を特定ユーザーに制限する、といったことができます。

SkyWay Auth Token を利用するためには、これを払い出すアプリケーションサーバーを構築する必要があります。SkyWay SDK を利用したクライアントアプリは、アプリケーションサーバから SkyWay Auth Token を取得し、これを用いて各種 SkyWay の機能を利用します。

なお、サーバを構築せずにフロントエンドで SkyWay Auth Token を生成した場合、シークレットキーをエンドユーザーが取得できるため、誰でも任意の `Channel` や `Room` に入ることができる等のセキュリティ上の問題が発生します。

## SkyWay Auth Token の構造

SkyWay Auth Token は前述の通り JWT 形式を採用しており、ここでは JWT におけるヘッダー・ペイロード・署名について説明します。

### ヘッダー

ヘッダーでは、署名生成に利用するアルゴリズムを記述します。
SkyWay Auth Token では署名に `HS256` のみを許可するため、下記の値となります。

```javascript
{
  "alg" : "HS256",
  "typ" : "JWT"
}
```

### ペイロード

SkyWay Auth Token のペイロードは、各種リソースが入れ子になった階層構造になっています。

ペイロードに記述されたリソース以外への操作はサーバ側で許可されないため、操作が必要なリソースはすべて記述する必要があります。

詳細なペイロードにおける各要素の説明は後述し、ここでは例を示します。

```javascript
{
  jti: "<任意のUUID>",
  exp: 1645369200,
  scope: {
    app: {
      id: "<アプリケーションID>",
      turn: true,
      actions: ["read"],
      channels: [
        {
          id: "*",
          name: "tutorial-room",
          actions: ["write"],
          members: [
            {
              id: "*",
              name: "*",
              actions: ["write"],
              publication: {
                actions: ["write"]
              },
              subscription: {
                actions: ["write"]
              }
            }
          ]
        }
      ]
    }
  }
}
```

### 署名

シークレットキーを利用し、ヘッダとペイロードから `HMAC-SHA256` を用いて生成した署名を利用します。

## SkyWay Auth Token のペイロード詳細

ペイロードの各プロパティを順に説明します。（\*: 必須マーク）

- `jti` \*
  - トークンのユニーク性を担保するための一意な識別子 (`JWT ID`)
  - 形式は UUID v4
  - **生成時に任意の UUID を指定してください**
- `exp` \*
  - トークンの有効期限 (`Expiration Time`)
  - 形式は UNIX 時間（秒）
  - トークンが検証されるタイミングより `+30日未満` の値である必要があります
- `scope` \*
  - `channel` や `member` など SkyWay の各種リソースに対する権限を指定するオブジェクト
  - 以下の通り階層化されている
    - `app`
      - `channel`
        - `member`
          - `publication`
          - `subscription`

以下より、 `scope` 内の各種リソースのパラメータについて説明します。

### `app` リソース

アプリケーションの設定を記載するオブジェクト。

- `id` \*
  - アプリケーション ID を指定（SkyWay にログインして取得した値を記載します）。
- `turn`
  - TURN サーバの利用可否。形式は`boolean`。
    - true にした場合は turn サーバを経由して通信することが可能となり、false の場合は経由しません。
- `actions` \*
  - アプリケーション自体に関する権限。現在は'read'固定。（今後の SkyWay のアップデートにより、取りうる値が増える予定です。）
- `channels` \*
  - channel リソースに関するオブジェクトを配列で指定

### `channel` リソース

当該アプリケーションにおける、`channel` に対する権限を設定するオブジェクト。

Room ライブラリを利用する場合、内部的には `channel` を利用するため、ここで `Room` の `id` または `name` を指定します。

- `id` (`id` または `name` のどちらかが必須 \*)
  - `id` で対象の `channel` を指定
  - `'*'` を指定することで、すべての `channel` を指定
- `name` (`id` または `name` のどちらかが必須 \*)
  - `name` で対象の `channel` を指定
  - `'*'` を指定することで、すべての `channel` を指定
- `actions` \*
  - 以下を複数指定可能
    - `write`: プロパティ (`id`, `name` 等)の閲覧、作成、削除、入室、`metadata` の編集
    - `read`: プロパティの閲覧
    - `create`: 作成
    - `delete`: 削除
    - `updateMetadata`: `metadata` の編集
- `members` \*
  - `member` リソースに関するオブジェクトを配列で指定
- `sfuBots` \*
  - `sfuBot` リソースに関するオブジェクトを配列で指定

### `member` リソース

当該 `channel` における、 `member` に対する権限を設定するオブジェクト。

当該 `member` が WebRTC で他の `member` と通信するためには `signal` または `write` 権限が必要です。

- `id` (`id` または `name` のどちらかが必須 \*)
  - `id` で対象の `member` を指定
  - `'*'` を指定することで、すべての `member` を指定
- `name` (`id` または `name` のどちらかが必須 \*)
  - `name` で対象の `channel` を指定
  - `'*'` を指定することで、すべての `member` を指定
- `actions` \*
  - 以下を複数指定可能
    - `write`: 入室、退室、シグナリング情報のやり取り, `metadata` の編集
    - `create`: 入室（入室時に `member` が作成される）
    - `delete`: 退室（入室時に `member` が削除される）
    - `signal`: シグナリング情報のやり取り
    - `updateMetadata`: `metadata` の編集
- `publication`
  - `publication` リソースに関するオブジェクトを指定
- `subscription`
  - `subscription` リソースに関するオブジェクトを指定

### `publication` リソース

当該 `member` がもつ `publication` に対する権限を設定するオブジェクト。

- `actions` \*
  - 以下を複数指定可能
    - `write`: publish、unpublish
    - `create`: publish（publish 時に `publication` が作成される）
    - `delete`: unpublish（unpublish 時に `publication` が削除される）

### `subscription` リソース

当該 `member` がもつ `subscription` に対する権限を設定するオブジェクト。

- `actions` \*
  - 以下を複数指定可能
    - `write`: subscribe、unsubscribe
    - `create`: subscribe（subscribe 時に `subscription` が作成される）
    - `delete`: unsubscribe（unsubscribe 時に `subscription` が削除される）

### `sfuBot` リソース

当該 `channel` における、`sfuBot` に対する権限を設定するオブジェクト。

- `actions` \*

  - 以下を複数指定可能
    - `write`: 作成、削除
    - `create`: 作成
    - `delete`: 削除

- `forwardings`
  - `forwarding` リソースに関するオブジェクトを指定（forwarding オブジェクトについては後述）

### `forwarding` リソース

当該 `sfuBot` における、`forwarding` に対する権限を設定するオブジェクト。

- `actions` \*
  - 以下を複数指定可能
    - `write`: 作成、削除
    - `create`: 作成 (任意のメディアを SFU 経由で新たに転送することができる)
    - `delete`: 削除 (SFU 経由でのメディア転送を取りやめることができる)

## `channel` / `member` における `name` と `id` について

`channel` と `member` は、 `name` または `id` により、対象リソースを指定できます。

それぞれの特徴を以下に記載します。

- 一意性

  - `id`: SkyWay サーバから自動的に払い出される `id` は一意に定まります。
  - `name`: 当該 `name` を持ったリソースは同時に存在することは出来ませんが、リソース削除後に別のリソースが同じ `name` で作成される可能性があります。

- トークン作成タイミング
  - `id`: `id` は `Channel` 作成時、 `Member` 作成時に自動的に払い出されるため、リソース作成後に、SkyWay Auth Token を生成する必要があります
  - `name`: リソース作成前に払い出したトークンを用いて、リソースを作成することが出来ます。

## ペイロードのリソース設定例

### 例 1

- あらゆる `name` の `Channel` に、あらゆる `name` の `Member` として入室可能
- `SFUBot` の作成や、新たなメディア転送も許可する

```javascript
channels: [
  {
    name: '*',
    actions: ['write'],
    members: [
      {
        name: '*',
        actions: ['write'],
        publication: {
          actions: ['write'],
        },
        subscription: {
          actions: ['write'],
        },
      },
    ],
    sfuBots: [
      {
        actions: ['write'],
        forwardings: {
          actions: ['write'],
        },
      },
    ],
  },
];
```

### 例 2

- "discussion-room"という `name` の `Channel` を作成可能
- 当該 `Channel` に対して、"Alice"または"Bob"という `name` の `Member` として入室可能

```javascript
channels: [
  {
    name: 'discussion-room',
    actions: ['write'],
    members: [
      {
        name: 'Alice',
        actions: ['write'],
        publication: {
          actions: ['write'],
        },
        subscription: {
          actions: ['write'],
        },
      },
      {
        name: 'Bob',
        actions: ['write'],
        publication: {
          actions: ['write'],
        },
        subscription: {
          actions: ['write'],
        },
      },
    ],
  },
];
```

## JavaScript での SkyWay Auth Token の生成について

`@skyway-sdk/token`ライブラリには、SkyWay Auth Token を作成するためのクラスが用意されています。

`SkyWayAuthToken`インスタンスを作成する際に、コンストラクタに JWT のペイロードとなる JSON オブジェクトを渡し、次に当該インスタンスの`encode` メソッドにシークレットキー渡すことで、署名を実施しトークン文字列を作成します。

具体例を以下に示します。

```javascript
import { v4 as uuidV4 } from 'uuid';
const token = new SkyWayAuthToken({
  jti: uuidV4(),
  exp: Math.floor(Date.now() / 1000) + 600,
  scope: {
    app: {
      id: '<アプリケーションID>',
      turn: true,
      actions: ['read'],
      channels: [
        {
          id: '*',
          name: 'tutorial-room',
          actions: ['write'],
          members: [
            {
              id: '*',
              name: '*',
              actions: ['write'],
              publication: {
                actions: ['write'],
              },
              subscription: {
                actions: ['write'],
              },
            },
          ],
          sfuBots: [
            {
              actions: ['write'],
              forwardings: {
                actions: ['write'],
              },
            },
          ],
        },
      ],
    },
  },
});
const tokenString = token.encode('<シークレットキー>');
```
