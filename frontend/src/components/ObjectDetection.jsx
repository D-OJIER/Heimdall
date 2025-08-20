import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const ObjectDetection = ({ videoStream }) => {
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
        const predictions = await model.detect(video);

        // Clear previous drawings
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Draw video frame
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Draw predictions
        predictions.forEach(prediction => {
          // Draw bounding box
          context.strokeStyle = '#00ff00';
          context.lineWidth = 2;
          context.strokeRect(
            prediction.bbox[0],
            prediction.bbox[1],
            prediction.bbox[2],
            prediction.bbox[3]
          );

          // Draw label
          context.fillStyle = '#00ff00';
          context.font = '16px Arial';
          context.fillText(
            `${prediction.class} (${Math.round(prediction.score * 100)}%)`,
            prediction.bbox[0],
            prediction.bbox[1] - 5
          );
        });
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
