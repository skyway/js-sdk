class MockRTCRtpTransceiver {
  constructor() {
    this.receiver = {};
    this.sender = {};
  }
}

global.RTCPeerConnection = class MockRTCPeerConnection {
  addTransceiver() {
    return new MockRTCRtpTransceiver();
  }
};

global.navigator.mediaDevices = new EventTarget();
