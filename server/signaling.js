const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());

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
            
            // Broadcast to all other peers. Forward the original payload under `payload` for consistent handling
            peers.forEach((peer, id) => {
                if (id !== peerId && peer.readyState === WebSocket.OPEN) {
                    try {
                        const forwarded = {
                            type: data.type,
                            from: peerId,
                            payload: data.payload !== undefined ? data.payload : data
                        };
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