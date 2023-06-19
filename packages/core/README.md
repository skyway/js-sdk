# Core

SkyWay を使うために必要な基本的な要素（Channel, Member, Stream, ...）を提供する ライブラリ です。
Room SDK でカバーできないような、SkyWay によって提供される機能をより細かに制御し最大限に利用したいユースケースに向いています。

# インストール方法

```sh
npm i @skyway-sdk/core
```

# 概要

クライアントアプリケーションは通信を開始するまでに以下のフローをたどります。

**1. SkyWay Auth Token を取得（生成）する**

[SkyWay Auth Token について](https://skyway.ntt.com/ja/docs/user-guide/authentication/)

**2. Channel を作成する**

メディア通信を行うグループの単位を Channel と呼びます。
メディア通信を開始するにはまず Channel を作る権限を持った SkyWay Auth Token を用いて Channel を作成する必要があります。

**3. クライアントが Channel に Join して Channel の Member となる**

**4. Stream を Channel 内に Publish および Subscribe する**

Member が Stream を Publish すると Channel 上に Stream の情報である Publication というリソースが生成されます。

他の Member はこの Publication を Subscribe すると Subscription というリソースが Channel 上に生成され、Subscription に対応する Stream を受信し、通信を開始できます。

# 用語解説

Core ライブラリ の用語、仕様について説明します。

## Channel

複数の Member が通信するグループの単位です。

それぞれの Member は Channel 内にいる他の Member と映像/音声/データの送受信が出来ます。

Channel は 一意な識別子である ID と、オプショナルな値である Name を持ちます。

ID は Channel 作成時に自動的に払い出される値であり、Name はユーザが Channel を作成する際に指定することができる任意の値です。

また、アプリケーション内で重複した Name を指定することはできません。

## Member

Member は他のクライアントとの通信を管理するエージェントです。

映像や音声を送信したり、受信したりすることが出来ます。

Member は 一意な識別子である ID と、オプショナルな値である Name を持ちます。

ID は Member 作成時に自動的に払い出される値であり、Name はクライアントが Channel に Join する際に指定することができる任意の値です。

Channel 内で重複した Name を指定することはできません。

Member は大きく Person と Bot の 2 種類に分類されます。

**Person**

Person は Core ライブラリ を使って Channel に参加し通信を行う Member です。

**Bot**

Bot は SFU Bot や Recording Bot といった SkyWay サービス側が提供する特殊な Member です。Bot は個別のプラグインパッケージとして提供され、利用できます。

## Stream

Channel 内で Member が通信するメディアのことを Stream と呼びます。

三種類の Stream が存在します。

- VideoStream
- AudioStream
- DataStream

## Publication

あるクライアントが用意した Stream を他の Member が受信可能にするために Channel 内に公開する操作のことを Publish と呼びます。Stream を Publish すると Channel 内に Publication というリソースが生成されます。

他の Member は Publication を Subscribe することで Subscription というリソースを得られて、Stream の受信が開始されます。

Publication を Unpublish すると SkyWay サービス側で関連する Subscription を Unsubscribe して削除します。

## Subscription

あるクライアントが Channel に存在する Publication を Subscribe した時に得られるリソースです。Subscription には Stream が含まれており、メディアの受信が可能です。

Channel 内の Subscription を見ることでどの Member がどの Publication を Subscribe しているかを把握することができます。

クライアントの Member が Subscribe していない Subscription の Stream を参照することはできません。Member が Stream を受信するためには必ずその Member が Publication を Subscribe して Subscription を作る必要があります。

Subscription と紐ついている Publication が Unpublish されると Subscription は自動的に Unsubscribe されます。

## Plugin

SkyWay の Core SDK では SFU や録音録画機能を Bot という形で提供しています。

Plugin はこの Sfu Bot や Recording Bot などの Bot を利用するための仕組みです。

各 Plugin の使い方は各 Plugin のドキュメントに記載されています。

# 基本機能

- SkyWayContext
- SkyWayChannel
- LocalPerson
- SkyWayStreamFactory
- Publication
- Subscription

## SkyWayContext

アプリケーションの設定を行います。

```ts
import { SkyWayContext } from '@skyway-sdk/core';

const context = await SkyWayContext.Create(tokenString);
```

事前にトークンの取得が必要になります。

### トークンの取得方法

SkyWay サービスの JWT トークンはトークンの仕様に基づいて自身で作成するか、`@skyway-sdk/token`ライブラリを使って作成することができます。

`@skyway-sdk/token`ライブラリは Node.js サーバとブラウザで動作しますが、トークンでユーザの行動を制限したい場合は必ずサーバ側でトークンを作成して下さい。

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

## Channel

Member の参加する Channel の作成/取得を行います。

### 作成

新しい Channel を作成します。

```ts
import { SkyWayContext, SkyWayChannel } from '@skyway-sdk/core';

const context = await SkyWayContext.Create(tokenString);
const channel = await SkyWayChannel.Create(context, {
  name: 'something',
  metadata: 'something',
});
```

作成時に`name`と`metadata`の設定が可能です。(optional)
`name`は App 内の他の Channel と重複することはできません。

### 取得

既存の Channel を取得します。

```ts
import { SkyWayContext, SkyWayChannel } from '@skyway-sdk/core';

const context = await SkyWayContext.Create(tokenString);
const channel = await SkyWayChannel.Find(context, {
  id: 'uuid',
  name: 'something',
});
```

id か name を使って Channel を探すことができます。

### 取得もしくは作成

Channel の取得を試み、存在しなければ作成します。

```ts
import { SkyWayContext, SkyWayChannel } from '@skyway-sdk/core';

const context = await SkyWayContext.Create(tokenString);
const channel = await SkyWayChannel.FindOrCreate(context, {
  name: 'channelName',
});
```

### Channel に LocalPerson を追加する

```ts
const person: LocalPerson = await channel.join({
  name: 'something',
  metadata: 'something',
});
```

追加時に`name`と`metadata`の設定が可能です。(optional)

`name`は Channel 内の他の Member と重複することはできません。

一つの channel に同時に複数の LocalPerson を追加することはできません。

### Channel の情報にアクセスする

Channel の情報は Channel インスタンスのプロパティから取得することができます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/core/interfaces/Channel.html

### Channel のイベントをリッスンする

Channel で発生するイベントは Channel インスタンスの on から始まるイベントプロパティで通知されます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/core/interfaces/Channel.html

## LocalPerson

Stream の Publish、Subscribe などを行うことが出来ます。

### LocalPerson の情報にアクセスする

LocalPerson の情報は LocalPerson インスタンスのプロパティから取得することができます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/core/interfaces/LocalPerson.html

### LocalPerson のイベントをリッスンする

LocalPerson で発生するイベントは LocalPerson インスタンスの on から始まるイベントプロパティで通知されます。

詳しくは API リファレンスを参照してください。
https://javascript-sdk.api-reference.skyway.ntt.com/core/interfaces/LocalPerson.html

### Stream の Publish

Channel に Stream を Publish することができます。

```ts
import { SkyWayStreamFactory } from '@skyway-sdk/core';

...

const person: LocalPerson = await channel.join();

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await person.publish(video,options);
```

以下のオプションが指定可能です。

```ts
interface Option {
  metadata?: string | undefined;
  codecCapabilities?: Codec[];
  encodings?: EncodingParameters[];
}
```

#### コーデックの指定方法

メディア通信の際に優先して利用するコーデックを指定することができます。

**サンプルコード**

```ts
const video = await SkyWayStreamFactory.createCameraVideoStream();
await person.publish(video, {
  codecCapabilities: [{ mimeType: 'video/av1' }, { mimeType: 'video/h264' }],
});

const audio = await SkyWayStreamFactory.createMicrophoneAudioStream();
await person.publish(audio, {
  codecCapabilities: [{ mimeType: 'audio/red' }],
});
```

codecCapabilities 配列の先頭のコーデックを優先して利用します。
デバイスが先頭のコーデックに対応していない場合は後ろのコーデックを利用します。
どのコーデックにも対応していない場合はデバイスが対応している他のコーデックを自動的に利用します。

SFU-Bot を利用する際にコーデックを指定する場合はアプリケーションがサポートする対象のデバイスすべてで使えるコーデックを指定する必要があります。

### Stream の Unpublish

Channel 上の Stream の Publication を Unpublish することができます。
関連する Subscription が自動的に Unsubscribe されます。

```ts
await person.unpublish(publication.id);
```

### Stream の Subscribe

Channel 上の Stream の Publication を Subscribe することができます。

```ts
const { subscription, stream } = await person.subscribe(publication.id);
```

### Stream の Unsubscribe

Subscribe している Stream の Subscription を Unsubscribe することができます。

```ts
await person.unsubscribe(subscription.id);
```

### Metadata の更新

Member に紐付いた Metadata を更新することができます

```ts
await person.updateMetadata('metadata');
```

## LocalStream と RemoteStream

LocalStream と RemoteStream の２種類の Stream が存在します。

LocalStream は SkyWayStreamFactory で取得でき、Channel に Publish することができます。

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

**マイク**

```ts
const audio: LocalAudioStream =
  await SkyWayStreamFactory.createMicrophoneAudioStream(options);
```

**カメラ**

```ts
const video: LocalVideoStream =
  await SkyWayStreamFactory.createCameraVideoStream(options);
```

**DataChannel**

```ts
const data: LocalDataStream = await SkyWayStreamFactory.createDataStream();
```

### MediaStreamTrack から AudioStream / VideoStream を作成する

任意の MediaStreamTrack から Stream を作成することが出来ます。

```ts
const displayStream = await navigator.mediaDevices.getDisplayMedia();
const [displayTrack] = displayStream.getVideoTracks();
const stream = new LocalVideoStream('label', displayTrack);

const [audioTrack] = (
  await navigator.mediaDevices.getUserMedia({ audio: true })
).getTracks();
const stream = new LocalAudioStream('label', audioTrack);
```

### AudioStream / VideoStream の再生方法

SkyWay の Stream を Html で再生する方法が 2 種類あります。

**element に適用する**

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

**MediaStream を作る**

MediaStream を作成して使うことが出来ます。

```ts
const stream = new MediaStream([
  // MediaStreamTrackにアクセスできる
  skywayStream.track,
]);
```

### DataStream の使い方

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

# Tips

## リモートの Member に Publication を Subscribe させる

Token の members scope を次のように設定することで、リモートの Member に任意の Publication を Subscribe させたり Unsubscribe させることができます。

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

const person: LocalPerson = await channel.join({ name: 'alice' });

const video = await SkyWayStreamFactory.createCameraVideoStream();
const publication = await localPerson.publish(video);

const remoteMember = channel.members.find((member) => member.name === 'bob');
const remoteSubscription = await remoteMember.subscribe(publication);
```

リモートのメンバーの Subscription の stream を参照することはできません（stream プロパティの中身は常に undefined になります）
