import {
  nowInSec,
  SkyWayAuthToken,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory,
  uuidV4 } from
'@skyway-sdk/room';

import { appId, secret } from '../../../env';

const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60 * 24,
  version: 3,
  scope: {
    appId: appId,
    rooms: [
    {
      name: "*",
      methods: ["create", "close", "updateMetadata"],
      member: {
        name: "*",
        methods: ["publish", "subscribe", "updateMetadata"]
      },
      sfu: {
        enabled: true
      }
    }],

    turn: {
      enabled: true
    }
  }
}).encode(secret);

void (async () => {
  const localVideo = document.getElementById('local-video');
  const buttonArea = document.getElementById('button-area');
  const remoteMediaArea = document.getElementById('remote-media-area');
  const channelNameInput = document.getElementById(
    'channel-name'
  );
  const myId = document.getElementById('my-id');
  const joinButton = document.getElementById('join');

  const { audio, video } =
  await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream();
  video.attach(localVideo);
  await localVideo.play();

  joinButton.onclick = async () => {
    if (channelNameInput.value === '') return;

    const context = await SkyWayContext.Create(token);
    const channel = await SkyWayRoom.FindOrCreate(context, {
      type: 'sfu',
      name: channelNameInput.value
    });
    const me = await channel.join();

    myId.textContent = me.id;

    await me.publish(audio);
    await me.publish(video, {
      encodings: [
      { maxBitrate: 80_000, id: 'low' },
      { maxBitrate: 400_000, id: 'high' }]

    });

    const subscribeAndAttach = (publication) => {
      if (publication.publisher.id === me.id) return;

      const subscribeButton = document.createElement('button');
      subscribeButton.textContent = `${publication.publisher.id}: ${publication.contentType}`;
      buttonArea.appendChild(subscribeButton);

      subscribeButton.onclick = async () => {
        const { stream, subscription } = await me.subscribe(publication.id);

        switch (stream.contentType) {
          case 'video':
            {
              const elm = document.createElement('video');
              elm.playsInline = true;
              elm.autoplay = true;
              stream.attach(elm);
              elm.onclick = () => {
                if (subscription.preferredEncoding === 'low') {
                  subscription.changePreferredEncoding('high');
                } else {
                  subscription.changePreferredEncoding('low');
                }
              };
              remoteMediaArea.appendChild(elm);
            }
            break;
          case 'audio':
            {
              const elm = document.createElement('audio');
              elm.controls = true;
              elm.autoplay = true;
              stream.attach(elm);
              remoteMediaArea.appendChild(elm);
            }
            break;
        }
      };
    };

    channel.publications.forEach(subscribeAndAttach);
    channel.onStreamPublished.add((e) => subscribeAndAttach(e.publication));
  };
})();
