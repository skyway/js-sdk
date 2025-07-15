import { OnLogForAnalyticsProps } from '@skyway-sdk/common';
import { ContentType } from '@skyway-sdk/model';

import {
  BindingRtcPeerConnectionToSubscriptionClientEvent,
  ClientEvent,
  JoinReportClientEvent,
  MediaDeviceReportClientEvent,
  PublicationUpdateEncodingsReportClientEvent,
  RtcPeerConnectionEventReportClientEvent,
  SubscriptionStats,
  SubscriptionStatsReportClientEvent,
  SubscriptionUpdatePreferredEncodingReportClientEvent,
} from './clientEvent';
import { AcknowledgePayload, ConnectionFailedEventPayload, isAcknowledgePayload } from './payloadTypes';
import { ConnectionState, ServerEvent, Socket } from './socket';
import { BackOff } from './utils/backoff';
import { Event } from './utils/event';
import { Logger } from './utils/logger';

const ANALYTICS_LOGGING_SERVER_DOMAIN = 'analytics-logging.skyway.ntt.com';
const API_VERSION = 'v2';
const TIMEOUT_SEC = 5;

type AnalyticsClientParams = {
  token: string;
  sdkVersion: string;
  contextId: string;
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
type JoinReport = JoinReportClientEvent['payload'];

export class AnalyticsClient {
  private readonly _options: AnalyticsClientInternalOptions;

  private readonly _logger: Logger;

  private _socket: Socket | undefined;

  readonly onConnectionStateChanged = new Event<ConnectionState>();

  readonly onConnectionFailed = new Event<void>();

  readonly onAnalyticsNotEnabledError = new Event<ConnectionFailedEventPayload>();

  private _token: string;

  private _newToken: string | undefined;

  private readonly _sdkVersion: string;

  private readonly _contextId: string;

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
          // property の収集・送信対象となる subscription の contentType
          contentType: ('audio' | 'video' | 'data')[];
        };
      };
    }[];
  } = {
    // connect()時のopenServerEventPayload.statsRequest代入でそれぞれ値が入るが，一度初期値として定義しておく
    intervalSec: 5,
    types: [],
  };

  private _pendingSdkLogs: OnLogForAnalyticsProps[] = [];
  private _sdkLogTimer: NodeJS.Timeout;

  private static readonly MAX_PENDING_SDK_LOGS = 50;

  constructor({ token, sdkVersion, contextId }: AnalyticsClientParams, options?: AnalyticsClientOptions) {
    this._token = token;
    this._newToken = undefined;
    this._sdkVersion = sdkVersion;
    this._contextId = contextId;

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

    this._sdkLogTimer = setInterval(() => {
      if (this._pendingSdkLogs.length > 0) {
        const logs = this._pendingSdkLogs.splice(0, this._pendingSdkLogs.length);
        this.sendSdkLogReport(logs).catch((err) => {
          this._logger.warn('sendSdkLogReport (interval) failed', err);
        });
      }
    }, 5 * 1000);
  }

  get connectionState(): ConnectionState {
    return this._socket?.connectionState ?? 'closed';
  }

  async connect(): Promise<void> {
    const WSProtocol = this._options.secure ? 'wss' : 'ws';

    const analyticsLoggingServerDomain = this._options.analyticsLoggingServerDomain || ANALYTICS_LOGGING_SERVER_DOMAIN;

    this._socket = new Socket({
      sessionEndpoint: `${WSProtocol}://${analyticsLoggingServerDomain}/${API_VERSION}/client/ws`,
      contextId: this._contextId,
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

    this._socket.onConnectionFailed.addListener((data) => {
      // 現状の実装として4000はダッシュボード上でAnalyticsが有効になってない場合のエラーである
      // 初回接続時のconnectWithTimeoutのtimeoutよりPromiseを先に解決させるためのEventをemitする
      if (data.code === 4000) {
        this.onAnalyticsNotEnabledError.emit(data);
      }
      this.onConnectionFailed.emit();
      this.dispose();
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

  bufferOrSendSdkLog(log: OnLogForAnalyticsProps): void {
    const shouldImmediateSend = log.level === 'warn' || log.level === 'error';
    this._pendingSdkLogs.push(log);

    if (shouldImmediateSend || this._pendingSdkLogs.length >= AnalyticsClient.MAX_PENDING_SDK_LOGS) {
      const logsToSend = [...this._pendingSdkLogs];
      this._pendingSdkLogs.length = 0;
      this.sendSdkLogReport(logsToSend).catch((err) => {
        this._logger.warn('sendSdkLogReport failed', err);
      });
    }
  }

  dispose(): void {
    clearInterval(this._sdkLogTimer);
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

  async sendSdkLogReport(logs: OnLogForAnalyticsProps[]): Promise<void> {
    if (logs.length === 0) return;
    const sdkLogs = logs.map((l) => ({
      timestamp: l.timestamp,
      level: l.level,
      message: Array.isArray(l.message)
        ? l.message.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(',')
        : String(l.message),
    }));
    const clientEvent = new ClientEvent('SdkLog', {
      sdkLogs,
      contextId: this._contextId,
    });

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendSdkLogReport is failed', err);
    });
  }

  async sendBindingRtcPeerConnectionToSubscription(bindingData: BindingRtcPeerConnectionToSubscription): Promise<void> {
    const clientEvent = new ClientEvent('BindingRtcPeerConnectionToSubscription', bindingData);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendBindingRtcPeerConnectionToSubscription is failed', err);
    });
  }

  /**
   * RTCStatsReportにはcandidate-pair, local-candidate, remote-candidateが複数含まれる場合がある。
   * 現在利用されているもののみを選出して返す。
   */
  private filterStatsReport(report: RTCStatsReport) {
    /**
     * candidate-pairの選出について
     * transportから現在利用されているcandidate-pairを特定することができる。
     * ただしFirefoxの場合はtransportが含まれていない。(2024/09/04時点)
     * 代わりにcandidate-pairにselectedが含まれているのでFFではこれを利用する。
     */
    const connectedTransport = Array.from(report.values()).find(
      (rtcStatsReportValue) => rtcStatsReportValue.type === 'transport' && rtcStatsReportValue.dtlsState === 'connected'
    );
    const candidatePairKeys = [];
    if (connectedTransport) {
      /**
       * connectedTransportが取れる場合:
       * ChromeやSafariの場合はtransportの情報を使ってcandidate-pairを選出する
       */
      const nominatedCandidatePair = Array.from(report.values()).find(
        (rtcStatsReportValue) =>
          rtcStatsReportValue.type === 'candidate-pair' &&
          rtcStatsReportValue.nominated &&
          rtcStatsReportValue.id === connectedTransport?.selectedCandidatePairId
      );
      if (nominatedCandidatePair) {
        candidatePairKeys.push(
          nominatedCandidatePair.id,
          nominatedCandidatePair.localCandidateId,
          nominatedCandidatePair.remoteCandidateId,
          nominatedCandidatePair.transportId
        );
      }
    } else {
      /**
       * connectedTransportが取れない場合:
       * 現行FFの場合はcandidate-pairを直接みてnominated:trueかつselected:trueのものを選出する
       */
      const nominatedCandidatePair = Array.from(report.values()).find(
        (rtcStatsReportValue) =>
          rtcStatsReportValue.type === 'candidate-pair' && rtcStatsReportValue.nominated && rtcStatsReportValue.selected
      );
      if (nominatedCandidatePair) {
        candidatePairKeys.push(
          nominatedCandidatePair.id,
          nominatedCandidatePair.localCandidateId,
          nominatedCandidatePair.remoteCandidateId,
          nominatedCandidatePair.transportId
        );
      }
    }

    const filteredReport: Map<string, object> = new Map();
    const duplicatableTypes = ['candidate-pair', 'local-candidate', 'remote-candidate', 'transport'];
    for (const [key, rtcStatsReportValue] of report.entries()) {
      if (duplicatableTypes.includes(rtcStatsReportValue.type)) {
        // 重複し得るstats typeはnominateされたcandidate-pairから選出する
        if (candidatePairKeys.includes(rtcStatsReportValue.id)) {
          filteredReport.set(key, rtcStatsReportValue);
        }
      } else {
        filteredReport.set(key, rtcStatsReportValue);
      }
    }
    return filteredReport as RTCStatsReport;
  }

  private bundleStatsReportByStatsType(report: RTCStatsReport): Record<string, Record<string, unknown>> {
    const stats: SubscriptionStats = {};
    for (const v of report.values()) {
      stats[v.type] = v;
    }
    return stats;
  }

  async sendSubscriptionStatsReport(
    report: RTCStatsReport,
    subscriptionParams: Omit<SubscriptionStatsReport, 'stats'> & { contentType: ContentType }
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
    const filteredPreviousSubscriptionStats = this.filterStatsReport(previousSubscriptionStat.stats);
    const prevBundledSubscriptionStats = this.bundleStatsReportByStatsType(filteredPreviousSubscriptionStats);

    const previousCreatedAt = previousSubscriptionStat.createdAt;
    const duration = (subscriptionParams.createdAt - previousCreatedAt) / 1000; // mills to sec.
    if (duration <= 0) {
      throw new Error('duration must be greater than 0. also sendSubscriptionStatsReport was duplicated.');
    }

    const filteredStatsReport = this.filterStatsReport(report);
    const bundledStatsReport = this.bundleStatsReportByStatsType(filteredStatsReport);

    // StatsReportから必要な値だけを抽出してSubscriptionStatsに格納する
    const subscriptionStats: SubscriptionStats = {};
    for (const { type, properties } of this._statsRequest.types) {
      for (const [prop, { normalization: normRequired, outputKey, contentType }] of Object.entries(properties)) {
        if (!contentType.includes(subscriptionParams.contentType)) {
          continue;
        }
        const statsReport = bundledStatsReport[type];
        if (statsReport === undefined || statsReport[prop] === undefined) {
          continue;
        }
        if (normRequired) {
          const previousValue = prevBundledSubscriptionStats[type]?.[prop];
          if (previousValue === undefined) {
            this._logger.warn(`${type} in previous statsReport is undefined`);
            continue;
          }

          const perSecondValue = (Number(statsReport[prop]) - Number(previousValue)) / duration;
          subscriptionStats[type] = {
            ...subscriptionStats[type],
            [outputKey]: String(perSecondValue),
          };
        } else {
          subscriptionStats[type] = {
            ...subscriptionStats[type],
            [outputKey]: String(statsReport[prop]),
          };
        }
      }
    }

    const payload: SubscriptionStatsReport = {
      subscriptionId: subscriptionParams.subscriptionId,
      stats: subscriptionStats,
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

  async sendJoinReport(report: JoinReport): Promise<void> {
    const clientEvent = new ClientEvent('JoinReport', report);

    await this._sendClientEvent(clientEvent).catch((err) => {
      this._logger.warn('_sendClientEvent in sendJoinReport is failed', err);
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
