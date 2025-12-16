import type model from '@skyway-sdk/model';
import type { ContentType } from '@skyway-sdk/model';

import type { SkyWayChannelImpl } from '../channel';
import type { LocalStream } from '../media/stream/local';
import type { RemoteMemberImplInterface } from '../member/remoteMember';
import { PublicationImpl, type PublicationType } from '.';

/**@internal */
export function createPublication<T extends LocalStream>(
  channel: SkyWayChannelImpl,
  {
    publisherId,
    stream,
    origin,
    metadata,
    codecCapabilities,
    encodings,
    contentType,
    id,
    isEnabled,
    type,
  }: model.Publication & { stream?: T },
): PublicationImpl<T> {
  const exist = channel._getPublication(id);
  if (exist) {
    return exist as PublicationImpl<T>;
  }

  contentType = contentType.toLowerCase() as ContentType;

  const originPublication = origin
    ? // todo fix originPublicationが不整合を起こすことがある
      channel._getPublication(origin)
    : undefined;

  // リレーされたPublicationのencodingsを設定する
  if (originPublication) {
    if (encodings.length === 0) {
      encodings = originPublication.encodings;
    }
  }

  const publisher = channel._getMember(
    publisherId,
  ) as RemoteMemberImplInterface;

  // typeがnullの場合はv2.0.0よりも前のバージョンにおけるp2pとして解釈する
  const publicationType: PublicationType = type ?? 'p2p';

  const publication = new PublicationImpl<T>({
    id,
    channel,
    publisher,
    contentType,
    metadata,
    origin: originPublication,
    stream,
    codecCapabilities: codecCapabilities ?? [],
    encodings,
    isEnabled,
    type: publicationType,
  });

  return publication;
}
