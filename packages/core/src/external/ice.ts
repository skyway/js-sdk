import { BackOff, HttpClient, Logger } from '@skyway-sdk/common';

import { SkyWayContext } from '../context';

const log = new Logger('packages/core/src/external/ice.ts');

/**@internal */
export class IceManager {
  readonly domain = this.args.domain;
  readonly version = this.args.version;
  readonly secure = this.args.secure;
  readonly memberId = this.args.memberId;
  readonly channelId = this.args.channelId;
  readonly ttl = this.args.ttl;
  readonly context = this.args.context;

  private _stunServers: RTCIceServer[] = [];
  private _turnServers: RTCIceServer[] = [];
  private readonly _endpoint = `http${this.secure ? 's' : ''}://${
    this.domain
  }/v${this.version}`;
  readonly http = new HttpClient(this._endpoint);

  constructor(
    private args: {
      domain: string;
      version: number;
      secure: boolean;
      memberId: string;
      channelId: string;
      ttl?: number;
      context: SkyWayContext;
    }
  ) {}

  async updateIceParams() {
    const body = {
      memberId: this.memberId,
      channelId: this.channelId,
      ttl: this.ttl,
    };
    log.debug('[start] fetch iceParams');

    const backoff = new BackOff({ times: 6, interval: 500, jitter: 100 });
    const { turn, stun } = await this.http.post<{
      turn?: {
        username: string;
        credential: string;
        domain: string;
        port: number;
      };
      stun: { domain: string; port: number };
    }>(`/ice-params`, body, {
      headers: { authorization: `Bearer ${this.context.authTokenString}` },
      retry: () => backoff.wait(),
    });

    if (turn) {
      this._turnServers = [
        {
          credential: turn.credential,
          urls: `turn:${turn.domain}:${turn.port}?transport=tcp`,
          username: turn.username,
        },
        {
          credential: turn.credential,
          urls: `turn:${turn.domain}:${turn.port}?transport=udp`,
          username: turn.username,
        },
        {
          credential: turn.credential,
          urls: `turns:${turn.domain}:${turn.port}?transport=tcp`,
          username: turn.username,
        },
      ];
    }
    this._stunServers = [{ urls: `stun:${stun.domain}:${stun.port}` }];

    log.debug('[end] fetch iceParams', { turn, stun });
  }

  get iceServers(): RTCIceServer[] {
    let iceServers: RTCIceServer[] = [...this._stunServers];
    const turnServers = this._turnServers.filter((t) => {
      const url = t.urls as string;
      switch (this.context.config.rtcConfig.turnProtocol) {
        case 'all':
          return true;
        case 'udp':
          return url.endsWith('udp');
        case 'tcp':
          return !url.startsWith('turns') && url.endsWith('tcp');
        case 'tls':
          return url.startsWith('turns');
      }
    });

    if (this.context.config.rtcConfig.turnPolicy !== 'disable') {
      iceServers = [...iceServers, ...turnServers];
    }

    return iceServers;
  }
}
