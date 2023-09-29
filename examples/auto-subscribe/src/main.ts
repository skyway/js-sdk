import {
  nowInSec,
  P2PRoom,
  SfuRoom,
  SkyWayAuthToken,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory,
  uuidV4,
} from '@skyway-sdk/room';

import { appId, secret } from '../../../env';

const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60 * 24,
  scope: {
    app: {
      id: appId,
      turn: true,
      actions: ['read'],
      channels: [
        {
          id: '*',
          name: '*',
          actions: ['write'],
          members: [
            {
              id: '*',
              name: '*',
              actions: ['write'],
              publication: {
                actions: ['write'],
              },
              subscription: {
                actions: ['write'],
              },
            },
          ],
          sfuBots: [
            {
              actions: ['write'],
              forwardings: [{ actions: ['write'] }],
            },
          ],
        },
      ],
    },
  },
}).encode(secret);

void (async () => {
  const localVideo = document.getElementById(
    'js-local-stream'
  ) as HTMLVideoElement;
  const joinTrigger = document.getElementById('js-join-trigger');
  const leaveTrigger = document.getElementById('js-leave-trigger');
  const remoteVideos = document.getElementById('js-remote-streams');
  const channelName = document.getElementById(
    'js-channel-name'
  ) as HTMLInputElement;
  const roomMode = document.getElementById('js-room-type');
  const messages = document.getElementById('js-messages');

  const getRoomTypeByHash = () => (location.hash === '#sfu' ? 'sfu' : 'p2p');
  roomMode.textContent = getRoomTypeByHash();
  window.addEventListener('hashchange', () => {
    roomMode.textContent = getRoomTypeByHash();
  });

  const { audio, video } =
    await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream();

  // Render local stream
  localVideo.muted = true;
  localVideo.playsInline = true;
  video.attach(localVideo);
  await localVideo.play();

  const context = await SkyWayContext.Create(token, {
    log: { level: 'warn', format: 'object' },
  });

  let room: SfuRoom | P2PRoom;

  // Register join handler
  joinTrigger.addEventListener('click', async () => {
    if (room) {
      return;
    }

    room = await SkyWayRoom.FindOrCreate(context, {
      name: channelName.value,
      type: getRoomTypeByHash(),
    });

    const member = await room.join();
    messages.textContent += '=== You joined ===\n';

    room.onMemberJoined.add((e) => {
      messages.textContent += `=== ${e.member.id.slice(0, 5)} joined ===\n`;
    });

    const userVideo = {};

    member.onPublicationSubscribed.add(async ({ stream, subscription }) => {
      if (stream.contentType === 'data') return;

      const publisherId = subscription.publication.publisher.id;
      if (!userVideo[publisherId]) {
        const newVideo = document.createElement('video');
        newVideo.playsInline = true;
        newVideo.autoplay = true;
        newVideo.setAttribute(
          'data-member-id',
          subscription.publication.publisher.id
        );

        remoteVideos.append(newVideo);
        userVideo[publisherId] = newVideo;
      }
      const newVideo = userVideo[publisherId];
      stream.attach(newVideo);

      if (subscription.contentType === 'video' && room.type === 'sfu') {
        newVideo.onclick = () => {
          if (subscription.preferredEncoding === 'low') {
            subscription.changePreferredEncoding('high');
          } else {
            subscription.changePreferredEncoding('low');
          }
        };
      }
    });
    const subscribe = async (publication) => {
      if (publication.publisher.id === member.id) return;
      await member.subscribe(publication.id);
    };
    room.onStreamPublished.add((e) => subscribe(e.publication));
    room.publications.forEach(subscribe);

    await member.publish(audio);
    if (room.type === 'sfu') {
      await member.publish(video, {
        encodings: [
          { maxBitrate: 10_000, id: 'low' },
          { maxBitrate: 800_000, id: 'high' },
        ],
      });
    } else {
      await member.publish(video);
    }
    const disposeVideoElement = (remoteVideo: HTMLVideoElement) => {
      const stream = remoteVideo.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      remoteVideo.srcObject = null;
      remoteVideo.remove();
    };

    room.onMemberLeft.add((e) => {
      if (e.member.id === member.id) return;

      const remoteVideo = remoteVideos.querySelector(
        `[data-member-id="${e.member.id}"]`
      ) as HTMLVideoElement;
      disposeVideoElement(remoteVideo);

      messages.textContent += `=== ${e.member.id.slice(0, 5)} left ===\n`;
    });

    member.onLeft.once(() => {
      Array.from(remoteVideos.children).forEach((element) => {
        disposeVideoElement(element as HTMLVideoElement);
      });
      messages.textContent += '== You left ===\n';
      void room.dispose();
      room = undefined;
    });

    leaveTrigger.addEventListener('click', () => member.leave(), {
      once: true,
    });
  });
})();
