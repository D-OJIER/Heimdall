import Peer from 'simple-peer';

class WebRTCHandler {
  constructor(stream, onStream, onConnect, onMessage, onDetection) {
    this.peer = null;
    this.stream = stream;
    this.onStream = onStream;
    this.onConnect = onConnect;
    this.onMessage = onMessage;
    this.onDetection = onDetection;
    this.ws = null;
    this.wsUrl = null;
    this.isInitiator = false;
    this.clientId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
  }

  connect(wsUrl) {
    this.wsUrl = wsUrl;
    if (this.ws) {
      // Close existing connection before creating a new one
      this.ws.close();
      this.ws = null;
    }
    this.establishConnection();
  }

  establishConnection() {
    if (this.connected || this.reconnectAttempts >= this.maxReconnectAttempts) return;

    try {
      console.log('Connecting to WebSocket server at:', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.onopen = () => {
        console.log('Connected to signaling server');
        this.connected = true;
        this.reconnectAttempts = 0;
        
        // Keep connection alive
        this._startPing();
        
        // Declare our role
        this.isInitiator = !!this.stream;
        this.sendToServer({
          type: 'role',
          payload: { role: this.isInitiator ? 'initiator' : 'receiver' }
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect();
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.handleDisconnect();
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.handleDisconnect();
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'id':
        this.clientId = message.id;
        console.log('Received client ID:', this.clientId);
        this.createPeer();
        break;
      
      case 'signal':
        if (message.from !== this.clientId) {
          console.log('Received signal from peer:', message.from);
          // Accept payload in multiple possible forms. Some servers wrap the signal inside `payload.payload` etc.
          let incoming = message.payload !== undefined ? message.payload : message.data;
          // unwrap nested payloads up to a couple levels
          for (let i = 0; i < 3; i++) {
            if (incoming && typeof incoming === 'object' && incoming.payload !== undefined) incoming = incoming.payload;
          }
          if (!incoming) {
            console.warn('Signal message missing payload/data');
            break;
          }
          if (this.peer) {
            try {
              console.log('Applying signal to peer; incoming keys:', incoming && typeof incoming === 'object' ? Object.keys(incoming) : typeof incoming);
              // Basic validation: incoming should be an object with sdp or candidate or type keys
              const isValidSignal = incoming && typeof incoming === 'object' && (
                incoming.sdp !== undefined || incoming.type !== undefined || incoming.candidate !== undefined || incoming.renegotiate !== undefined
              );
              if (!isValidSignal) {
                console.warn('Discarding invalid signal payload:', incoming);
              } else {
                this.peer.signal(incoming);
              }
            } catch (e) {
              console.error('Error handling signal:', e, 'incoming:', incoming);
              this.resetPeer();
            }
          } else {
            // No peer yet — store and apply after peer is created
            this._pendingSignal = incoming;
            console.log('Stored pending signal until peer is created');
          }
        }
        break;

      case 'clients':
        console.log('Connected clients:', message.clients);
        break;

      case 'role':
        // role messages forwarded from other peers
        console.log('Role message received from', message.from, message.payload || message.role || message.data);
        break;

      case 'chat':
        // chat messages forwarded by server
        try {
          const text = (message.payload && message.payload.text) || (message.data && message.data.text) || null;
          if (text && this.onMessage) this.onMessage(text);
        } catch (e) {
          console.error('Error handling chat message:', e);
        }
        break;

      case 'detection':
        try {
          const det = message.payload || message.data || message;
          console.log('Received detection message from', message.from, det && det.frame_id);
          if (this.onDetection) this.onDetection(det);
        } catch (e) {
          console.error('Error handling detection message:', e);
        }
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  handleDisconnect() {
    if (!this.connected) return; // Avoid handling disconnect multiple times
    
    this.connected = false;
    this.reconnectAttempts++;
    this._stopPing();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
      setTimeout(() => this.establishConnection(), this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)); // Exponential backoff
    } else {
      console.log('Max reconnection attempts reached');
    }
  }

  _startPing() {
    this._stopPing(); // Clear any existing interval
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendToServer({ type: 'ping' });
      }
    }, 20000); // Ping every 20 seconds
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  sendToServer(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (e) {
        console.error('Error sending to server:', e);
      }
    }
  }

  // Fallback: send a chat message over signaling WebSocket
  sendChat(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.sendToServer({ type: 'chat', payload: { text } });
        return true;
      } catch (e) {
        console.error('Error sending chat via WS:', e);
        return false;
      }
    }
    return false;
  }

  createPeer() {
    if (this.peer) return;

    try {
      const peerOptions = {
        initiator: this.isInitiator,
        trickle: false,
        stream: this.stream || undefined,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      };

      this.peer = new Peer(peerOptions);

      this.peer.on('signal', data => {
        // Send the raw signal payload under `payload` so the server forwards it unchanged
        this.sendToServer({
          type: 'signal',
          payload: data
        });
      });

      this.peer.on('connect', () => {
        console.log('Peer connection established!');
        if (this.onConnect) this.onConnect();
      });

      this.peer.on('stream', stream => {
        console.log('Received peer stream:', stream.id, 'tracks:', stream.getTracks().length);
        // Check if stream has tracks
        if (stream.getTracks().length === 0) {
          console.warn('Received stream has no tracks');
          return;
        }
        
        // Ensure video track is active
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          console.log('Video track settings:', videoTrack.getSettings());
          videoTrack.onended = () => {
            console.log('Video track ended, attempting to reconnect...');
            this.resetPeer();
          };
        }

        if (this.onStream) this.onStream(stream);
      });

      this.peer.on('error', err => {
        console.error('Peer error:', err);
        // Only reset peer for non-fatal errors
        if (err.toString().includes('Connection failed') || 
            err.toString().includes('disconnected')) {
          this.resetPeer();
        }
      });

      this.peer.on('close', () => {
        console.log('Peer connection closed');
        this.resetPeer();
      });

      this.peer.on('data', data => {
        const str = data.toString();
        console.log('Received datachannel message:', str.slice(0, 200));
        try {
          const parsed = JSON.parse(str);
          // If it's a detection message (either raw or wrapped)
          if (parsed && (parsed.frame_id !== undefined && parsed.detections !== undefined)) {
            if (this.onDetection) this.onDetection(parsed);
            return;
          }
          if (parsed && parsed.type === 'detection' && parsed.payload) {
            if (this.onDetection) this.onDetection(parsed.payload);
            return;
          }
          // If it's a chat or raw message type
          if (parsed && parsed.type === 'chat' && parsed.payload && parsed.payload.text) {
            if (this.onMessage) this.onMessage(parsed.payload.text);
            return;
          }
          // Otherwise, if it's a plain object, forward stringified form to onMessage
          if (this.onMessage) this.onMessage(typeof parsed === 'object' ? JSON.stringify(parsed) : str);
        } catch (e) {
          // Not JSON: treat as raw text/chat
          if (this.onMessage) this.onMessage(str);
        }
      });
      // If we received a signal before peer was created, apply it now
      if (this._pendingSignal) {
        try {
          console.log('Applying pending signal after peer creation');
          this.peer.signal(this._pendingSignal);
        } catch (e) {
          console.error('Error applying pending signal:', e);
        }
        this._pendingSignal = null;
      }
    } catch (e) {
      console.error('Error creating peer:', e);
      this.resetPeer();
    }
  }

  sendMessage(message) {
    if (this.peer && this.peer.connected) {
      try {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        this.peer.send(payload);
        return true;
      } catch (e) {
        console.error('Error sending message:', e);
        return false;
      }
    }
    return false;
  }

  sendDetection(detectionObj) {
    // detectionObj must follow the contract: frame_id, capture_ts, inference_ts, detections[]
    try {
      const msg = typeof detectionObj === 'string' ? JSON.parse(detectionObj) : detectionObj;
      // Basic validation
      if (!msg || (msg.frame_id === undefined) || (msg.capture_ts === undefined) || !Array.isArray(msg.detections)) {
        console.warn('sendDetection: invalid detection object; required: frame_id, capture_ts, detections[]', msg);
        // still attempt to send so server can validate, but warn
      }

      // Always send detections via the signaling WebSocket so the server can add recv_ts
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendToServer({ type: 'detection', payload: msg });
        return true;
      } else {
        console.warn('sendDetection: WebSocket not open; cannot send detection.');
      }
    } catch (e) {
      console.error('Error in sendDetection:', e);
    }
    return false;
  }

  resetPeer() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    setTimeout(() => this.createPeer(), 2000);
  }

  disconnect() {
    this.connected = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
    
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export { WebRTCHandler };
