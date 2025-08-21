// Simple Node.js inference worker using tfjs-node and coco-ssd
// Listens for frames forwarded via the signaling WebSocket and sends back detection messages.
// Expected incoming frame message format (example):
// { type: 'frame', payload: { frame_id, image_b64 } }

const WebSocket = require('ws');
const tf = require('@tensorflow/tfjs-node');
const cocoSsd = require('@tensorflow-models/coco-ssd');
// Avoid 'canvas' native dependency on Windows by using tf.node.decodeImage instead

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:8080';
const USE_GPU = process.env.TFJS_NODE_GPU === '1';

let model = null;

async function loadModel() {
  console.log('Loading COCO-SSD model (tfjs-node)...');
  model = await cocoSsd.load();
  console.log('Model loaded');
}

function normalizeBoxes(predictions, width, height) {
  return predictions.map(p => {
    const [x, y, w, h] = p.bbox;
    return {
      label: p.class,
      score: p.score,
      xmin: x / width,
      ymin: y / height,
      xmax: (x + w) / width,
      ymax: (y + h) / height
    };
  });
}

async function imageFromBase64(b64) {
  // b64 can be either a dataURL or raw base64
  let raw = b64;
  if (raw.startsWith('data:')) {
    raw = raw.split(',')[1];
  }
  const buf = Buffer.from(raw, 'base64');
  return buf; // return raw buffer; we'll decode with tf.node.decodeImage
}

async function runInferenceOnImageBuffer(b64, frameId) {
  try {
    const buf = await imageFromBase64(b64);

    // Decode image buffer into a Tensor3D [height, width, channels] using tf.node
    // This avoids needing the native 'canvas' package.
    const input = tf.node.decodeImage(buf, 3); // channels = 3 (RGB)
    const shape = input.shape; // [height, width, channels]
    const height = shape[0];
    const width = shape[1];

    const start = Date.now();
  // coco-ssd's detect accepts a Tensor3D in Node when using tfjs-node
  const predictions = await model.detect(input);
    const inferenceTs = Date.now();
    input.dispose();

    const normalized = normalizeBoxes(predictions, width, height);
    return { frame_id: frameId, capture_ts: Date.now(), inference_ts: inferenceTs, detections: normalized };
  } catch (e) {
    console.error('Error in runInferenceOnImageBuffer:', e);
    return null;
  }
}

async function start() {
  // Load model first
  await loadModel();

  const ws = new WebSocket(SIGNALING_URL);

  ws.on('open', () => {
    console.log('Connected to signaling server at', SIGNALING_URL);
    // Announce ourselves (optional)
    ws.send(JSON.stringify({ type: 'role', payload: { role: 'inference_worker' } }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'frame') {
        const payload = msg.payload || msg;
        const frameId = payload.frame_id || (Date.now() + '-' + Math.round(Math.random()*1000));
        console.log('Received frame for inference:', frameId);
        const result = await runInferenceOnImageBuffer(payload.image_b64, frameId);
        if (result) {
          // send detection back via signaling server so it can broadcast and stamp recv_ts
          ws.send(JSON.stringify({ type: 'detection', payload: result }));
          console.log('Sent detection for frame', frameId);
        }
      }
    } catch (e) {
      console.error('Error parsing message in inference worker:', e);
    }
  });

  ws.on('close', () => {
    console.log('Signaling connection closed; exiting inference worker');
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('Signaling WS error in inference worker:', err);
  });
}

start().catch(e => {
  console.error('Failed to start inference worker:', e);
  process.exit(1);
});
