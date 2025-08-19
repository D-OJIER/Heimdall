import React, { useRef, useEffect, useState } from "react";
import QRCode from "react-qr-code";

function getLocalUrl() {
  const host = window.location.hostname;
  const port = window.location.port;
  return `http://${host}:${port}`;
}

export default function App() {
  const videoRef = useRef(null);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    // Check if the device is mobile
    const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(mobile);

    if (mobile) {
      // This is the mobile device - start streaming
      startStreaming();
    } else {
      // This is the desktop - show QR code and set up receiver
      setQrUrl(getLocalUrl());
      
      // Set up broadcast channel receiver
      const bc = new BroadcastChannel('video-stream');
      bc.onmessage = (event) => {
        const img = document.getElementById('receiverImage');
        if (img) {
          img.src = event.data;
          img.style.display = 'block';
        }
      };

      return () => {
        bc.close();
      };
    }
  }, []);

  const startStreaming = async () => {
    try {
      const constraints = {
        video: {
          facingMode: "environment", // Use back camera
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        
        // Set up canvas for video capture
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 640;  // Reduced size for better performance
        canvas.height = 480;

        // Send video frames periodically
        setInterval(() => {
          if (videoRef.current && isStreaming) {
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            try {
              const frameData = canvas.toDataURL('image/jpeg', 0.5); // Reduced quality for performance
              // Use BroadcastChannel to send frame to all connected tabs
              const bc = new BroadcastChannel('video-stream');
              bc.postMessage(frameData);
            } catch (e) {
              console.error('Frame sending error:', e);
            }
          }
        }, 100); // 10 fps for better performance

        setIsStreaming(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError(`Camera access error: ${err.name} - ${err.message}`);
    }
  };

  return (
    <div style={{ textAlign: "center" }}>
      <h2>Heimdall: Phone Camera Stream</h2>
      <div style={{ margin: "20px" }}>
        {isMobile ? (
          // Mobile view - show camera stream
          <div>
            <h3>📱 Phone Camera View</h3>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ 
                width: "100%", 
                maxWidth: "720px", 
                border: "2px solid #2196f3",
                borderRadius: "8px",
                display: error ? "none" : "block",
                margin: "0 auto"
              }}
            />
            {isStreaming ? (
              <div style={{ margin: "20px", color: "green" }}>
                ✅ Camera is streaming
              </div>
            ) : (
              <div style={{ margin: "20px", color: "orange" }}>
                ⏳ Starting camera...
              </div>
            )}
          </div>
        ) : (
          // Desktop view - show receiving video and QR code
          <div>
            <h3>💻 Desktop View</h3>
            <img
              id="receiverImage"
              style={{ 
                width: "100%", 
                maxWidth: "720px", 
                border: "2px solid #2196f3",
                borderRadius: "8px",
                margin: "20px auto",
                display: "block"
              }}
              alt="Waiting for phone camera..."
              onLoad={(e) => {
                // When an image loads successfully, show it
                e.target.style.display = "block";
              }}
            />
            <div style={{ margin: "20px" }}>
              <p>To view your phone's camera on this screen:</p>
              <ol style={{ textAlign: "left", maxWidth: "400px", margin: "20px auto" }}>
                <li>Open this URL on your phone:</li>
                <li><b style={{ color: "#2196f3" }}>{qrUrl}</b></li>
                <li>Or scan this QR code:</li>
              </ol>
              <QRCode value={qrUrl} size={180} />
              <p style={{ marginTop: "20px", fontSize: "0.9em", color: "#666" }}>
                Make sure to allow camera access when prompted on your phone
              </p>
            </div>
          </div>
        )}
        
        {error && (
          <div style={{ 
            color: "red", 
            margin: "20px",
            padding: "10px",
            border: "1px solid red",
            borderRadius: "4px",
            backgroundColor: "#fff8f8"
          }}>
            <p><strong>Error:</strong> {error}</p>
            <p style={{ marginTop: "10px", fontSize: "0.9em" }}>
              Troubleshooting tips:
              <ul style={{ textAlign: "left", marginTop: "5px" }}>
                <li>Make sure you're using a modern browser (Chrome, Safari)</li>
                <li>Allow camera permissions when prompted</li>
                <li>If using Chrome, enable "Insecure origins treated as secure" in chrome://flags</li>
                <li>Try refreshing the page</li>
              </ul>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}