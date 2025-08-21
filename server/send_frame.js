// send_frame.js
// Usage: node send_frame.js <path-to-image>
// Sends a single frame (base64 data URL) as a `frame` message to the signaling server
// and prints any incoming messages (including detection responses).

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:8080';

if (process.argv.length < 3) {
  console.error('Usage: node send_frame.js <path-to-image>');
  process.exit(1);
}

const imgPath = process.argv[2];
if (!fs.existsSync(imgPath)) {
  console.error('File not found:', imgPath);
  process.exit(1);
}

const ext = path.extname(imgPath).toLowerCase();
let mime = 'image/jpeg';
if (ext === '.png') mime = 'image/png';
if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
if (ext === '.webp') mime = 'image/webp';

const buf = fs.readFileSync(imgPath);
const b64 = `data:${mime};base64,${buf.toString('base64')}`;

const ws = new WebSocket(SIGNALING_URL);

ws.on('open', () => {
  console.log('Connected to signaling server at', SIGNALING_URL);
  const frameId = `test-${Date.now()}`;
  const msg = { type: 'frame', payload: { frame_id: frameId, image_b64: b64 } };
  ws.send(JSON.stringify(msg));
  console.log('Sent frame', frameId);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    console.log('Received message:', JSON.stringify(msg, null, 2));
  } catch (e) {
    console.log('Received non-JSON message:', data.toString());
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('WebSocket closed');
});
