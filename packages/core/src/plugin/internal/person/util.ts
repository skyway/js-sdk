import { Logger } from '@skyway-sdk/common';

import { detectDevice } from '../../../util';
import type { TransportConnectionState } from '../../interface';

const log = new Logger('packages/core/src/plugin/internal/person/util.ts');

/**@internal */
export const setEncodingParams = async (
  sender: RTCRtpSender,
  newEncodings: RTCRtpEncodingParameters[],
) => {
  const info = log.createBlock({ label: 'setEncodingParams' });

  const params = sender.getParameters();
  info.debug('getParameters', { params, newEncodings });

  if (params.encodings === undefined || params.encodings === null) {
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
  state: RTCPeerConnectionState | 'reconnecting',
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
export const createEmptyStatsReport = () => new Map() as RTCStatsReport;

/**@internal */
export const hasSenderTrack = (
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
) => pc.getSenders().some((sender) => sender.track === track);

/**@internal */
export const hasReceiverTrack = (
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
) => pc.getReceivers().some((receiver) => receiver.track === track);

/**@internal */
export const isInvalidStatsSelectorError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'InvalidAccessError' &&
    error.message.includes('There is no sender or receiver for the track')
  );
};

/**@internal */
export const statsToJson = (report: RTCStatsReport) => {
  const stats: any[] = [];
  report.forEach((stat) => {
    stats.push(JSON.parse(JSON.stringify(stat)));
  });
  return stats;
};
