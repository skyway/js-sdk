import { attachElement, ContentType, detachElement } from '../base';
import { RemoteStreamBase } from './base';

export abstract class RemoteMediaStreamBase extends RemoteStreamBase {
  private _element?: HTMLVideoElement | HTMLAudioElement;
  constructor(
    readonly id: string,
    readonly contentType: ContentType,
    readonly track: MediaStreamTrack
  ) {
    super(id, contentType);
  }

  /**
   * @deprecated
   * @use {@link Publication.state}
   */
  get isEnabled() {
    return this.track.enabled;
  }

  /**@internal */
  setIsEnabled(b: boolean) {
    this.track.enabled = b;
  }

  /**
   * @description [english] Attach the stream to the element.
   * @description [japanese] streamをelementに適用する.
   */
  attach(element: HTMLVideoElement | HTMLAudioElement) {
    this._element = element;
    attachElement(element, this.track);
  }

  /**
   * @description [english] Detach the stream from the element.
   * @description [japanese] elementからstreamを取り除く.
   */
  detach() {
    if (this._element) {
      detachElement(this._element, this.track);
      this._element = undefined;
    }
  }
}
