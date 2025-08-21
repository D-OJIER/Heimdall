import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
// WASM backend support
import '@tensorflow/tfjs-backend-wasm';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';


const ObjectDetection = ({ videoStream, sendDetectionToPeer, remoteDetections, onBackendChange, enableLocalDetection = true }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [model, setModel] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [backend, setBackend] = useState('');

  // Load the COCO-SSD model
  useEffect(() => {
    const loadModel = async () => {
      try {
        if (!enableLocalDetection) {
          // Server mode (YOLO) - dispose any local model
          console.log('Server mode active - using YOLO for inference');
          try {
            if (model && model.dispose) {
              model.dispose();
            }
          } catch (e) {
            // ignore dispose errors
          }
          setModel(null);
          setBackend('server');
          if (onBackendChange) onBackendChange('server');
          return;
        }

        console.log('Local mode - loading COCO-SSD with WASM backend');

        // Always use WASM backend for local COCO-SSD
        try {
          setWasmPaths('/wasm/');
          const wasmTest = await fetch('/wasm/tfjs-backend-wasm.wasm', { method: 'GET' });
          if (!wasmTest.ok) {
            throw new Error('WASM file not available - check /wasm/tfjs-backend-wasm.wasm');
          }
          await tf.setBackend('wasm');
          await tf.ready();
          console.log('TFJS WASM backend ready for COCO-SSD');
        } catch (e) {
          console.error('Failed to set up WASM backend:', e);
          alert('WASM setup failed - check console and ensure /wasm/ files are served');
          return; // don't proceed without WASM
        }

        const loadedModel = await cocoSsd.load();
        setModel(loadedModel);
        // Expose tf to the window for easy debugging in the browser console
        try {
          if (typeof window !== 'undefined' && !window.tf) window.tf = tf;
        } catch (e) {
          // ignore in non-browser environments
        }
        const backendName = tf.getBackend ? tf.getBackend() : '';
        setBackend(backendName);
        if (onBackendChange) onBackendChange(backendName);
        console.log('COCO-SSD Model loaded successfully on backend', backendName);
      } catch (error) {
        console.error('Error loading COCO-SSD model:', error);
      }
    };

  loadModel();
  }, [onBackendChange, enableLocalDetection]);

  // Set up video stream with error handling and reconnection logic
  useEffect(() => {
    if (!videoRef.current) return;

    const videoElement = videoRef.current;
    
    const setupVideo = async () => {
      try {
        if (videoStream) {
          console.log('Setting up new video stream...');
          videoElement.srcObject = videoStream;
          
          // Wait for the video to be ready
          await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error('Video load timeout')), 5000);
            
            videoElement.onloadedmetadata = () => {
              clearTimeout(timeoutId);
              console.log('Video metadata loaded:', {
                width: videoElement.videoWidth,
                height: videoElement.videoHeight,
                readyState: videoElement.readyState
              });
              resolve();
            };
          });

          // Attempt to play the video
          try {
            await videoElement.play();
            console.log('Video playback started successfully');
          } catch (playErr) {
            console.warn('Video.play() failed:', playErr);
            // Log current readyState and srcObject
            console.log('video.readyState:', videoElement.readyState, 'srcObject:', !!videoElement.srcObject);
          }
          
          // Monitor video track status
          const videoTrack = videoStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.onended = () => {
              console.log('Video track ended');
            };
            videoTrack.onmute = () => {
              console.log('Video track muted');
            };
            videoTrack.onunmute = () => {
              console.log('Video track unmuted');
            };
          }
        } else {
          console.log('No video stream available');
          videoElement.srcObject = null;
        }
      } catch (error) {
        console.error('Error setting up video:', error);
        // Attempt recovery
        setTimeout(setupVideo, 1000);
      }
    };

    setupVideo();

    // Cleanup function
    return () => {
      if (videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        videoElement.srcObject = null;
      }
    };
  }, [videoStream]);

  // When local detection is disabled (server mode), periodically capture frames and POST to server for inference
  useEffect(() => {
    if (enableLocalDetection) return;
    if (!videoRef.current) return;

  let stopped = false;
  const captureInterval = 250; // ms (reduced from 700 -> faster updates)
  let inflight = false; // prevent overlapping requests

  // build infer host from Vite env or fallback to page hostname
  const envInferHost = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_INFER_HOST) || null;
  const inferHost = envInferHost || `${window.location.protocol}//${window.location.hostname}:8000`;

  const sendFrame = async () => {
      if (stopped) return;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2) {
          setTimeout(sendFrame, captureInterval);
          return;
        }

        // draw to an offscreen canvas at smaller size to reduce bandwidth and latency
        const off = document.createElement('canvas');
        const w = 320; const h = Math.round((video.videoHeight / video.videoWidth) * w) || 240;
        off.width = w; off.height = h;
        const ctx = off.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        const b64 = off.toDataURL('image/jpeg', 0.6);
        const frameId = `frame-${Date.now()}-${Math.round(Math.random()*1000)}`;

  // send to server infer endpoint
  const url = `${inferHost.replace(/\/$/, '')}/infer_frame`;
        // avoid sending if still waiting for previous inference result
        if (inflight) {
          // schedule next attempt
          setTimeout(sendFrame, captureInterval);
          return;
        }
        inflight = true;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame_id: frameId, image_b64: b64 })
        }).catch(err => console.warn('Failed to send frame to server infer endpoint:', err))
        .finally(() => { inflight = false; });
      } catch (e) {
        console.error('Error capturing frame for server inference:', e);
      } finally {
        setTimeout(sendFrame, captureInterval);
      }
    };

    sendFrame();

    return () => { stopped = true; };
  }, [enableLocalDetection, videoRef.current]);

  // Add event listeners for video element
  useEffect(() => {
    if (!videoRef.current) return;

    const videoElement = videoRef.current;
    
    const handlers = {
      waiting: () => console.log('Video buffering...'),
      playing: () => console.log('Video playback resumed'),
      stalled: () => console.log('Video playback stalled'),
      suspend: () => console.log('Video loading suspended'),
      error: (e) => console.error('Video error:', e)
    };

    // Add all event listeners
    Object.entries(handlers).forEach(([event, handler]) => {
      videoElement.addEventListener(event, handler);
    });

    // Cleanup
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        videoElement.removeEventListener(event, handler);
      });
    };
  }, []);

  // Detect objects in the video stream
  useEffect(() => {
    if (!enableLocalDetection) return; // do not run detection loop when local detection disabled
    if (!model || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

  let rafId = null;
  const detectObjects = async () => {
      if (!isDetecting) return;

      // Make sure video is ready and playing
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Detect objects in the current frame
        const captureTs = Date.now();
        const predictions = await model.detect(video);

        // Clear previous drawings
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Draw video frame
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert predictions into normalized format [0..1]
        const normalized = predictions.map(pred => {
          const [x, y, w, h] = pred.bbox;
          return {
            label: pred.class,
            score: pred.score,
            xmin: x / canvas.width,
            ymin: y / canvas.height,
            xmax: (x + w) / canvas.width,
            ymax: (y + h) / canvas.height
          };
        });

        // Draw local predictions (green)
        context.strokeStyle = '#00ff00';
        context.lineWidth = 2;
        context.fillStyle = '#00ff00';
        context.font = '16px Arial';
        predictions.forEach(prediction => {
          context.strokeRect(
            prediction.bbox[0],
            prediction.bbox[1],
            prediction.bbox[2],
            prediction.bbox[3]
          );
          context.fillText(
            `${prediction.class} (${Math.round(prediction.score * 100)}%)`,
            prediction.bbox[0],
            prediction.bbox[1] - 5
          );
        });

        // If this component is the local (mobile) capture and a send handler is provided, send normalized detections
        if (sendDetectionToPeer && normalized.length > 0) {
          try {
            const frameId = `${captureTs}-${Math.round(Math.random()*1000)}`;
            const message = {
              frame_id: frameId,
              capture_ts: captureTs,
              // recv_ts will be set by the server when forwarded; inference_ts is best-effort here
              inference_ts: Date.now(),
              detections: normalized
            };
            // Send (via WebRTC datachannel preferred) or fallback to WS
            sendDetectionToPeer(message);
          } catch (e) {
            console.error('Error sending detection to peer:', e);
          }
        }

        // Draw any remote detections (blue) that match this frame or recent frames
        if (remoteDetections && Array.isArray(remoteDetections)) {
          // Find detections within a short window (e.g., last 2s) or same frame_id
          const now = Date.now();
          const candidates = remoteDetections.filter(d => {
            if (!d || !d.capture_ts) return false;
            // Accept if within 2000ms or matching frame_id
            return (d.frame_id && d.frame_id.startsWith(String(captureTs))) || Math.abs(now - d.capture_ts) < 2000;
          });
          candidates.forEach(detMsg => {
            if (!detMsg.detections) return;
            context.strokeStyle = '#0000ff';
            context.lineWidth = 2;
            context.fillStyle = '#0000ff';
            detMsg.detections.forEach(pred => {
              const x = pred.xmin * canvas.width;
              const y = pred.ymin * canvas.height;
              const w = (pred.xmax - pred.xmin) * canvas.width;
              const h = (pred.ymax - pred.ymin) * canvas.height;
              context.strokeRect(x, y, w, h);
              context.fillText(`${pred.label} (${Math.round(pred.score*100)}%)`, x, y - 5);
            });
          });
        }
      }

      // Request next frame
      rafId = requestAnimationFrame(detectObjects);
    };

  setIsDetecting(true);
  detectObjects();

  return () => {
    setIsDetecting(false);
    if (rafId) cancelAnimationFrame(rafId);
    // attempt to release TFJS tensors if any
    try {
      if (window.tf && window.tf.engine && window.tf.engine().disposeVariables) {
        // best-effort cleanup
        window.tf.engine().disposeVariables && window.tf.engine().disposeVariables();
      }
    } catch (e) {}
  };
  }, [model, videoStream]);

  return (
    <div style={{ position: 'relative', width: '320px', height: '240px', margin: '0 auto' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1
        }}
      />
  {/* Backend display (only for local/capture mode) */}
  {enableLocalDetection && typeof sendDetectionToPeer === 'function' && backend && (
        <div style={{
          position: 'absolute',
          bottom: 4,
          right: 8,
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '6px',
          fontSize: '13px',
          zIndex: 2
        }}>
          Backend: {backend.toUpperCase()}
          {model ? <span style={{ marginLeft: 8 }}>• Model: COCO-SSD</span> : null}
        </div>
      )}

  {/* Model status badge for server-mode */}
  {!enableLocalDetection && (
    <ModelStatusBadge inferHost={(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_INFER_HOST) || null} />
  )}
    </div>
  );
};

export default ObjectDetection;


// Small component that polls /model_status and shows which model is loaded
function ModelStatusBadge({ inferHost = null }) {
  const [status, setStatus] = useState('unknown');
  const [cpu, setCpu] = useState(null);
  const [modelName, setModelName] = useState(null);
  const host = inferHost || `${window.location.protocol}//${window.location.hostname}:8000`;

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${host.replace(/\/$/, '')}/model_status`);
        if (!res.ok) throw new Error('model_status fetch failed');
        const j = await res.json();
  setStatus(j.loaded_model_type || 'none');
  setCpu(j.cpu_percent ?? null);
  setModelName(j.model_name ?? null);
      } catch (e) {
        setStatus('none');
  setCpu(null);
      } finally {
        setTimeout(poll, 2000);
      }
    };
    poll();
    return () => { stopped = true; };
  }, [host]);

  const color = status === 'onnx' ? '#28a745' : status === 'pt' ? '#007bff' : '#666';

  // Display both model and processing location + CPU when in server-mode
  const processingText = status && status !== 'none' ? `SERVER${cpu !== null ? ` (CPU ${cpu}%)` : ''}` : 'NONE';

  // derive friendly family name
  let family = null;
  if (modelName) {
    const lower = modelName.toLowerCase();
    if (lower.includes('yolo') || lower.includes('yolov5') || lower.includes('yolov4')) family = 'YOLO';
    else if (lower.includes('coco') || lower.includes('ssd')) family = 'COCO-SSD';
    else if (lower.endsWith('.onnx')) family = 'ONNX Model';
    else family = modelName;
  } else if (status === 'pt') {
    family = 'PyTorch Model';
  }

  return (
    <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 3, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ background: color, color: '#fff', padding: '4px 8px', borderRadius: 6, fontSize: 12 }}>
        Model: {String(status).toUpperCase()}{modelName ? ` • ${modelName}` : ''}{family ? ` (${family})` : ''}
      </div>
      <div style={{ background: '#222', color: '#fff', padding: '4px 8px', borderRadius: 6, fontSize: 12 }}>
        Processing: {processingText}
      </div>
    </div>
  );
}
