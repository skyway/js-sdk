import type { Member } from '.';

export interface Person extends Member {
  readonly type: 'person';
  readonly subtype: 'person';
}
