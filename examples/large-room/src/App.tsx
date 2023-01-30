import {
  RemoteVideoStream,
  RoomPublication,
  RoomSubscription,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory,
} from '@skyway-sdk/room';
import { FC, useEffect, useRef, useState } from 'react';

import { contextOptions, sfuOptions, tokenString } from './const';

const App: FC = () => {
  const [roomName, setRoomName] = useState('');
  const audioContainer = useRef<HTMLDivElement>(null);
  const [videoSubscriptions, setVideoSubscriptions] = useState<
    RoomSubscription<RemoteVideoStream>[]
  >([]);

  const main = async () => {
    const context = await SkyWayContext.Create(tokenString, contextOptions);
    const room = await SkyWayRoom.FindOrCreate(context, {
      name: roomName,
      type: 'sfu',
      options: sfuOptions,
    });
    const member = await room.join();

    const { audio, video } =
      await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream({
        video: { height: 640, width: 360, frameRate: 15 },
      });
    await member.publish(audio, { maxSubscribers: 50 });
    await member.publish(video, {
      maxSubscribers: 50,
      encodings: [
        { scaleResolutionDownBy: 4, id: 'low', maxBitrate: 80_000 },
        { scaleResolutionDownBy: 1, id: 'high', maxBitrate: 400_000 },
      ],
    });

    member.onPublicationSubscribed.add((e) => {
      if (e.stream.contentType === 'audio') {
        const container = audioContainer.current!;
        const audio = document.createElement('audio');
        audio.srcObject = new MediaStream([e.stream.track]);
        audio.play();
        container.appendChild(audio);
        e.subscription.onCanceled.once(() => {
          container.removeChild(audio);
        });
      }
    });
    member.onSubscriptionListChanged.add(() => {
      setVideoSubscriptions(
        member.subscriptions.filter(
          (subscription): subscription is RoomSubscription<RemoteVideoStream> =>
            subscription.contentType === 'video'
        )
      );
    });

    const subscribe = async (publication: RoomPublication) => {
      if (publication.publisher.id !== member.id) {
        if (publication.contentType === 'video') {
          await member.subscribe(publication, {
            preferredEncodingId: 'low',
          });
        } else {
          await member.subscribe(publication);
        }
      }
    };
    room.onStreamPublished.add(async (e) => {
      await subscribe(e.publication);
    });
    await Promise.all(room.publications.map(subscribe));
  };

  return (
    <div>
      <input onChange={(e) => setRoomName(e.target.value)} value={roomName} />
      <button onClick={main}>join</button>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {videoSubscriptions.map((subscription) => (
          <Video key={subscription.id} subscription={subscription} />
        ))}
      </div>
      <div ref={audioContainer} />
    </div>
  );
};

const Video: FC<{ subscription: RoomSubscription<RemoteVideoStream> }> = ({
  subscription,
}) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    ref.current!.srcObject = new MediaStream([subscription.stream!.track]);
  }, [ref.current]);

  const switchEncodingSetting = async () => {
    if (subscription.preferredEncoding === 'high') {
      subscription.changePreferredEncoding('low');
    } else if (subscription.preferredEncoding === 'low') {
      subscription.changePreferredEncoding('high');
    }
  };

  return (
    <div>
      <video
        muted
        autoPlay
        playsInline
        ref={ref}
        onClick={switchEncodingSetting}
      />
    </div>
  );
};

export default App;
