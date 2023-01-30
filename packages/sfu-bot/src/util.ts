import { Channel, EncodingParameters, Member } from '@skyway-sdk/core';

export function getLayerFromEncodings(
  id: string,
  encodings: EncodingParameters[]
) {
  let layer = 0;
  for (; layer < encodings.length; layer++) {
    const encoding = encodings[layer];
    if (encoding.id === id) {
      break;
    }
  }
  return layer;
}

export function moveToHead<T>(arr: T[], selector: (o: T) => boolean) {
  const target = arr.find(selector)!;
  return [target, ...arr.filter((o) => !selector(o))];
}

export function createWarnPayload({
  channel,
  detail,
  operationName,
  payload,
  bot,
}: {
  operationName: string;
  channel?: Channel;
  detail: string;
  payload?: any;
  bot?: Member;
}) {
  const warn: any = {
    operationName,
    payload,
    detail,
  };
  if (channel) {
    warn['appId'] = channel.appId;
    warn['channelId'] = channel.id;
    if (channel.localPerson) {
      warn['memberId'] = channel.localPerson.id;
    }
  }

  if (bot) {
    warn['botId'] = bot.id;
    warn['appId'] = bot.channel.appId;
    warn['channelId'] = bot.channel.id;
    warn['memberId'] = bot.channel.localPerson?.id;
  }

  return warn;
}
