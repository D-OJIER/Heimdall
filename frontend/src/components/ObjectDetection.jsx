import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const ObjectDetection = ({ videoStream, sendDetectionToPeer, remoteDetections }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [model, setModel] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);

  // Load the COCO-SSD model
  useEffect(() => {
    const loadModel = async () => {
      try {
        const loadedModel = await cocoSsd.load();
        setModel(loadedModel);
        console.log('COCO-SSD Model loaded successfully');
      } catch (error) {
        console.error('Error loading COCO-SSD model:', error);
      }
    };

    loadModel();
  }, []);

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
          await videoElement.play();
          console.log('Video playback started successfully');
          
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
    if (!model || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

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
      requestAnimationFrame(detectObjects);
    };

    setIsDetecting(true);
    detectObjects();

    return () => setIsDetecting(false);
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
    </div>
  );
};

export default ObjectDetection;
