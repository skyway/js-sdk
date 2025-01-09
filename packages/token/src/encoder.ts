import { Logger, SkyWayError } from '@skyway-sdk/common';
import jsrsasign from 'jsrsasign';
import jwtDecode from 'jwt-decode';
import { z } from 'zod';

// import { fromZodError } from 'zod-validation-error'; // 下記にかいてある理由によりコメントアウト
import {
  AuthToken,
  AuthTokenSchema,
  AuthTokenV1_2,
  AuthTokenV3,
  tokenErrors,
} from '.';

const log = new Logger('packages/token/src/encoder.ts');

export class SkyWayAuthToken {
  /**uuid */
  jti!: AuthToken['jti'];
  /**seconds */
  iat!: AuthToken['iat'];
  /**seconds */
  exp!: AuthToken['exp'];
  readonly scope!: AuthToken['scope'];
  version?: AuthToken['version'];
  tokenString?: string;

  constructor(props: AuthToken) {
    let parsedProps: AuthToken;
    try {
      parsedProps = AuthTokenSchema.parse(props);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // TODO: zod-validation-errorを利用するとkarmaでエラーが発生するため，今後エラーメッセージ生成の対応をする
        /**
        const validationError = fromZodError(error);
        throw new SkyWayError({
          path: log.prefix,
          info: {
            ...tokenErrors.invalidParameter,
            detail: validationError.toString(), // detailをzodでのvalidationエラーに変更
          },
          error: validationError,
        });
        */

        throw new SkyWayError({
          path: log.prefix,
          info: tokenErrors.invalidParameter,
          error: new Error(
            'Received invalid token. Please check your SkyWayAuthToken.'
          ),
        });
      } else {
        throw new SkyWayError({
          path: log.prefix,
          info: tokenErrors.invalidParameter,
          error: new Error(
            'Received invalid token. Please check your SkyWayAuthToken.'
          ),
        });
      }
    }
    Object.assign(this, parsedProps);
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

  /**@internal */
  getAppId(): string {
    switch (this.version) {
      case undefined:
      case 1:
      case 2: {
        const scope = this.scope as AuthTokenV1_2['scope'];
        return scope.app.id;
      }
      case 3: {
        const scope = this.scope as AuthTokenV3['scope'];
        return scope.appId;
      }
      default:
        throw new SkyWayError({
          path: log.prefix,
          info: tokenErrors.invalidParameter,
          error: new Error(
            `invalid token version: version ${this.version} is not supported.`
          ),
        });
    }
  }

  /**@internal */
  getAnalyticsEnabled(): boolean {
    switch (this.version) {
      case undefined:
      case 1:
      case 2: {
        const scope = this.scope as AuthTokenV1_2['scope'];
        return scope.app.analytics ?? false;
      }
      case 3: {
        const scope = this.scope as AuthTokenV3['scope'];
        return scope.analytics?.enabled ?? true;
      }
      default:
        throw new SkyWayError({
          path: log.prefix,
          info: tokenErrors.invalidParameter,
          error: new Error(
            `invalid token version: version ${this.version} is not supported.`
          ),
        });
    }
  }
}
