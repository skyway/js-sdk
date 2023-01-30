export class DataChannelNegotiationLabel {
  constructor(readonly publicationId: string, readonly streamId: string) {}

  static fromLabel(label: string) {
    const { p, s } = JSON.parse(label);
    return new DataChannelNegotiationLabel(p, s);
  }

  toLabel() {
    return JSON.stringify({
      p: this.publicationId,
      s: this.streamId,
    });
  }
}
