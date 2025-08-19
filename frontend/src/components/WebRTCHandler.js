import Peer from 'simple-peer';

export class WebRTCHandler {
  constructor(stream, onConnect, onData) {
    this.peer = null;
    this.stream = stream;
    this.onConnect = onConnect;
    this.onData = onData;
  }

  initializePeer(initiator = false) {
    this.peer = new Peer({
      initiator,
      trickle: false,
      stream: this.stream
    });

    this.peer.on('signal', data => {
      // Send the signaling data to the other peer
      console.log('Signal data:', data);
      this.onData(JSON.stringify(data));
    });

    this.peer.on('connect', () => {
      console.log('Peer connected');
      this.onConnect();
    });

    this.peer.on('stream', stream => {
      console.log('Received stream');
      const video = document.querySelector('video');
      if (video) {
        video.srcObject = stream;
        video.play().catch(e => console.error('Error playing video:', e));
      }
    });

    this.peer.on('error', err => console.error('Peer error:', err));
  }

  signal(data) {
    if (this.peer) {
      this.peer.signal(data);
    }
  }

  destroy() {
    if (this.peer) {
      this.peer.destroy();
    }
  }
}
