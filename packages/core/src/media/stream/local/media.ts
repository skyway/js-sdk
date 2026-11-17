import {
  Event,
  EventDisposer,
  type EventInterface,
  Logger,
  PromiseQueue,
} from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import type {
  AudioMediaTrackConstraints,
  DisplayMediaTrackConstraints,
  VideoMediaTrackConstraints,
} from '../../factory';
import { attachElement, detachElement } from '../base';
import { LocalStreamBase, type LocalStreamInterface } from './base';

const logger = new Logger('packages/core/src/media/stream/local/media.ts');

export interface LocalMediaStreamInterface extends LocalStreamInterface {
  /**@description [japanese] PublicationのDisable/EnableなどでStreamのtrackが更新された時に発火するイベント */
  onTrackUpdated: EventInterface<MediaStreamTrack>;
  /**
   * @description [japanese] streamが破棄された時に発火するイベント (例. 画面共有が終了したときなど)
   * @example [japanese] ハンドリング例
   *  const publication = await member.publish(audio);
      audio.onDestroyed.once(async () => {
        await member.unpublish(publication);
      });
   * */
  onDestroyed: EventInterface<void>;

  readonly track: MediaStreamTrack;

  /**
   * @description [english] Attach the stream to the element.
   * @description [japanese] streamをelementに適用する.
   */
  attach(element: HTMLVideoElement | HTMLAudioElement): void;

  /**
   * @description [english] Detach the stream from the element.
   * @description [japanese] elementからstreamを取り除く.
   */
  detach(): void;

  /**
   * @description [japanese] Streamを解放します。
   * カメラやマイクなどのデバイスを解放するためにはそのデバイスに関連するすべてのStreamを解放する必要があります。
   * LocalAudioStream / LocalVideoStreamでは、`stopTrackWhenDisabled: false` でdisabled（mute）の状態のときも、Streamに渡した元のtrackをstopします。
   * trackを使い続けたい場合は`track.clone()`したものをStreamに渡してください。
   */
  release(): void;
}

export abstract class LocalMediaStreamBase extends LocalStreamBase {
  /**@description [japanese] PublicationのDisable/EnableなどでStreamのtrackが更新された時に発火するイベント */
  onTrackUpdated = new Event<MediaStreamTrack>();
  /**
   * @description [japanese] streamが破棄された時に発火するイベント (例. 画面共有が終了したときなど)
   * @example [japanese] ハンドリング例
   *  const publication = await member.publish(audio);
      audio.onDestroyed.once(async () => {
        await member.unpublish(publication);
      });
   * */
  onDestroyed = new Event<void>();
  declare readonly contentType: 'audio' | 'video';
  private _element?: HTMLVideoElement | HTMLAudioElement;
  private _track: MediaStreamTrack;
  private _disposer = new EventDisposer();
  private _released = false;
  /**
   * @internal
   * @description [japanese] LocalAudioStream / LocalVideoStream の _setDeviceStreamEnabled が管理する状態。LocalCustomVideoStreamでは使わない（常にtrue）
   */
  protected _isEnabled = true;
  private _setEnabledQueue = new PromiseQueue();
  private _oldTrack?: MediaStreamTrack;
  private _trackConstraints: MediaTrackConstraints = {};
  /**@internal */
  protected get trackConstraints() {
    return this._trackConstraints;
  }
  /**@internal */
  _replacingTrack = false;
  /**@internal */
  _onReplacingTrackDone = new Event<void>();
  /**@internal */
  _onEnableChanged = new Event<MediaStreamTrack | null>();
  /**@internal */
  protected _options: Partial<LocalMediaStreamOptions>;

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      trackConstraints: this.trackConstraints,
      _options: this._options,
    };
  }

  constructor(
    track: MediaStreamTrack,
    contentType: 'audio' | 'video',
    /**@internal */
    options: (
      | VideoMediaTrackConstraints
      | DisplayMediaTrackConstraints
      | AudioMediaTrackConstraints
    ) &
      Partial<LocalMediaStreamOptions> = {},
  ) {
    super(contentType);
    // 空trackを用意できない環境ではStreamを作らない（disableの時点で失敗してmuteできない状態を作らないため）
    getEmptyTrackSource(contentType);

    this._track = track;
    this._listenTrackEvent();
    this._options = options;

    // iOS safari 15はgetConstraintsがバグってるのでここで入れておく
    this._trackConstraints = { ...options };
  }

  /**@internal */
  abstract setEnabled(b: boolean): Promise<void>;

  get track() {
    return this._track;
  }

  /**
   * @description [english] Attach the stream to the element.
   * @description [japanese] streamをelementに適用する.
   */
  attach(element: HTMLVideoElement | HTMLAudioElement) {
    this._element = element;
    attachElement(element, this._track);
  }

  /**
   * @description [english] Detach the stream from the element.
   * @description [japanese] elementからstreamを取り除く.
   */
  detach() {
    if (this._element) {
      detachElement(this._element, this._track);
      this._element = undefined;
    }
  }

  /**
   * @internal
   * @description [japanese] LocalAudioStream / LocalVideoStream の setEnabled の状態遷移。
   * acquireDeviceTrack は stopTrackWhenDisabled: true でenableするときにデバイスのtrackを取得し直す関数
   */
  protected async _setDeviceStreamEnabled(
    enabled: boolean,
    acquireDeviceTrack: () => Promise<MediaStreamTrack>,
  ) {
    await this._setEnabledQueue.push(async () => {
      // 状態が変わらないとき: 既にdisabledなら、空trackがendedになっていれば作り直す（同じStreamを isEnabled: false で再publishする場合など）
      if (this._isEnabled === enabled) {
        if (!enabled) {
          this._recreateEmptyTrackIfEnded();
        }
        return;
      }

      // mute
      if (!enabled) {
        this._isEnabled = false;
        this._disable();
        logger.debug('stopped', this.toJSON());
        return;
      }

      // unmute
      // release済みのStreamはenableしない（デバイスを取り直さない）
      if (this._released) {
        this._warnEnableAfterRelease();
        return;
      }
      const emptyTrack = this._track;
      if (this._options.stopTrackWhenDisabled) {
        // trackの取得に失敗したときは、disabledのまま（空trackのまま）rejectする（enabledのStreamが空trackを持たないようにする）
        const track = await acquireDeviceTrack();
        // 取得を待っている間にreleaseされたら、取得したtrackを止めてdisabledのままにする
        if (this._released) {
          track.stop();
          this._warnEnableAfterRelease();
          return;
        }
        this._updateTrack(track);
        this._onEnableChanged.emit(track);
      } else {
        this._restoreOldTrack();
      }
      // 空trackはこのStream専用のcloneなので、使わなくなったらstopする
      emptyTrack.stop();
      this._isEnabled = true;
      logger.debug('resumed', this.toJSON());
    });
  }

  private _disable() {
    if (this._options.stopTrackWhenDisabled) {
      this._trackConstraints = {
        ...this.trackConstraints,
        ...this.track.getConstraints(),
      };
      this.track.stop();
    } else {
      this._oldTrack = this.track;
    }

    this._switchToEmptyTrack();
  }

  /**
   * @private
   * @description [japanese] disabledのStreamの空trackがendedになっていたら（アプリが stream.track.stop() した場合など）、新しい空trackに差し替える。
   * 既にdisabledのStreamの setEnabled(false)（isEnabled: false での再publishを含む）と、
   * setEnabled を通らずにtrackを送り始める経路（sfu-botのproduce）から呼ぶ。
   * 同期処理なので_setEnabledQueueの外から呼んでもよい（割り込むのはデバイスの取得を待っているenableだけで、enableが終わればデバイスのtrackで上書きされる）。
   */
  _recreateEmptyTrackIfEnded() {
    // release済みのStreamの空trackはreleaseでstopしたものなので作り直さない
    if (
      this._released ||
      this._isEnabled ||
      this._track.readyState !== 'ended'
    ) {
      return;
    }
    this._switchToEmptyTrack();
  }

  /**
   * @description [japanese] 共有の空trackのcloneに差し替える。
   * 共有の空trackがendedで作り直せなかったときは、muteしたつもりで元のtrackが送られ続けないよう送信を止める
   */
  private _switchToEmptyTrack() {
    let track: MediaStreamTrack;
    try {
      track = createEmptyTrack(this.contentType);
    } catch (error) {
      // このStreamをSFUにpublishするとproduceが track ended で失敗し、次のsetEnabled(false)かstartForwardingまで回復しないのでerrorで出す
      logger.error(
        'failed to recreate the empty track. stop sending instead',
        this.toJSON(),
        error,
      );
      // publish中のsenderにはnullを渡して送信を止め、これからpublishされる場合にも元のtrackが使われないよう、endedの空trackを持たせる
      this._onEnableChanged.emit(null);
      this._updateTrack(createEndedEmptyTrack(this.contentType));
      return;
    }
    track.enabled = false;
    this._onEnableChanged.emit(track);
    this._updateTrack(track);
  }

  // rejectにすると、isEnabled: true でのpublishがサーバ側にPublicationを残したまま失敗するのでwarnにとどめる
  private _warnEnableAfterRelease() {
    logger.warn(
      'the stream has been released. it stays disabled',
      this.toJSON(),
    );
  }

  /**
   * @description [japanese] stopTrackWhenDisabled: false でdisableしたときに退避した元のtrackに戻す
   */
  private _restoreOldTrack() {
    const track = this._oldTrack;
    // _disableで必ず退避し、release済みは手前で抜けるので通常は来ない。
    // 来た場合に続行すると、enabledのStreamが空trackを持ったままになるので、disabledのままrejectする
    if (!track) {
      throw createError({
        operationName: 'LocalMediaStreamBase._restoreOldTrack',
        path: logger.prefix,
        info: { ...errors.internal, detail: 'no track to restore on enable' },
        payload: this.toJSON(),
      });
    }
    // enableで元に戻したので退避中のtrackの参照は消す
    this._oldTrack = undefined;
    this._updateTrack(track);
    this._onEnableChanged.emit(track);
  }

  /**@internal */
  protected _updateTrack(track: MediaStreamTrack) {
    this._track = track;
    if (this._element) {
      this.attach(this._element);
    }
    this.onTrackUpdated.emit(track);
    this._listenTrackEvent();
  }

  private _listenTrackEvent() {
    const onended = () => {
      logger.info('onDestroyed', this.toJSON());
      this.onDestroyed.emit();
    };
    // release時に、登録したtrack（空trackを含む）からリスナーを外す。
    // this._track から外すと、差し替え前のtrackにリスナーが残る
    const track = this._track;
    track.addEventListener('ended', onended);
    this._disposer.push(() => track.removeEventListener('ended', onended));
  }

  /**
   * @description [japanese] Streamを解放します。
   * カメラやマイクなどのデバイスを解放するためにはそのデバイスに関連するすべてのStreamを解放する必要があります。
   * LocalAudioStream / LocalVideoStreamでは、`stopTrackWhenDisabled: false` でdisabled（mute）の状態のときも、Streamに渡した元のtrackをstopします。
   * trackを使い続けたい場合は`track.clone()`したものをStreamに渡してください。
   */
  release() {
    this._released = true;
    this._disposer.dispose();
    // stopTrackWhenDisabled: false でdisableしたときに退避している元のtrack（enable時に参照を消すのでdisabled中だけある）
    this._oldTrack?.stop();
    this._oldTrack = undefined;
    // disabled中はこのStream専用の空track（共有の空trackのclone）なので、stopしても他のStreamに影響しない
    this._track.stop();
  }
}

export type LocalMediaStreamOptions = {
  /**
   * @description [japanese]
   * このStreamのPublicationがDisableされた時にStreamのTrackをStopします。
   * Publicationが再度Enableされた時にデバイスを再取得します（release()したStreamは再取得しません）。
   * (trackプロパティの中身が更新されonTrackUpdatedイベントが発火します)
   * SkyWayStreamFactory経由でLocalMediaを作成する場合はデフォルトで有効。
   * mediaDevice以外から作ったStream（例えばCanvasをキャプチャするなど）であれば必ずFalseを入れてください。
   * LocalAudioStream / LocalVideoStreamでは、Falseの場合も、release()の際にはdisabledかどうかにかかわらずStreamに渡した元のTrackをStopします。
   *  */
  stopTrackWhenDisabled: boolean;
  /**
   * @description [japanese]
   * このStreamがDisplayの映像や音声をキャプチャしたものであれば必ずTrueを入れてください。
   * デフォルトで無効。
   *  */
  isDisplayMedia: boolean;
};

type EmptyTrackSource = {
  // RTCPeerConnectionへの参照を持たないとGCされ、WebKitでは空trackがendedになる（Playwright WebKitのSFU E2Eで再現）。使っていないように見えても消さない
  connection: RTCPeerConnection;
  track: MediaStreamTrack;
};
// 共有の空trackはimport時ではなく最初にStreamを作るときに作る（RTCPeerConnectionがない環境（SSRなど）でimportしても失敗しないようにするため）。
// Streamにはcloneだけを渡すので、SDKやアプリがstopすることはない
const emptyTrackSources: Partial<Record<'audio' | 'video', EmptyTrackSource>> =
  {};

/**
 * @internal
 * @description [japanese] ページ内で共有している空trackを取得する。ブラウザの都合などでendedになっている場合は作り直す
 */
export const getEmptyTrackSource = (
  kind: 'audio' | 'video',
): MediaStreamTrack => {
  const current = emptyTrackSources[kind];
  if (current && current.track.readyState !== 'ended') {
    return current.track;
  }
  if (current) {
    logger.warn('the shared empty track is ended. recreate it', { kind });
    current.connection.close();
  }
  const connection = new RTCPeerConnection();
  const track = connection.addTransceiver(kind).receiver.track;
  emptyTrackSources[kind] = { connection, track };
  return track;
};

/**
 * @internal
 * @description [japanese] disabled状態のStreamが使う、Stream専用の空track（共有の空trackのclone）を作る。
 * cloneをstopしても共有の空trackや他のStreamのcloneはliveのまま
 */
export const createEmptyTrack = (kind: 'audio' | 'video') =>
  getEmptyTrackSource(kind).clone();

/** 共有の空trackを作り直せなかったときに使う、endedの空track（endedの共有の空trackのclone）を作る */
const createEndedEmptyTrack = (kind: 'audio' | 'video') => {
  const track = emptyTrackSources[kind]!.track.clone();
  track.enabled = false;
  return track;
};
