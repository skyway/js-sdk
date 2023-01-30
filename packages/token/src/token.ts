import { AppScope } from './scope/app';

export type AuthToken = {
  /**uuid */
  jti: string;
  /**seconds */
  iat: number;
  /**seconds */
  exp: number;
  scope: {
    app: AppScope;
  };
};
