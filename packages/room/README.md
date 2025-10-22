# Room

複数人で通信をするアプリケーションを作るための ライブラリ です。
メディアの通信方式を P2P と SFU の 2 種類から選択できます。

# インストール方法

```sh
npm i @skyway-sdk/room
```

# 概要

アプリケーションは通信を開始するまでに以下のフローをたどります。

**1. SkyWay Auth Token を取得（生成）する**

[SkyWay Auth Token について](https://skyway.ntt.com/ja/docs/user-guide/authentication/)

**2. Room を作成する**

メディア通信を行うグループの単位を Room と呼びます。
メディア通信を開始するにはまず Room を作る権限を持った SkyWay Auth Token を用いて Room を作成する必要があります。

**3. RoomMember として Room に Join する**

**4. Stream を Room 内に Publish および Subscribe する**

RoomMember が Stream を Publish すると Room 上に Stream の情報である Publication というリソースが生成されます。

他の RoomMember はこの Publication を Subscribe すると Subscription というリソースが Room 上に生成され、Subscription に対応する Stream を受信し、通信を開始できます。

# 用語解説

Room ライブラリ の用語、仕様について説明します。

## Room

複数の RoomMember が通信するグループの単位です。

それぞれの RoomMember は Room 内にいる他の RoomMember と映像/音声/データの送受信が出来ます。

Room は 一意な識別子である ID と、オプショナルな値である Name を持ちます。

ID は Room 作成時に自動的に払い出される値であり、Name はユーザが Room を作成する際に指定することができる任意の値です。

また、アプリケーション内で重複した Name を指定することはできません。

## RoomMember

RoomMember は他の端末との通信を管理するエージェントです。

映像や音声を送信したり、受信したりすることが出来ます。

RoomMember は 一意な識別子である ID と、オプショナルな値である Name を持ちます。

ID は RoomMember 作成時に自動的に払い出される値であり、Name は RoomMember が Room に Join する際に指定することができる任意の値です。

同一 Room 内に、重複した Name を持つ複数の Member を作成することはできません。

## Stream

Room 内で RoomMember が通信する映像/音声/データを Stream と呼びます。

三種類の Stream が存在します。

- VideoStream
- AudioStream
- DataStream

## Publication

ある RoomMember が用意した Stream を他の RoomMember が受信可能にするために Room 内に公開する操作のことを Publish と呼びます。Stream を Publish すると Room 内に Publication というリソースが生成されます。

他の RoomMember は Publication を Subscribe することで Subscription というリソースを得られて、Stream の受信が開始されます。

Publication を Unpublish すると SkyWay サービス側で関連する Subscription を Unsubscribe して削除します。

## Subscription

ある RoomMember が Room に存在する Publication を Subscribe した時に得られるリソースです。Subscription には Stream が含まれており、Subscribe を実行した RoomMember は映像・音声・データの受信が可能になります。

Room 内の Subscription のプロパティを確認することで、どの RoomMember がどの Publication を Subscribe しているかを把握することができます。

RoomMember が Subscribe していない Subscription の Stream を参照することはできません。RoomMember が Stream を受信するためには必ずその RoomMember が Publication を Subscribe して Subscription を作る必要があります。

Subscription と紐ついている Publication が Unpublish されると Subscription は自動的に Unsubscribe されます。

# 基本機能

- SkyWayContext
- Room
- RoomMember
  - LocalRoomMember
  - RemoteRoomMember
- SkyWayStreamFactory
- RoomPublication
- RoomSubscription

## SkyWayContext

アプリケーションの設定を行います。

```ts
import { SkyWayContext } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);
```

事前に SkyWay Auth Token の取得が必要になります。

### SkyWay Auth Token の取得方法

SkyWay Auth Token は、仕様に基づいて自身で作成するか、`@skyway-sdk/token`ライブラリを使って作成することができます。

`@skyway-sdk/token`ライブラリは Node.js サーバとブラウザで動作しますが、SkyWay Auth Token でユーザの行動を認可したい場合は必ずサーバ側で作成して下さい。

```ts
import { SkyWayAuthToken } from '@skyway-sdk/token';

const token = new SkyWayAuthToken(parameters);
const tokenString = token.encode('secret');
```

### トークンの更新

トークンには Expire が設定されており、期限が切れると SkyWayContext が利用できなくなります。
SkyWayContext はトークンが Expire する前に onTokenUpdateReminder イベントが発火するので、そのタイミングで updateAuthToken メソッドで新しいトークンに更新すると SkyWayContext を続けて利用することができます。

```ts
context.onTokenUpdateReminder.add(() => {
  context.updateAuthToken(tokenString);
});
```

## Room

RoomMember の参加する Room の作成/取得を行います。

### 作成

新しい Room を作成します。

```ts
import { SkyWayContext, SkyWayRoom } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);
const room: Room = await SkyWayRoom.Create(context, {
  name: 'something',
});
```

Room 作成時に、任意の RoomName を指定することができます。

### 取得

既存の Room を取得します。

```ts
import { SkyWayContext, SkyWayRoom } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);

const room: Room = await SkyWayRoom.Find(context, { id: 'roomId' });
// or
const room: Room = await SkyWayRoom.Find(context, { name: 'roomName' });
```

id か name を使って Room を探すことができます。

### 取得もしくは作成

任意の Room の取得を試みて、存在しなければ作成します。

```ts
import { SkyWayContext, SkyWayRoom } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);
const room: Room = await SkyWayRoom.FindOrCreate(context, {
  name: 'roomName',
});
```

### RoomMember の Room への参加

```ts
const member: LocalRoomMember = await room.join({
  name: 'something',
  metadata: 'something',
});
```

Room に参加すると LocalRoomMember インスタンスを取得できます。

追加時に`name`と`metadata`の設定が可能です。(optional)

`name`は Room 内の他の RoomMember と重複することはできません。

一つの Room で join を複数回実行して複数の LocalRoomMember を取得することはできません。

### Room の情報にアクセスする

Room の情報は Room インスタンスのプロパティから取得することができます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/room/interfaces/Room.html

### Room のイベントをリッスンする

Room で発生するイベントは Room インスタンスの on から始まるイベントプロパティで通知されます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/room/interfaces/Room.html

## LocalRoomMember

Stream の Publish、Subscribe などを行うことが出来ます。

### LocalRoomMember の情報にアクセスする

LocalRoomMember の情報は LocalRoomMember インスタンスのプロパティから取得することができます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/room/interfaces/LocalRoomMember.html

### LocalRoomMember のイベントをリッスンする

LocalRoomMember で発生するイベントは LocalRoomMember インスタンスの on から始まるイベントプロパティで通知されます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/room/interfaces/LocalRoomMember.html

### Stream の Publish

Room に Stream を Publish することができます。

```ts
import { SkyWayStreamFactory } from '@skyway-sdk/room';

...

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await member.publish(video, options);
```

Option でメディアの通信方式を P2P と SFU の2種類から選択します。
指定しなかった場合は P2P が選択されます。

#### P2P

```ts
interface Option {
  type?: 'p2p';
  metadata?: string | undefined;
  codecCapabilities?: Codec[];
  encodings?: EncodingParameters[];
}
```

#### SFU

```ts
interface Option {
  type: 'sfu';
  metadata?: string | undefined;
  codecCapabilities?: Codec[];
  encodings?: EncodingParameters[];
  maxSubscribers?: number;
}
```

maxSubscribers では Publish した Stream を Subscribe できる数の上限値を指定できます。指定しない場合、maxSubscribers には 10 がセットされます。
maxSubscribers の最大値は 99 です。

##### サイマルキャスト機能の利用方法

VideoStream を Publish する際に複数のエンコード設定を指定することで、受信側端末が通信品質に合わせて自動的に最適なエンコード設定の映像を受け取る機能を利用できます。

```ts
const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await member.publish(video, {
  type: 'sfu',
  encodings: [
    // 複数のパラメータをセットする
    { maxBitrate: 10_000, scaleResolutionDownBy: 8 },
    { maxBitrate: 680_000, scaleResolutionDownBy: 1 },
  ],
});
```

エンコード設定を行う際に ID を指定することで受信する映像品質の設定を指定できるようになります。

```ts
await member.publish(stream, {
  type: 'sfu',
  encodings: [
    { maxBitrate: 2000_000, id: 'a' },
    { maxBitrate: 10_000, id: 'b' },
  ],
});
```

受信する映像品質設定の指定方法は「Stream の Subscribe」と「Subscription」のセクションに記載されています。

#### コーデックの指定方法

メディア通信の際に優先して利用するコーデックを指定することができます。

**サンプルコード**

```ts
const video = await SkyWayStreamFactory.createCameraVideoStream();
await localMember.publish(video, {
  type: 'p2p',
  codecCapabilities: [{ mimeType: 'video/av1' }, { mimeType: 'video/h264' }],
});

const audio = await SkyWayStreamFactory.createMicrophoneAudioStream();
await localMember.publish(audio, {
  type: 'p2p',
  codecCapabilities: [{ mimeType: 'audio/red' }],
});
```

codecCapabilities 配列の先頭のコーデックを優先して利用します。
端末が先頭のコーデックに対応していない場合は後ろのコーデックを利用します。
どのコーデックにも対応していない場合は端末が対応している他のコーデックを自動的に利用します。

SFU 通信を利用する際にコーデックを指定する場合はアプリケーションがサポートする対象の端末すべてで使えるコーデックを指定する必要があります。

### Stream の Unpublish

Room 上の Stream の Publication を Unpublish することができます。
関連する Subscription が自動的に Unsubscribe されます。

```ts
await member.unpublish(publication.id);
```

### Stream の Subscribe

Room 上の Stream の Publication を Subscribe することができます。

```ts
const { subscription, stream } = await member.subscribe(publication.id);
```

#### subscribe する際に映像品質設定を指定する

※ SFU 通信で Publication がサイマルキャストの設定を行っている場合にこの機能を利用できます。

```ts
await member.subscribe(publication.id, { preferredEncodingId: 'b' });
```

`preferredEncodingId`に受信する映像品質設定の ID を指定することができます。
映像を受信開始した時点で指定された品質の映像が SFU から送信されます。

端末の通信帯域が輻輳を起こしている場合、高い品質の映像設定を指定していても SFU からは輻輳を解消するために低い品質の映像が送信されます。

### Stream の Unsubscribe

Subscribe している Stream の Subscription を Unsubscribe することができます。

```ts
await member.unsubscribe(subscription.id);
```

### Metadata の更新

RoomMember に紐付いた Metadata を更新することができます

```ts
await member.updateMetadata('metadata');
```

## LocalStream と RemoteStream

LocalStream と RemoteStream の２種類の Stream が存在します。

LocalStream は SkyWayStreamFactory で取得でき、Room に Publish することができます。

RemoteStream は Publication を Subscribe することで取得できます。

## LocalStream

### メディア通信の状態取得

LocalStream の通信状態を取得することができます。

```ts
// その時点の状態を取得
const state: TransportConnectionState =
  localStream.getConnectionState(subscriberMember);

// メディア通信の状態が変化した時に発火するイベント
localStream.onConnectionStateChanged.add(({ state, remoteMember }) => {
  // remoteMemberは通信相手のこと
});
```

## RemoteStream

### メディア通信の状態取得

RemoteStream の通信状態を取得することができます。

```ts
// その時点の状態を取得
const state: TransportConnectionState = remoteStream.getConnectionState();

// メディア通信の状態が変化した時に発火するイベント
remoteStream.onConnectionStateChanged.add((state) => {});
```

## SkyWayStreamFactory

各種 Stream の取得が出来ます。

### マイク

```ts
const audio = await SkyWayStreamFactory.createMicrophoneAudioStream(options);
```

### カメラ

```ts
const video = await SkyWayStreamFactory.createCameraVideoStream(options);
```

### DataChannel

※SFU 通信では使用できません。

```ts
const data = await SkyWayStreamFactory.createDataStream();
```

### MediaStreamTrack から AudioStream / VideoStream を作成する

任意の MediaStreamTrack から Stream を作成することが出来ます。

```ts
const displayStream = await navigator.mediaDevices.getDisplayMedia();
const [displayTrack] = displayStream.getVideoTracks();
const stream = new LocalVideoStream(displayTrack);

const [audioTrack] = (
  await navigator.mediaDevices.getUserMedia({ audio: true })
).getTracks();
const stream = new LocalAudioStream(audioTrack);
```

### AudioStream / VideoStream の再生方法

SkyWay の Stream を Html で再生する方法が 2 種類あります。

#### element に適用する

HtmlAudioElement / HtmlVideoElement に Stream を適用することが出来ます。

```ts
const localVideo = document.getElementById(
  'js-local-stream'
) as HTMLVideoElement;
localVideo.muted = true;
localVideo.playsInline = true;

// 適用する
skywayStream.attach(localVideo);

await localVideo.play();
```

#### MediaStream を作る

MediaStream を作成して使うことが出来ます。

```ts
const stream = new MediaStream([
  // MediaStreamTrackにアクセスできる
  skywayStream.track,
]);
```

### DataStream の使い方

※SFU 通信では使用できません。

任意のデータの送受信ができます

**データの送信**

```ts
const data: LocalDataStream = await SkyWayStreamFactory.createDataStream();
data.write('hello');
```

**データの受信**

```ts
const { stream } = await person.subscribe<RemoteDataStream>(publication.id);
stream.onData.add((data) => {
  console.log(data);
});
```

## Publication

Publication の情報の参照と Publication の操作ができます

### Metadata の更新

Publication に紐付いた Metadata を更新することができます

```ts
await publication.updateMetadata('metadata');
```

### Publication 利用の一時停止と再開

Publication に紐ついた映像や音声などの配信の一時停止と再開をすることができます

**一時停止**

```ts
await publication.disable();
```

**利用の再開**

```ts
await publication.enable();
```

## Subscription

Subscription の情報の参照と Subscription の操作ができます

### Stream の参照

Subscription から映像/音声/データの Stream を参照できます。
ローカルで Subscribe している Subscription でなければ undefined となります

```ts
const stream = subscription.stream;
if (stream.contentType === 'data') {
  stream.onData.add((data) => {
    console.log(data);
  });
} else {
  const track = stream.track;
}
```

#### subscribe した映像の映像品質設定を変更する

※ SFU 通信で Publication がサイマルキャストの設定を行っている場合にこの機能を利用できます。

```ts
subscription.changePreferredEncoding(id);
```

Publication を subscribe して subscription を入手し、映像の受信を開始した後に任意のタイミングで受信する映像品質設定を変更することができます。

端末の通信帯域が輻輳を起こしている場合、高い品質の映像設定を指定しても SFU からは低い品質の映像が送信されます。

# Tips

## リモートの RoomMember に Publication を Subscribe させる

Token の members scope を次のように設定することで、リモートの RoomMember に任意の Publication を Subscribe させたり Unsubscribe させることができます。

```ts
const members = [
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
];
```

**サンプルコード**

```ts
//...

const localMember: LocalRoomMember = await room.join({ name: 'alice' });

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await localMember.publish(video, { type: 'p2p' });

const remoteMember = room.members.find((member) => member.name === 'bob');
const remoteSubscription = await remoteMember.subscribe(publication);
```

リモートのメンバーの Subscription の stream を参照することはできません（stream プロパティの中身は常に undefined になります）

## Room 単位でメディアの通信方式を指定する

P2PRoom もしくは SFURoom を使用することであらかじめメディアの通信方式を指定できます。
Create / FindOrCreate / Find の引数の type に 'p2p' を指定することで P2PRoom として、'sfu' を指定することで SFURoom として取得できます。

それぞれの API は Room と共通しています。

**サンプルコード**

```ts
import { SkyWayContext, SkyWayRoom, SkyWayStreamFactory } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);
const p2pRoom: P2PRoom = await SkyWayRoom.FindOrCreate(context, {
  type: 'p2p',
  name: 'roomName',
});

const member: LocalRoomMember = await p2pRoom.join({
  name: 'something',
  metadata: 'something',
});

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await member.publish(video);  // P2P 通信
```

```ts
import { SkyWayContext, SkyWayRoom, SkyWayStreamFactory } from '@skyway-sdk/room';

const context = await SkyWayContext.Create(tokenString);
const sfuRoom: SFURoom = await SkyWayRoom.FindOrCreate(context, {
  type: 'sfu',
  name: 'roomName',
});

const member: LocalRoomMember = await sfuRoom.join({
  name: 'something',
  metadata: 'something',
});

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await member.publish(video);  // SFU 通信
```

なお、P2PRoom における SFU 通信の利用、SFURoom における P2P 通信の利用はできません。