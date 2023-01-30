import { Logger } from '@skyway-sdk/common';

import { detectDevice } from '../../../util';
import { TransportConnectionState } from '../../interface';

const log = new Logger('packages/core/src/plugin/internal/person/util.ts');

/**@internal */
export const setEncodingParams = async (
  sender: RTCRtpSender,
  newEncodings: RTCRtpEncodingParameters[]
) => {
  const info = log.createBlock({ label: 'setEncodingParams' });

  const params = sender.getParameters();
  info.debug('getParameters', { params, newEncodings });

  if (params.encodings == undefined) {
    params.encodings = [];
  }
  params.encodings = newEncodings.map((encoding, i) => ({
    ...(params.encodings[i] || {}),
    ...encoding,
  }));

  await sender.setParameters(params);
};

/**@internal */
export const isSafari = () =>
  detectDevice() === 'Safari12' || detectDevice() === 'Safari11';

/**@internal */
export function convertConnectionState(
  state: RTCPeerConnectionState | 'reconnecting'
): TransportConnectionState {
  switch (state) {
    case 'closed':
    case 'disconnected':
    case 'failed':
      return 'disconnected';
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'new':
      return 'new';
    case 'reconnecting':
      return 'reconnecting';
  }
}

/**@internal */
export const statsToJson = (report: RTCStatsReport) => {
  const stats: any[] = [];
  report.forEach((stat) => {
    stats.push(JSON.parse(JSON.stringify(stat)));
  });
  return stats;
};
