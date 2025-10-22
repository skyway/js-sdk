import {
  ErrorInfo,
  Logger,
  RuntimeInfo,
  SkyWayError,
} from '@skyway-sdk/common';
import Bowser from 'bowser';
import sdpTransform, { MediaAttributes } from 'sdp-transform';
import { UAParser } from 'ua-parser-js';

import { Channel, SkyWayChannelImpl } from './channel';
import { SkyWayContext } from './context';
import { errors } from './errors';
import { Codec } from './media';
import { LocalStream, RemoteStream, WebRTCStats } from './media/stream';
import { Member } from './member';

const log = new Logger('packages/core/src/util.ts');

/**@internal */
export function getBitrateFromPeerConnection(
  stream: LocalStream | RemoteStream,
  direction: 'inbound' | 'outbound',
  cb: (bitrate: number) => void,
  selector: Member | string
) {
  let preBytes = 0;
  const id = setInterval(async () => {
    const stats = await stream._getStats(selector);
    const stat = stats.find((v) => {
      if (direction === 'inbound') {
        return (
          v?.id.includes('InboundRTPVideo') || v?.type.includes('inbound-rtp')
        );
      }
      return (
        v?.id.includes('OutboundRTPVideo') || v?.type.includes('outbound-rtp')
      );
    });
    if (!stat) {
      return;
    }
    const totalBytes =
      direction === 'inbound' ? stat.bytesReceived : stat.bytesSent;
    const bitrate = (totalBytes - preBytes) * 8;
    cb(bitrate);
    preBytes = totalBytes;
  }, 1000);
  return () => clearInterval(id);
}

/**@internal */
export function statsToArray(stats: RTCStatsReport) {
  const arr: WebRTCStats = [];
  stats.forEach((stat) => {
    arr.push(stat);
  });
  return arr;
}

/**@internal */
export async function createLogPayload({
  operationName,
  channel,
}: {
  operationName: string;
  channel: Channel;
}) {
  const payload: any = {
    operationName,
    appId: channel.appId,
    channelId: channel.id,
  };

  if (channel.localPerson) {
    const member = channel.localPerson;
    const publishing = await Promise.all(
      member.publications.map(async (p) => {
        const publication: any = {
          id: p.id,
          contentType: p.contentType,
          state: p.state,
          stats: {},
          connectionStats: {},
        };
        if (p.stream) {
          for (const { memberId, stats } of await p.stream._getStatsAll()) {
            const localCandidate = stats.find((s) =>
              s.type.includes('local-candidate')
            );

            publication.stats[memberId] = {
              transportType: localCandidate?.protocol ?? 'none',
              relayProtocol: localCandidate?.relayProtocol ?? 'none',
              callType: p.subscriptions.find(
                (s) => s.subscriber.id === memberId
              )?.subscriber.subtype,
              outbound: stats.find((s) => s.type.includes('outbound-rtp')),
              localCandidate,
            };
          }
        }
        if (p.stream) {
          for (const {
            memberId,
            connectionState,
          } of p.stream._getConnectionStateAll()) {
            publication.connectionStats[memberId] = connectionState;
          }
        }
        return publication;
      })
    );
    payload['publishing'] = publishing;

    const subscribing = await Promise.all(
      member.subscriptions.map(async (s) => {
        const subscription: any = {
          id: s.id,
          contentType: s.contentType,
          stats: {},
        };
        subscription['callType'] = s.publication.publisher.subtype;
        if (s.stream) {
          const stats = await s.stream._getStats();
          subscription.stats = stats.find((s) =>
            s.type.includes('inbound-rtp')
          );
          const iceCandidate = stats.find((s) =>
            s.type.includes('local-candidate')
          );
          subscription['transportType'] = iceCandidate?.protocol;
          subscription['relayProtocol'] = iceCandidate?.relayProtocol;
        }
        if (s.stream) {
          subscription['connectionState'] = s.stream._getConnectionState();
        }
        return subscription;
      })
    );
    payload['subscribing'] = subscribing;
  }

  return payload;
}

/**@internal */
export function createWarnPayload({
  member,
  detail,
  channel,
  operationName,
  payload,
}: {
  operationName: string;
  member?: Member;
  channel?: SkyWayChannelImpl;
  detail: string;
  payload?: any;
}) {
  const warn: any = {
    operationName,
    payload,
    detail,
  };
  if (member) {
    warn['appId'] = member.channel.appId;
    warn['channelId'] = member.channel.id;
    warn['memberId'] = member.id;
  }
  if (channel) {
    warn['appId'] = channel.appId;
    warn['channelId'] = channel.id;
  }

  return warn;
}

/**@internal */
export function createError({
  operationName,
  context,
  info,
  error,
  path,
  payload,
  channel,
}: {
  operationName: string;
  path: string;
  info: ErrorInfo;
  context?: SkyWayContext;
  channel?: Channel;
  error?: Error;
  payload?: any;
}) {
  const errPayload: any = {
    operationName,
    payload,
  };

  if (channel) {
    errPayload['appId'] = channel.appId;
    errPayload['channelId'] = channel.id;
    if (channel.localPerson) {
      errPayload['memberId'] = channel.localPerson.id;
    }
  }
  if (context) {
    errPayload['info'] = context.info;
    errPayload['plugins'] = context.plugins.map((p) => p.subtype);
  }

  return new SkyWayError({ error, info, payload: errPayload, path });
}

/**@internal */
export const waitForLocalStats = async ({
  stream,
  remoteMember,
  end,
  interval,
  timeout,
}: {
  stream: LocalStream;
  remoteMember: string;
  end: (stats: WebRTCStats) => boolean;
  /**ms */
  interval?: number;
  /**ms */
  timeout?: number;
}) =>
  new Promise<WebRTCStats>(async (r, f) => {
    interval ??= 100;
    timeout ??= 10_000;

    for (let elapsed = 0; ; elapsed += interval) {
      if (elapsed >= timeout) {
        f(
          createError({
            operationName: 'Peer.waitForStats',
            info: {
              ...errors.timeout,
              detail: 'waitForStats timeout',
            },
            path: log.prefix,
          })
        );
        break;
      }

      const stats = await stream._getStats(remoteMember);
      if (end(stats)) {
        r(stats);
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  });

/**@internal */
export async function getRtcRtpCapabilities(): Promise<{
  audio: (Codec & { payload: number })[];
  video: (Codec & { payload: number })[];
}> {
  const pc = new RTCPeerConnection();

  pc.addTransceiver('audio', {
    direction: 'sendonly',
  });
  pc.addTransceiver('video', {
    direction: 'sendonly',
  });

  const offer = await pc.createOffer();

  try {
    pc.close();
  } catch (error) {}

  const sdpObject = sdpTransform.parse(offer.sdp!);
  const [audio, video] = sdpObject.media;

  return {
    audio: audio.rtp.map(
      (r) =>
        ({
          ...r,
          payload: r.payload,
          mimeType: 'audio/' + r.codec,
          parameters: getParameters(audio.fmtp, r.payload),
        } as Codec & { payload: number })
    ),
    video: video.rtp
      .filter((r) => !['red', 'rtx', 'ulpfec'].includes(r.codec))
      .map(
        (r) =>
          ({
            ...r,
            payload: r.payload,
            mimeType: 'video/' + r.codec,
            parameters: getParameters(video.fmtp, r.payload),
          } as Codec & { payload: number })
      ),
  };
}

/**@internal */
export const getParameters = (fmtp: MediaAttributes['fmtp'], payload: number) =>
  fmtpConfigParser(fmtp.find((f) => f.payload === payload)?.config ?? '');

/**@internal */
export const fmtpConfigParser = (config: string) => {
  const parameters = config
    .split(';')
    .reduce((acc: { [k: string]: number | string | undefined }, cur) => {
      const [k, v] = cur.split('=');
      if (k) {
        acc[k] = !isNaN(Number(v)) ? Number(v) : v;
      }
      return acc;
    }, {});
  return parameters;
};

/**@internal */
export function createTestVideoTrack(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const drawAnimation = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgb(200, 200, 200)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const date = new Date();
    ctx.font = '45px Monaco,Consolas';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'red';
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    const milliseconds = ('00' + date.getMilliseconds()).slice(-3);
    ctx.fillText(
      `${hours}:${minutes}:${seconds}.${milliseconds}`,
      canvas.width / 2,
      canvas.height / 2
    );

    requestAnimationFrame(drawAnimation);
  };
  setTimeout(() => drawAnimation(), 0);

  const [track] = canvas.captureStream().getVideoTracks();
  return track;
}

/**
 * @internal
 * @description browser only
 */
export const getRuntimeInfo = ({
  isNotBrowser,
}: Partial<{
  isNotBrowser: RuntimeInfo;
}> = {}): RuntimeInfo => {
  if (isNotBrowser) {
    return isNotBrowser;
  }

  const browser = Bowser.getParser(window.navigator.userAgent);
  const osName = browser.getOSName();
  const osVersion = browser.getOSVersion();
  const browserName = browser.getBrowserName();
  const browserVersion = browser.getBrowserVersion();
  return {
    browserName,
    browserVersion,
    osName,
    osVersion,
  };
};

/**
 * @internal
 * @description from mediasoup-client
 */
export function detectDevice(): BuiltinHandlerName | undefined {
  // React-Native.
  // NOTE: react-native-webrtc >= 1.75.0 is required.
  // NOTE: react-native-webrtc with Unified Plan requires version >= 106.0.0.
  if (typeof navigator === 'object' && navigator.product === 'ReactNative') {
    if (typeof RTCPeerConnection === 'undefined') {
      return undefined;
    }

    if (typeof RTCRtpTransceiver !== 'undefined') {
      return 'ReactNativeUnifiedPlan';
    } else {
      return 'ReactNative';
    }
  }
  // Browser.
  else if (
    typeof navigator === 'object' &&
    typeof navigator.userAgent === 'string'
  ) {
    const ua = navigator.userAgent;

    const uaParser = new UAParser(ua);

    const browser = uaParser.getBrowser();
    const browserName = browser.name?.toLowerCase() ?? '';
    const browserVersion = parseInt(browser.major ?? '0');
    const engine = uaParser.getEngine();
    const engineName = engine.name?.toLowerCase() ?? '';
    const os = uaParser.getOS();
    const osName = os.name?.toLowerCase() ?? '';
    const osVersion = parseFloat(os.version ?? '0');

    const isIOS = osName === 'ios';

    const isChrome = [
      'chrome',
      'chromium',
      'mobile chrome',
      'chrome webview',
      'chrome headless',
    ].includes(browserName);

    const isFirefox = ['firefox', 'mobile firefox', 'mobile focus'].includes(
      browserName
    );

    const isSafari = ['safari', 'mobile safari'].includes(browserName);

    const isEdge = ['edge'].includes(browserName);

    // Chrome, Chromium, and Edge.
    if ((isChrome || isEdge) && !isIOS && browserVersion >= 111) {
      return 'Chrome111';
    } else if (
      (isChrome && !isIOS && browserVersion >= 74) ||
      (isEdge && !isIOS && browserVersion >= 88)
    ) {
      return 'Chrome74';
    } else if (isChrome && !isIOS && browserVersion >= 70) {
      return 'Chrome70';
    } else if (isChrome && !isIOS && browserVersion >= 67) {
      return 'Chrome67';
    } else if (isChrome && !isIOS && browserVersion >= 55) {
      return 'Chrome55';
    }
    // Firefox.
    else if (isFirefox && !isIOS && browserVersion >= 60) {
      return 'Firefox60';
    }
    // Firefox on iOS (so Safari).
    else if (isFirefox && isIOS && osVersion >= 14.3) {
      return 'Safari12';
    }
    // Safari with Unified-Plan support enabled.
    else if (
      isSafari &&
      browserVersion >= 12 &&
      typeof RTCRtpTransceiver !== 'undefined' &&
      // eslint-disable-next-line no-prototype-builtins
      RTCRtpTransceiver.prototype.hasOwnProperty('currentDirection')
    ) {
      return 'Safari12';
    }
    // Safari with Plab-B support.
    else if (isSafari && browserVersion >= 11) {
      return 'Safari11';
    }
    // Old Edge with ORTC support.
    else if (isEdge && !isIOS && browserVersion >= 11 && browserVersion <= 18) {
      return 'Edge11';
    }
    // Best effort for WebKit based browsers in iOS.
    else if (
      engineName === 'webkit' &&
      isIOS &&
      osVersion >= 14.3 &&
      typeof RTCRtpTransceiver !== 'undefined' &&
      // eslint-disable-next-line no-prototype-builtins
      RTCRtpTransceiver.prototype.hasOwnProperty('currentDirection')
    ) {
      return 'Safari12';
    }
    // Best effort for Chromium based browsers.
    else if (engineName === 'blink') {
      const match = ua.match(/(?:(?:Chrome|Chromium))[ /](\w+)/i);

      if (match) {
        const version = Number(match[1]);

        if (version >= 111) {
          return 'Chrome111';
        } else if (version >= 74) {
          return 'Chrome74';
        } else if (version >= 70) {
          return 'Chrome70';
        } else if (version >= 67) {
          return 'Chrome67';
        } else {
          return 'Chrome55';
        }
      } else {
        return 'Chrome111';
      }
    }
    // Unsupported browser.
    else {
      return undefined;
    }
  }
  // Unknown device.
  else {
    return undefined;
  }
}

/**@internal */
export type BuiltinHandlerName =
  | 'Chrome111'
  | 'Chrome74'
  | 'Chrome70'
  | 'Chrome67'
  | 'Chrome55'
  | 'Firefox60'
  | 'Safari12'
  | 'Safari11'
  | 'Edge11'
  | 'ReactNativeUnifiedPlan'
  | 'ReactNative';
