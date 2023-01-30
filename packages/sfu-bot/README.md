# SFU Client

SkyWay Core ライブラリ で SFU Bot を利用するためのライブラリです。

**本ページを読む場合、事前に Core ライブラリの README を読むことをおすすめします。**

# インストール方法

```sh
npm i @skyway-sdk/sfu-bot
```

# SFU Bot の仕組み

P2P Channel では、各 Person が通信相手すべてに対して映像/音声/データの配信を行います。そのため、 Person の数が多い場合、上りトラフィックの量と、クライアントの音声/映像エンコードにかかる処理負荷が大きくなります。

SFU Bot は、 各 Person から一本の上りトラフィックを受信し、他の Person に対して配信します。これにより、クライアントの負荷は軽減し、大規模な双方向通信が可能となります。

# 利用方法

## プラグインの登録

Core ライブラリ にて SFU 機能を有効化するため、Plugin を Core ライブラリ に登録します。

```ts
import { SkyWayContext } from '@skyway-sdk/core';
import { SfuBotPlugin } from '@skyway-sdk/sfu-bot';

const context = await SkyWayContext.Create(tokenString);
const plugin = new SfuBotPlugin();
context.registerPlugin(plugin);
```

## SFU Bot の呼び出し

Channel で SFU Bot を利用するため、対象の Channel 内に SFU Bot を作成します。

```ts
const context = await SkyWayContext.Create(tokenString);
const plugin = new SfuBotPlugin();
context.registerPlugin(plugin);

const channel = await Channel.FindOrCreate(context);
// SFU BotをChannel内に作成する。
const bot = await plugin.createBot(channel);
```

## Publication の Forwarding

SFU Bot に Channel 上の Publication を Forwarding させます。

これにより、SFU Bot は、 Person から一本の上りトラフィックを受信し、他の Person に対してそれを配信します。

```ts
const person = await channel.join();

const stream = await MediaDevices.createCameraVideoStream();
const publication = await person.publish(stream);

// personのpublicationをSFU BotにForwardingさせる
const forwarding = await bot.startForwarding(publication, {
  maxSubscribers: 99,
});
```

Person は、 SFU Bot が Forwarding している Publication を Subscribe することで、SFU 経由で Stream を受け取ることができます。

maxSubscribers では Forwarding している Publication を Subscribe できる数の上限値を指定できます。指定しない場合、maxSubscribers には 10 がセットされます。maxSubscribers の最大値は 99 です。

## SFU Bot が配信している Publication の識別方法

SFU Bot を利用する場合、Channel 上には Person が Publish した Publication と SFU Bot がその Publication を Forwarding している Publication の 2 種類の Publication が存在します。

SFU Bot 経由で配信されている Publication を識別するには、Publication の Publisher の SubType を確認することで識別できます。

```ts
channel.onStreamPublished.add(({ publication }) => {
  if (publication.publisher.subtype === 'sfu') {
    console.log('published by SFU');
    person.subscribe(publication.id);
  }
});
```

## Simulcast 機能の利用方法

VideoStream を Publish する際に複数のエンコード設定を指定することで、受信側クライアントデバイスが通信品質に合わせて自動的に最適なエンコード設定の映像を受け取る機能を利用できます。

```ts
const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await person.publish(video, {
  encodings: [
    // 複数のパラメータをセットする
    { maxBitrate: 10_000, scaleResolutionDownBy: 8 },
    { maxBitrate: 680_000, scaleResolutionDownBy: 1 },
  ],
});

const forwarding = await bot.startForwarding(publication);
```

### 受信する映像の品質を指定する

エンコード設定を行う際に ID を指定することで受信する映像品質の設定を指定できるようになります。

```ts
await localPerson.publish(stream, {
  encodings: [
    { maxBitrate: 2000_000, id: 'a' },
    { maxBitrate: 10_000, id: 'b' },
  ],
});
```

映像品質設定の選択方法は次の 2 種類が用意されています。

#### subscribe する際に映像品質設定を指定する

```ts
await localPerson.subscribe(publication.id, { preferredEncodingId: 'b' });
```

`preferredEncodingId`に受信する映像品質設定の ID を指定することができます。
映像を受信開始した時点で指定された品質の映像が SFU から送信されます。

クライアント端末の通信帯域が輻輳を起こしている場合、高い品質の映像設定を指定していても SFU からは輻輳を解消するために低い品質の映像が送信されます。

#### subscribe した映像の映像品質設定を変更する

```ts
subscription.changePreferredEncoding(id);
```

Publication を subscribe して subscription を入手し、映像の受信を開始した後に任意のタイミングで受信する映像品質設定を変更することができます。

クライアント端末の通信帯域が輻輳を起こしている場合、高い品質の映像設定を指定しても SFU からは低い品質の映像が送信されます。
