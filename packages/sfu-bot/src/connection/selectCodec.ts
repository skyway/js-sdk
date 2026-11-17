import type { Codec } from '@skyway-sdk/core';
import isEqual from 'lodash/isEqual';
import type { types } from 'mediasoup-client';

type RtpCodecCapability = types.RtpCodecCapability;

/**
 * 送信するコーデックを選ぶ。
 *
 * Publication に設定された `codecCapabilities` の先頭の要素に対応する、
 * Device の codec を返す（先頭の要素に対応する codec が無い場合は、後続の要素に
 * 対応する codec があっても `undefined` を返す）。
 * `deviceCodecs` には、送信用の RTP capabilities（`sendRtpCapabilities`）の codec を渡す。
 *
 * TODO(DRTC-3746): 先頭の要素に対応する codec が無い場合に後続へ fallback しないのは、
 * 意図した仕様かどうかを確認する。
 *
 * - 映像: mimeType が一致し、`codecCapabilities` 側に parameters がある場合は parameters も完全一致するもの
 * - 音声: mimeType が一致するもの
 */
export function selectCodec(
  codecCapabilities: Codec[],
  deviceCodecs: RtpCodecCapability[],
): RtpCodecCapability | undefined {
  const [codec] = codecCapabilities.map((cap) => {
    if (cap.mimeType.toLowerCase().includes('video')) {
      return deviceCodecs.find((c) => {
        if (c.mimeType.toLowerCase() !== cap.mimeType.toLowerCase()) {
          return false;
        }
        if (
          Object.keys(cap.parameters ?? {}).length > 0 &&
          !isEqual(cap.parameters, c.parameters)
        ) {
          return false;
        }
        return true;
      });
    }
    return deviceCodecs.find(
      (c) => c.mimeType.toLowerCase() === cap.mimeType.toLowerCase(),
    );
  });
  return codec;
}
