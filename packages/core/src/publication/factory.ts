import model, { ContentType } from '@skyway-sdk/model';

import { SkyWayChannelImpl } from '../channel';
import { LocalStream } from '../media/stream/local';
import { PublicationImpl } from '.';

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
  }: model.Publication & { stream?: T }
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

  const publication = new PublicationImpl<T>({
    id,
    channel,
    publisher: channel._getMember(publisherId),
    contentType,
    metadata,
    origin: originPublication,
    stream,
    codecCapabilities: codecCapabilities ?? [],
    encodings,
    isEnabled,
  });

  return publication;
}
