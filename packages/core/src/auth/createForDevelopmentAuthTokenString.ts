import { type ScopeV3, SkyWayAuthToken, uuidV4 } from '@skyway-sdk/token';

const TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24;

function createForDevelopmentScopeV3(appId: string): ScopeV3 {
  return {
    appId,
    rooms: [
      {
        name: '*',
        methods: ['create', 'close', 'updateMetadata'],
        member: {
          name: '*',
          methods: ['publish', 'subscribe', 'updateMetadata'],
        },
      },
    ],
  };
}

export function createForDevelopmentAuthTokenString({
  appId,
  secretKey,
}: {
  appId: string;
  secretKey: string;
}): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_EXPIRES_IN_SECONDS;

  const token = new SkyWayAuthToken({
    jti: uuidV4(),
    iat,
    exp,
    version: 3,
    scope: createForDevelopmentScopeV3(appId),
  });

  return token.encode(secretKey);
}
