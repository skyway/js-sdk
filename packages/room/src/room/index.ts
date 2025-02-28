import { Logger } from '@skyway-sdk/common';
import {
  createError,
  SkyWayChannel,
  SkyWayChannelImpl,
  SkyWayContext,
} from '@skyway-sdk/core';
import {
  SfuApiOptions,
  SfuBotPlugin,
  SfuBotPluginOptions,
} from '@skyway-sdk/sfu-bot';
import { v4 as uuidV4 } from 'uuid';

import { errors } from '../errors';
import { PACKAGE_VERSION } from '../version';
import { P2PRoom, P2PRoomImpl } from './p2p';
import { SfuRoom, SfuRoomImpl } from './sfu';

const log = new Logger('packages/room/src/room/index.ts');

export type { SfuApiOptions, SfuBotPluginOptions };

export class SkyWayRoom {
  /**@private */
  constructor() {}

  /**
   * @description [japanese] Roomの作成
   */
  static Create = async <Init extends RoomInit>(
    context: SkyWayContext,
    init: Init
  ) => {
    log.info('room created', {
      operationName: 'SkyWayRoom._Factory',
      sdkName: 'room',
      sdkVersion: PACKAGE_VERSION,
      init,
    });

    const plugin = new SfuBotPlugin((init as SfuRoomInit)?.options?.sfu);
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.Create(context, {
      name: init.name ?? uuidV4(),
      metadata: init.metadata,
    });
    const room = await SkyWayRoom._Factory(
      context,
      init.type,
      channel as SkyWayChannelImpl
    );
    return room as Init['type'] extends 'sfu' ? SfuRoom : P2PRoom;
  };

  /**
   * @description [japanese] 既存のRoomの取得
   */
  static Find = async <Type extends RoomType>(
    context: SkyWayContext,
    query: { id?: string; name?: string },
    roomType: Type,
    options?: Type extends 'sfu' ? SfuRoomOptions : void
  ) => {
    const plugin = new SfuBotPlugin(
      (options as SfuRoomOptions | undefined)?.sfu
    );
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.Find(context, query);
    const room = await SkyWayRoom._Factory(
      context,
      roomType,
      channel as SkyWayChannelImpl
    );
    return room as Type extends 'sfu' ? SfuRoom : P2PRoom;
  };

  /**
   * @description [japanese] Roomの取得を試み、存在しなければ作成する
   */
  static FindOrCreate = async <Init extends RoomInit>(
    context: SkyWayContext,
    init: Init
  ) => {
    const plugin = new SfuBotPlugin((init as SfuRoomInit)?.options?.sfu);
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.FindOrCreate(context, {
      ...init,
    });
    const room = await SkyWayRoom._Factory(
      context,
      init.type,
      channel as SkyWayChannelImpl
    );
    return room as Init['type'] extends 'p2p' ? P2PRoom : SfuRoom;
  };

  private static _Factory = async (
    context: SkyWayContext,
    roomType: RoomType,
    channel: SkyWayChannelImpl
  ): Promise<P2PRoom | SfuRoom> => {
    switch (roomType) {
      case 'p2p':
        return new P2PRoomImpl(channel) as P2PRoom;
      case 'sfu':
        return (await SfuRoomImpl.Create(context, channel)) as SfuRoom;
      default:
        throw createError({
          operationName: 'SkyWayRoom._Factory',
          context,
          channel,
          info: errors.notImplemented,
          path: log.prefix,
        });
    }
  };
}

export type RoomInit = P2PRoomInit | SfuRoomInit;

export type RoomInitBase = {
  name?: string;
  metadata?: string;
  type: RoomType;
};

export type P2PRoomInit = RoomInitBase & {
  type: 'p2p';
};

export type SfuRoomOptions = { sfu: Partial<SfuBotPluginOptions> };

export type SfuRoomInit = RoomInitBase & {
  type: 'sfu';
  options?: Partial<SfuRoomOptions>;
};

export const roomTypes = ['sfu', 'p2p'] as const;
export type RoomType = (typeof roomTypes)[number];
