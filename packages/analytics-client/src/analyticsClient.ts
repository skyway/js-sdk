import {
  BindingRtcPeerConnectionToSubscriptionClientEvent,
  ClientEvent,
  MediaDeviceReportClientEvent,
  PublicationUpdateEncodingsReportClientEvent,
  RtcPeerConnectionEventReportClientEvent,
  SubscriptionStats,
  SubscriptionStatsReportClientEvent,
  SubscriptionUpdatePreferredEncodingReportClientEvent,
} from './clientEvent';
import { AcknowledgePayload, isAcknowledgePayload } from './payloadTypes';
import { ConnectionState, ServerEvent, Socket } from './socket';
import { BackOff } from './utils/backoff';
import { Event } from './utils/event';
import { Logger } from './utils/logger';

const ANALYTICS_LOGGING_SERVER_DOMAIN = 'analytics-logging.skyway.ntt.com';
const API_VERSION = 'v1';
const TIMEOUT_SEC = 5;

type AnalyticsClientParams = {
  token: string;
  channelId: string;
  channelName?: string;
  memberId: string;
  memberName?: string;
  sdkVersion: string;
};

type AnalyticsClientOptions = {
  analyticsLoggingServerDomain?: string;
  secure?: boolean;
  logger?: Logger;
};

type AnalyticsClientInternalOptions = Required<AnalyticsClientOptions>;
type MediaDeviceReport = MediaDeviceReportClientEvent['payload'];
type BindingRtcPeerConnectionToSubscription = BindingRtcPeerConnectionToSubscriptionClientEvent['payload'];
type SubscriptionStatsReport = SubscriptionStatsReportClientEvent['payload'];
type RtcPeerConnectionEventReport = RtcPeerConnectionEventReportClientEvent['payload'];
type PublicationUpdateEncodingsReport = PublicationUpdateEncodingsReportClientEvent['payload'];
type SubscriptionUpdatePreferredEncodingReport = SubscriptionUpdatePreferredEncodingReportClientEvent['payload'];

export class AnalyticsClient {
  private readonly _options: AnalyticsClientInternalOptions;

  private readonly _logger: Logger;

  private _socket: Socket | undefined;

  readonly onConnectionStateChanged = new Event<ConnectionState>();

  readonly onConnectionFailed = new Event<void>();

  private _token: string;

  private _newToken: string | undefined;

  private readonly _channelId: string;

  private readonly _channelName?: string;

  private readonly _memberId: string;

  private readonly _memberName?: string;

  private readonly _sdkVersion: string;

  private _isClosed = false;

  private _responseCallbacks: Map<string, (data: Record<string, unknown>) => void> = new Map();

  private _acknowledgeCallbacks: Map<string, (data: AcknowledgePayload) => void> = new Map();

  private _mediaDeviceVersion: Map<string, number> = new Map();

  private _encodingsVersion: Map<string, number> = new Map();

  private _preferredEncodingVersion: Map<string, number> = new Map();

  private _previousSubscriptionStats: Map<string, { stats: RTCStatsReport; createdAt: number }> = new Map();

  private _statsRequest: {
    intervalSec: number;
    types: {
      type: string;
      properties: {
        [property: string]: {
          normalization: boolean;
          outputKey: string;
        };
      };
    }[];
  } = {
    // connect()時のopenServerEventPayload.statsRequest代入でそれぞれ値が入るが，一度初期値として定義しておく
    intervalSec: 5,
    types: [],
  };

  constructor(
    { token, channelId, channelName, memberId, memberName, sdkVersion }: AnalyticsClientParams,
    options?: AnalyticsClientOptions
  ) {
    this._token = token;
    this._newToken = undefined;
    this._channelId = channelId;
    this._channelName = channelName;
    this._memberId = memberId;
    this._memberName = memberName;
    this._sdkVersion = sdkVersion;

    const defaultOptions: AnalyticsClientInternalOptions = {
      analyticsLoggingServerDomain: ANALYTICS_LOGGING_SERVER_DOMAIN,
      secure: true,
      logger: {
        debug: (message, ...optionalParams) => {
          console.debug(message, ...optionalParams);
        },
        warn: (message, ...optionalParams) => {
          console.warn(message, ...optionalParams);
        },
        error: (error) => {
          console.error(error);
        },
      },
    };
    this._options = Object.assign({}, defaultOptions, options ?? {});

    this._logger = this._options.logger;
    this._logger.debug(`Created instance with the options: ${this._options}`);
  }

  get connectionState(): ConnectionState {
    return this._socket?.connectionState ?? 'closed';
  }

  async connect(): Promise<void> {
    const WSProtocol = this._options.secure ? 'wss' : 'ws';

    const analyticsLoggingServerDomain = this._options.analyticsLoggingServerDomain || ANALYTICS_LOGGING_SERVER_DOMAIN;

    this._socket = new Socket({
      sessionEndpoint: `${WSProtocol}://${analyticsLoggingServerDomain}/${API_VERSION}/client/ws`,
      channelId: this._channelId,
      channelName: this._channelName,
      memberId: this._memberId,
      memberName: this._memberName,
      token: this._token,
      logger: this._logger,
      sdkVersion: this._sdkVersion,
    });

    this._socket.onEventReceived.addListener((data: ServerEvent) => {
      try {
        this._eventReceivedHandler(data);
      } catch (error) {
        this._logger.error('in _eventReceivedHandler', error as Error);
      }
    });

    this._socket.onConnectionFailed.addListener(() => {
      this.onConnectionFailed.emit();
      this._cleanupAnalyticsClientMaps();
    });

    this._socket.onConnectionStateChanged.addListener((state) => {
      if (state === 'closed' && !this.isClosed() && this._socket?.isClosed()) {
        this._isClosed = true;
        this.dispose();
      }
      this.onConnectionStateChanged.emit(state);
    });

    this._socket.onTokenExpired.addListener(() => {
      void this._reconnectWithNewSkyWayAuthToken();
    });

    const openServerEventPayload = await this._socket.onOpened.asPromise();
    if (openServerEventPayload !== undefined) {
      this._statsRequest = openServerEventPayload.statsRequest;
      return;
    } else {
      this._logger.error('First time connection payload is undefined', new Error());
      this.onConnectionFailed.emit();
      return;
    }
  }

  dispose(): void {
    this._disconnect();
    this._cleanupAnalyticsClientMaps();
  }

  setNewSkyWayAuthToken(token: string): void {
    if (this._socket !== undefined) {
      this._newToken = token;
      this._logger.debug('setNewSkyWayAuthToken is success');
    }
  }

  cleanupOnUnpublished(publicationId: string): void {
    this._mediaDeviceVersion.delete(publicationId);
    this._encodingsVersion.delete(publicationId);
  }

  cleanupOnUnsubscribed(subscriptionId: string): void {
    this._preferredEncodingVersion.delete(subscriptionId);
    this._previousSubscriptionStats.delete(subscriptionId);
  }

  private _disconnect(): void {
    this._socket?.destroy();
    this._socket = undefined;

    this._responseCallbacks.clear();
    this._acknowledgeCallbacks.clear();
  }

  async sendMediaDeviceReport(report: Omit<MediaDeviceReport, 'mediaDeviceVersion'>): Promise<void> {
    let currentMediaDeviceVersion = this._mediaDeviceVersion.get(report.publicationId);
    if (currentMediaDeviceVersion === undefined) {
      currentMediaDeviceVersion = 0;
    } else {
      currentMediaDeviceVersion++;
    }
    this._mediaDeviceVersion.set(report.publicationId, currentMediaDeviceVersion);
    const payload: MediaDeviceReport = {
      publicationId: report.publicationId,
      mediaDeviceName: report.mediaDeviceName,
      mediaDeviceVersion: currentMediaDeviceVersion,
      mediaDeviceTrigger: report.mediaDeviceTrigger,
      updatedAt: report.updatedAt,
    };

    const clientEvent = new ClientEvent('MediaDeviceReport', payload);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendMediaDeviceReport is failed', err);
    });
  }

  async sendBindingRtcPeerConnectionToSubscription(bindingData: BindingRtcPeerConnectionToSubscription): Promise<void> {
    const clientEvent = new ClientEvent('BindingRtcPeerConnectionToSubscription', bindingData);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendBindingRtcPeerConnectionToSubscription is failed', err);
    });
  }

  private _isDataChannelStatsReport(report: RTCStatsReport): boolean {
    const castedStatsReport: SubscriptionStats = {};
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore RTCStatsReportの型エラー回避(TS2339: Property 'values' does not exist on type 'RTCStatsReport'.)
    for (const rtcStatsReportValue of report.values()) {
      castedStatsReport[rtcStatsReportValue.type] = rtcStatsReportValue;
    }

    if (castedStatsReport && 'data-channel' in castedStatsReport) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * DataChannelのstatsReportのobjectを処理する際の判定用関数
   * 'data-channel', 'local-candidate', 'candidate-pair' が現在対象
   * 'candidate-pair' の場合は nominated:true のもののみをtrueとする
   */
  private _isTargetTypeOfStatsReport(report: any, targetType: string[]): boolean {
    if (!report) return false;
    for (const type of targetType) {
      if (report.type === type) {
        if (type === 'data-channel' || type === 'local-candidate') {
          return true;
        } else if (type === 'candidate-pair') {
          // 'candidate-pair' の場合は nominated:true のものであるかを確認
          if ('nominated' in report && report.nominated === true) {
            return true;
          }
        }
      }
    }
    // すべてのtypeに一致しない場合や条件に当てはまらない場合はfalse
    return false;
  }

  async sendSubscriptionStatsReport(
    report: RTCStatsReport,
    subscriptionParams: Omit<SubscriptionStatsReport, 'stats'>
  ): Promise<void> {
    const previousSubscriptionStat = this._previousSubscriptionStats.get(subscriptionParams.subscriptionId);
    this._previousSubscriptionStats.set(subscriptionParams.subscriptionId, {
      stats: report,
      createdAt: subscriptionParams.createdAt,
    });

    if (previousSubscriptionStat === undefined) {
      // 初回の場合は時間あたりの値が出せないので送信しない
      return;
    }

    const previousCreatedAt = previousSubscriptionStat.createdAt;
    const duration = (subscriptionParams.createdAt - previousCreatedAt) / 1000; // mills to sec.
    if (duration <= 0) {
      throw new Error('duration must be greater than 0. also sendSubscriptionStatsReport was duplicated.');
    }

    const isDataChannelStatsReport = this._isDataChannelStatsReport(report);

    const filteredStats: SubscriptionStats = {};
    for (const statsRequestType of this._statsRequest.types) {
      Object.keys(statsRequestType.properties).forEach((key) => {
        const isNeedNormalization = statsRequestType.properties[key].normalization;
        const outputKey = statsRequestType.properties[key].outputKey;

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore RTCStatsReportの型エラー回避(TS2339: Property 'values' does not exist on type 'RTCStatsReport'.)
        for (const rtcStatsReportValue of report.values()) {
          if (rtcStatsReportValue.type !== statsRequestType.type) continue;
          Object.keys(rtcStatsReportValue).forEach((statName) => {
            if (statName === key) {
              // 時折プロパティがない場合があるため，今回分のデータをチェックしておく
              if (!rtcStatsReportValue || !(statName in rtcStatsReportValue)) {
                this._logger.warn(`statsReport key:${statName} in current statsReport is undefined`);
                return;
              }
              if (isNeedNormalization) {
                // 前回分のデータを使って時間あたりの値を計算する必要があるフィールドについてはこちらで処理
                /**
                 * idは接続が続いている間同じ値を取るので,前回保持したstatsから値を取り出す際に利用する
                 * https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport#common_instance_properties
                 */

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore RTCStatsReportの型エラー回避(TS2339: Property 'get' does not exist on type 'RTCStatsReport')
                const previousObject = previousSubscriptionStat.stats.get(rtcStatsReportValue.id);

                // 時折プロパティがない場合があるため，前回分のデータをチェックしておく
                if (!previousObject || !(key in previousObject)) {
                  this._logger.warn(`statsReport key:${key} in previous statsReport is undefined`);
                  return;
                }
                const previousValue = Number(previousObject[key]);
                const perSecondValue = (Number(rtcStatsReportValue[statName]) - previousValue) / duration;

                if (isDataChannelStatsReport) {
                  // 'data-channel'の場合はbytesSent/bytesReceivedの両方とも格納されてしまうのでroleによって切り替える
                  if (this._isTargetTypeOfStatsReport(rtcStatsReportValue, ['data-channel'])) {
                    if (subscriptionParams.role === 'sender') {
                      if (statName === 'bytesSent') {
                        filteredStats[statsRequestType.type] = {
                          ...filteredStats[statsRequestType.type],
                          [outputKey]: String(perSecondValue),
                        };
                      }
                    } else {
                      if (statName === 'bytesReceived') {
                        filteredStats[statsRequestType.type] = {
                          ...filteredStats[statsRequestType.type],
                          [outputKey]: String(perSecondValue),
                        };
                      }
                    }
                  } else if (
                    this._isTargetTypeOfStatsReport(rtcStatsReportValue, ['local-candidate', 'candidate-pair'])
                  ) {
                    filteredStats[statsRequestType.type] = {
                      ...filteredStats[statsRequestType.type],
                      [outputKey]: String(perSecondValue),
                    };
                  }
                } else {
                  /**
                   * this._statsRequest で保持している変換用のobjectは同一のkeyが複数回出てくるので，上書きしないためにスプレッド構文を利用する．
                   * またServer側で受け付けているstatsの値はstringなので変換してやる必要あり．
                   */
                  filteredStats[statsRequestType.type] = {
                    ...filteredStats[statsRequestType.type],
                    [outputKey]: String(perSecondValue),
                  };
                }
              } else {
                // 時間あたりの値を計算する必要がないフィールドはこちらで処理
                if (isDataChannelStatsReport) {
                  if (
                    this._isTargetTypeOfStatsReport(rtcStatsReportValue, [
                      'data-channel',
                      'local-candidate',
                      'candidate-pair',
                    ])
                  ) {
                    if (rtcStatsReportValue.type === 'candidate-pair') {
                      // 'candidate-pair'はvideo/audioがある場合，他のフィールド:availableOutgoingBitrateも入ってきてしまうため必要なものに限定する
                      if (statName === 'currentRoundTripTime') {
                        filteredStats[statsRequestType.type] = {
                          ...filteredStats[statsRequestType.type],
                          [outputKey]: String(rtcStatsReportValue[statName]),
                        };
                      }
                    } else {
                      filteredStats[statsRequestType.type] = {
                        ...filteredStats[statsRequestType.type],
                        [outputKey]: String(rtcStatsReportValue[statName]),
                      };
                    }
                  }
                } else {
                  filteredStats[statsRequestType.type] = {
                    ...filteredStats[statsRequestType.type],
                    [outputKey]: String(rtcStatsReportValue[statName]),
                  };
                }
              }
            }
          });
        }
      });
    }

    const payload: SubscriptionStatsReport = {
      subscriptionId: subscriptionParams.subscriptionId,
      stats: filteredStats,
      role: subscriptionParams.role,
      createdAt: subscriptionParams.createdAt,
    };
    const clientEvent = new ClientEvent('SubscriptionStatsReport', payload);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendSubscriptionStatsReport is failed', err);
    });
  }

  async sendRtcPeerConnectionEventReport(report: RtcPeerConnectionEventReport): Promise<void> {
    const clientEvent = new ClientEvent('RtcPeerConnectionEventReport', report);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendRtcPeerConnectionEventReport is failed', err);
    });
  }

  async sendPublicationUpdateEncodingsReport(
    report: Omit<PublicationUpdateEncodingsReport, 'encodingsVersion'>
  ): Promise<void> {
    let currentEncodingsVersion = this._encodingsVersion.get(report.publicationId);
    if (currentEncodingsVersion === undefined) {
      currentEncodingsVersion = 0;
    } else {
      currentEncodingsVersion++;
    }
    this._encodingsVersion.set(report.publicationId, currentEncodingsVersion);
    const payload: PublicationUpdateEncodingsReport = {
      publicationId: report.publicationId,
      encodings: report.encodings,
      encodingsVersion: currentEncodingsVersion,
      updatedAt: report.updatedAt,
    };

    const clientEvent = new ClientEvent('PublicationUpdateEncodingsReport', payload);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendPublicationUpdateEncodingsReport is failed', err);
    });
  }

  async sendSubscriptionUpdatePreferredEncodingReport(
    report: Omit<SubscriptionUpdatePreferredEncodingReport, 'preferredEncodingVersion'>
  ): Promise<void> {
    let currentPreferredEncodingVersion = this._preferredEncodingVersion.get(report.subscriptionId);
    if (currentPreferredEncodingVersion === undefined) {
      currentPreferredEncodingVersion = 0;
    } else {
      currentPreferredEncodingVersion++;
    }
    this._preferredEncodingVersion.set(report.subscriptionId, currentPreferredEncodingVersion);
    const payload: SubscriptionUpdatePreferredEncodingReport = {
      subscriptionId: report.subscriptionId,
      preferredEncodingIndex: report.preferredEncodingIndex,
      preferredEncodingVersion: currentPreferredEncodingVersion,
      updatedAt: report.updatedAt,
    };

    const clientEvent = new ClientEvent('SubscriptionUpdatePreferredEncodingReport', payload);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendSubscriptionUpdatePreferredEncodingReport is failed', err);
    });
  }

  private async _sendClientEvent(clientEvent: ClientEvent): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this._socket === undefined || this._socket.connectionState === 'closed') {
        reject(new Error('websocket is not connected'));
        return;
      }

      // 初回の接続に時間がかかっている場合はここで再送用のキューとacknowledgeのリストに入れる
      if (this._socket.connectionState === 'connecting') {
        this._socket.pushResendClientEventsQueue(clientEvent);
        this._setAcknowledgeCallback(clientEvent.id, async (data: AcknowledgePayload) => {
          if (data.ok) {
            this._acknowledgeCallbacks.delete(clientEvent.id);
            resolve();
          } else {
            this._acknowledgeCallbacks.delete(clientEvent.id);
            reject(data);
          }
        });
        this._logger.debug(`pushResendClientEventsQueue and setAcknowledgeCallback. clientEvent.id: ${clientEvent.id}`);
        reject(new Error('websocket is connecting now'));
        return;
      }

      const backoff = new BackOff({ times: 6, interval: 500, jitter: 100 });
      for (; !backoff.exceeded; ) {
        const timer = setTimeout(async () => {
          if (this._socket === undefined) {
            this._acknowledgeCallbacks.delete(clientEvent.id);
            reject(new Error('Socket closed when trying to resend'));
            return;
          } else {
            this._socket.resendAfterReconnect(clientEvent);
          }
          reject(new Error('Timeout to send data'));
          return;
        }, TIMEOUT_SEC * 1000);

        // 送信に失敗した際の再送ロジックはsend()内で処理される
        this._logger.debug(`send clientEvent, ${JSON.stringify(clientEvent)}`);
        this._socket.send(clientEvent).catch((err) => {
          this._acknowledgeCallbacks.delete(clientEvent.id);
          clearTimeout(timer);
          reject(err);
          return;
        });

        /**
         * _waitForAcknowledgeはresultに次の2種類の値を返す
         * 1. undefined: 送信が成功し、undefinedでresolveされた場合
         * 2. AcknowledgePayload型の値:送信は成功したがサーバーから ok: false のacknowledgeが返されたため、acknowledge payloadでrejectされた場合
         * 何らかのエラーによってrejectされた場合:
         * これは_messageHandlerで弾かれるので考慮しなくて良い．
         */
        const result = await this._waitForAcknowledge(clientEvent.id).catch((err) => {
          return err;
        });
        clearTimeout(timer);

        if (isAcknowledgePayload(result)) {
          if (result.reason === 'unexpected') {
            await backoff.wait();
          } else {
            reject(result);
            return;
          }
        } else {
          resolve();
          return;
        }
      }

      reject(new Error('unexpected has occurred at server'));
      return;
    });
  }

  private async _waitForAcknowledge(clientEventId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._setAcknowledgeCallback(clientEventId, async (data: AcknowledgePayload) => {
        if (data.ok) {
          this._acknowledgeCallbacks.delete(clientEventId);
          resolve();
        } else {
          this._acknowledgeCallbacks.delete(clientEventId);
          reject(data);
        }
      });
    });
  }

  private async _reconnectWithNewSkyWayAuthToken(): Promise<void> {
    this._disconnect();

    if (this._newToken !== undefined) {
      this._token = this._newToken;
      this._newToken = undefined;

      await this.connect();
    } else {
      this._logger.warn('new token is not set. so not reconnect.');
    }
  }

  private _eventReceivedHandler(data: ServerEvent) {
    switch (data.type) {
      case 'Acknowledge':
        this._acknowledgeHandler(data.payload);
        break;
      case 'Open':
        break; // nop
      default: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _: never = data.type;
        this._logger.warn(`Unknown event: ${data.type}`);
      }
    }
  }

  private _acknowledgeHandler(payload: unknown) {
    if (!isAcknowledgePayload(payload)) {
      throw new Error('Invalid payload');
    }

    const { eventId } = payload;
    if (!this._acknowledgeCallbacks.has(eventId)) {
      throw new Error(`acknowledge event has unknown eventId: ${eventId}`);
    }
    const callback = this._acknowledgeCallbacks.get(eventId);
    if (callback) {
      this._acknowledgeCallbacks.delete(eventId);
      callback(payload);
    }
  }

  private _setAcknowledgeCallback(eventId: string, callback: (data: AcknowledgePayload) => Promise<void>) {
    this._acknowledgeCallbacks.set(eventId, callback);
  }

  private _cleanupAnalyticsClientMaps(): void {
    this._mediaDeviceVersion.clear();
    this._encodingsVersion.clear();
    this._preferredEncodingVersion.clear();
    this._previousSubscriptionStats.clear();
  }

  getIntervalSec() {
    return this._statsRequest.intervalSec;
  }

  isConnectionEstablished() {
    if (!this._socket || this._socket.connectionState === 'connecting' || this._socket.connectionState === 'closed') {
      return false;
    } else {
      return true;
    }
  }

  isClosed() {
    return this._isClosed;
  }
}
