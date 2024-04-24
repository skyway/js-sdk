import { Logger, SkyWayError } from '@skyway-sdk/common';
import jsrsasign from 'jsrsasign';
import jwtDecode from 'jwt-decode';

import { AuthToken, tokenErrors } from '.';
import { AppScope } from './scope/app';

const log = new Logger('packages/token/src/encoder.ts');

export class SkyWayAuthToken implements AuthToken {
  /**uuid */
  jti!: string;
  /**seconds */
  iat!: number;
  /**seconds */
  exp!: number;
  readonly scope!: {
    readonly app: AppScope;
  };
  version?: number;
  tokenString?: string;

  constructor(props: AuthToken) {
    Object.assign(this, props);
  }

  static Decode(token: string): SkyWayAuthToken {
    try {
      const props: AuthToken = jwtDecode(token);
      const authToken = new SkyWayAuthToken(props);
      authToken.tokenString = token;
      return authToken;
    } catch (error: any) {
      throw new SkyWayError({
        path: log.prefix,
        info: tokenErrors.invalidParameter,
        error,
      });
    }
  }

  encode(secret: string) {
    const payload = {
      jti: this.jti,
      iat: this.iat,
      exp: this.exp,
      scope: this.scope,
      version: this.version,
    };
    this.tokenString = jsrsasign.KJUR.jws.JWS.sign(
      'HS256',
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      JSON.stringify(payload),
      secret
    );
    return this.tokenString;
  }

  /**@internal */
  toJSON() {
    return {
      jti: this.jti,
      iat: this.iat,
      exp: this.exp,
      scope: this.scope,
      encoded: this.tokenString,
      version: this.version,
    };
  }
}
