const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());

// Provide a simple helper that returns the machine's LAN IPv4 address
// so the frontend can build a QR code linking to the dev server.
app.get('/api/ip', (req, res) => {
    const nets = os.networkInterfaces();
    let ip = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ip = net.address;
                return res.json({ ip });
            }
        }
    }
    res.json({ ip });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    handleProtocols: () => 'json',
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        }
    }
});

// Add a basic route to test if server is running
app.get('/', (req, res) => {
    res.send('Signaling server is running');
});

const peers = new Map();

// Validate detection payloads conform to the expected schema
function validateDetectionPayload(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload must be an object' };
    if (payload.frame_id === undefined) return { ok: false, reason: 'missing frame_id' };
    if (typeof payload.capture_ts !== 'number') return { ok: false, reason: 'capture_ts must be a number (ms since epoch)' };
    if (typeof payload.inference_ts !== 'number') return { ok: false, reason: 'inference_ts must be a number (ms since epoch)' };
    if (!Array.isArray(payload.detections)) return { ok: false, reason: 'detections must be an array' };
    for (let i = 0; i < payload.detections.length; i++) {
        const d = payload.detections[i];
        if (!d || typeof d !== 'object') return { ok: false, reason: `detection[${i}] must be an object` };
        if (typeof d.label !== 'string') return { ok: false, reason: `detection[${i}].label must be a string` };
        if (typeof d.score !== 'number' || d.score < 0 || d.score > 1) return { ok: false, reason: `detection[${i}].score must be a number in [0,1]` };
        const keys = ['xmin','ymin','xmax','ymax'];
        for (const k of keys) {
            if (typeof d[k] !== 'number' || d[k] < 0 || d[k] > 1) return { ok: false, reason: `detection[${i}].${k} must be number in [0,1]` };
        }
        if (!(d.xmin < d.xmax && d.ymin < d.ymax)) return { ok: false, reason: `detection[${i}] box coordinates invalid (xmin<xmax and ymin<ymax required)` };
    }
    return { ok: true };
}

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection from:', req.socket.remoteAddress);
    
    const peerId = Math.random().toString(36).slice(2);
    peers.set(peerId, ws);
    console.log(`Client ${peerId} connected. Total peers: ${peers.size}`);

    // Set up ping-pong to keep connection alive
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type, 'from:', peerId);
            if (data.type === 'chat') {
                console.log('Chat payload:', data.payload && data.payload.text ? data.payload.text : '(no text)');
            }
            
            // If this is a detection message, validate payload before broadcasting
            if (data.type === 'detection') {
                const payload = data.payload !== undefined ? data.payload : data;
                const v = validateDetectionPayload(payload);
                if (!v.ok) {
                    console.warn('Invalid detection payload from', peerId, v.reason);
                    try {
                        ws.send(JSON.stringify({ type: 'error', code: 'invalid_detection', reason: v.reason }));
                    } catch (e) {
                        console.error('Failed to send error to peer:', peerId, e);
                    }
                    return; // don't broadcast invalid payloads
                }
            }
            
            // Broadcast to all other peers. Forward the original payload under `payload` for consistent handling
            peers.forEach((peer, id) => {
                if (id !== peerId && peer.readyState === WebSocket.OPEN) {
                    try {
                        const forwarded = {
                            type: data.type,
                            from: peerId,
                            payload: data.payload !== undefined ? data.payload : data
                        };
                        // If this is a detection message, add server recv timestamp to help clients align frames
                        if (data.type === 'detection' && forwarded.payload && typeof forwarded.payload === 'object') {
                            try {
                                // create a shallow copy to avoid mutating the original payload reference
                                forwarded.payload = Object.assign({}, forwarded.payload, { recv_ts: Date.now() });
                            } catch (e) {
                                // ignore if payload is not mutable
                            }
                        }
                        // Log the forwarded payload keys for debugging
                        console.log('Forwarding', data.type, 'to', id, 'payloadKeys:', forwarded.payload && typeof forwarded.payload === 'object' ? Object.keys(forwarded.payload) : typeof forwarded.payload);
                        peer.send(JSON.stringify(forwarded));
                        console.log('Forwarded', data.type, 'message to peer:', id);
                    } catch (e) {
                        console.error('Failed to send to peer:', id, e);
                    }
                }
            });
        } catch (e) {
            console.error('Failed to handle message:', e);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error for peer', peerId, ':', error);
    });

    ws.on('close', () => {
        console.log(`Client ${peerId} disconnected`);
        peers.delete(peerId);
        console.log('Remaining peers:', peers.size);
    });

    // Send the peer its ID
    try {
        ws.send(JSON.stringify({ type: 'id', id: peerId }));
        console.log('Sent ID to peer:', peerId);
    } catch (e) {
        console.error('Failed to send ID to peer:', e);
    }
});

// Set up ping interval to detect stale connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating stale connection');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`WebSocket server URL: ws://localhost:${PORT}`);
});