import { Logger } from '@skyway-sdk/common';
import {
  createError,
  SkyWayChannel,
  SkyWayChannelImpl,
  SkyWayContext,
} from '@skyway-sdk/core';
import {
  SFUApiOptions,
  SFUBotPlugin,
  SFUBotPluginOptions,
} from '@skyway-sdk/sfu-bot';

import { errors } from '../errors';
import { PACKAGE_VERSION } from '../version';
import { Room, RoomImpl } from './default';
import { P2PRoom, P2PRoomImpl } from './p2p';
import { SFURoom, SFURoomImpl } from './sfu';

const log = new Logger('packages/room/src/room/index.ts');

export type { SFUApiOptions, SFUBotPluginOptions };

export class SkyWayRoom {
  /**@private */
  constructor() {}

  /**
   * @description [japanese] Roomの作成
   * RoomInit.typeに応じてRoom, P2PRoom, SFURoomのいずれかとして作成する
   * - 'default'または未指定: Roomとして作成する
   * - 'p2p': P2PRoomとして作成する
   * - 'sfu': SFURoomとして作成する
   */
  static Create = async <Init extends RoomInit>(
    context: SkyWayContext,
    init: Init
  ): Promise<
    Init['type'] extends 'p2p'
      ? P2PRoom
      : Init['type'] extends 'sfu'
      ? SFURoom
      : Room
  > => {
    log.info('room created', {
      operationName: 'SkyWayRoom._Factory',
      sdkName: 'room',
      sdkVersion: PACKAGE_VERSION,
      init,
    });

    const plugin = new SFUBotPlugin(
      (init as SFURoomInit | DefaultRoomInit)?.sfuOptions
    );
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.Create(context, {
      name: init.name,
      metadata: init.metadata,
    });
    const room = await SkyWayRoom._Factory(
      context,
      channel as SkyWayChannelImpl,
      init.type
    );

    return SkyWayRoom._castRoomType(room);
  };

  /**
   * @description [japanese] 既存のRoomの取得
   * FindOptions.typeに応じてRoom, P2PRoom, SFURoomのいずれかとして取得する
   * - 'default'または未指定: Roomとして取得する
   * - 'p2p': P2PRoomとして取得する
   * - 'sfu': SFURoomとして取得する
   */
  static Find = async <Options extends FindOptions>(
    context: SkyWayContext,
    query: { id?: string; name?: string },
    options?: Options
  ): Promise<
    Options['type'] extends 'p2p'
      ? P2PRoom
      : Options['type'] extends 'sfu'
      ? SFURoom
      : Room
  > => {
    const plugin = new SFUBotPlugin(
      (options as SFUFindOptions | DefaultFindOptions)?.sfuOptions
    );
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.Find(context, query);
    const roomType = options?.type;
    const room = await SkyWayRoom._Factory(
      context,
      channel as SkyWayChannelImpl,
      roomType
    );

    return SkyWayRoom._castRoomType(room);
  };

  /**
   * @description [japanese] Roomの取得を試み、存在しなければ作成する
   * RoomInit.typeに応じてRoom, P2PRoom, SFURoomのいずれかとして作成または取得する
   * - 'default'または未指定: Roomとして作成または取得する
   * - 'p2p': P2PRoomとして作成または取得する
   * - 'sfu': SFURoomとして作成または取得する
   */
  static FindOrCreate = async <Init extends RoomInit>(
    context: SkyWayContext,
    init: Init
  ): Promise<
    Init['type'] extends 'p2p'
      ? P2PRoom
      : Init['type'] extends 'sfu'
      ? SFURoom
      : Room
  > => {
    const plugin = new SFUBotPlugin(
      (init as SFURoomInit | DefaultRoomInit)?.sfuOptions
    );
    context.registerPlugin(plugin);

    const channel = await SkyWayChannel.FindOrCreate(context, {
      ...init,
    });
    const room = await SkyWayRoom._Factory(
      context,
      channel as SkyWayChannelImpl,
      init.type
    );

    return SkyWayRoom._castRoomType(room);
  };

  private static _Factory = async (
    context: SkyWayContext,
    channel: SkyWayChannelImpl,
    roomType?: RoomType
  ): Promise<P2PRoom | SFURoom | Room> => {
    const type = roomType ?? 'default';

    switch (type) {
      case 'p2p':
        return new P2PRoomImpl(channel) as P2PRoom;
      case 'sfu':
        return (await SFURoomImpl.Create(context, channel)) as SFURoom;
      case 'default':
        return (await RoomImpl.Create(context, channel)) as Room;
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

  private static _castRoomType = (room: P2PRoom | SFURoom | Room) => {
    return room as RoomType extends 'p2p'
      ? P2PRoom
      : RoomType extends 'sfu'
      ? SFURoom
      : Room;
  };
}

export type RoomInit = P2PRoomInit | SFURoomInit | DefaultRoomInit;

export type RoomInitBase = {
  name?: string;
  metadata?: string;
  type?: RoomType;
};

// typeがない場合はDefaultRoomInitとして扱う
export type P2PRoomInit = RoomInitBase & {
  type: 'p2p';
};

export type SFURoomInit = RoomInitBase & {
  type: 'sfu';
  sfuOptions?: Partial<SFUBotPluginOptions>;
};

export type DefaultRoomInit = RoomInitBase & {
  type?: 'default';
  sfuOptions?: Partial<SFUBotPluginOptions>;
};

/**
 * @description [japanese] Findによって取得したRoomに対する設定
 */
export type FindOptions = P2PFindOptions | SFUFindOptions | DefaultFindOptions;

export type P2PFindOptions = {
  type: 'p2p';
};

export type SFUFindOptions = {
  type: 'sfu';
  sfuOptions?: Partial<SFUBotPluginOptions>;
};

export type DefaultFindOptions = {
  type?: 'default';
  sfuOptions?: Partial<SFUBotPluginOptions>;
};

export const roomTypes = ['sfu', 'p2p', 'default'] as const;
export type RoomType = (typeof roomTypes)[number];
