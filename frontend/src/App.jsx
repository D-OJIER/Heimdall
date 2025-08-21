import React, { useRef, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { WebRTCHandler } from "./components/WebRTCHandler.jsx";
import ObjectDetection from "./components/ObjectDetection.jsx";

export default function App() {
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [remoteDetections, setRemoteDetections] = useState([]);
  const webrtcRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [backend, setBackend] = useState('');
  const [serverMode, setServerMode] = useState(false);

  useEffect(() => {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    // Allow forcing local camera preview via query param ?forceLocal=1 (useful for desktop testing)
    const urlParams = new URLSearchParams(window.location.search);
    const forceLocal = urlParams.get('forceLocal') === '1' || urlParams.get('local') === '1';
  // Server mode: if ?mode=server or VITE_MODE=server then server mode is active
  const modeParam = urlParams.get('mode') || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MODE) || process.env.REACT_APP_MODE;
  const isServerMode = modeParam === 'server';
  // store server mode in state
  setServerMode(isServerMode);
    if (forceLocal && !isMobileDevice) {
      console.log('Forcing local camera preview due to ?forceLocal=1');
    }
  setIsMobile(isMobileDevice || forceLocal);
    // Try to fetch the machine LAN IP from the local helper service (server/ip_service.js)
    // This is useful in development so the QR code points to the dev server reachable from your phone.
    fetch('/api/ip')
      .then(res => res.json())
      .then(({ ip }) => {
        const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        setQrUrl(`http://${ip}:${port}/`);
      })
      .catch(err => {
        // If the helper isn't running, fall back to the current page URL
        console.warn('Failed to fetch LAN IP; falling back to current URL', err);
        setQrUrl(window.location.href);
      });

    const webrtc = new WebRTCHandler(
      null,
      (stream) => {
        // Save remote stream into state so components can use it
        setRemoteStream(stream);
      },
      () => setConnected(true),
  (message) => {
        setMessages(prev => [...prev, { text: message, received: true }]);
      }
      ,(detectionMsg) => {
        // ensure normalized detections array exists
        try {
          if (detectionMsg && detectionMsg.detections) {
            setRemoteDetections(prev => [...prev, detectionMsg]);
            console.log('Stored remote detection for frame', detectionMsg.frame_id);
          }
        } catch (e) { console.error('onDetection handler error', e); }
      }
    );

    webrtcRef.current = webrtc;

    // Expose telemetry send function on window for components to call (shallow global wiring)
    try {
      window.__sendTelemetry = (t) => webrtcRef.current && webrtcRef.current.sendTelemetry && webrtcRef.current.sendTelemetry(t);
    } catch (e) {}

    if (isMobileDevice) {
      // Mobile device: get camera and start as initiator
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      })
      .then(stream => {
        // keep stream in state for preview and detection
        setLocalStream(stream);
        webrtc.stream = stream;
        const wsUrl = `ws://${window.location.hostname}:8080`;
        webrtc.connect(wsUrl);
      })
      .catch(err => {
        console.error('Camera error:', err);
        setError(err.message);
      });
    } else {
      // Desktop: just connect as receiver
      const wsUrl = `ws://${window.location.hostname}:8080`;
      webrtc.connect(wsUrl);
    }

    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }

      // Stop any local stream tracks we created
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        setLocalStream(null);
      }
      // Optional: stop remote stream tracks if present (cleanup)
      if (remoteStream) {
        try {
          remoteStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          // ignore
        }
        setRemoteStream(null);
      }
  try { window.__sendTelemetry = null; } catch (e) {}
    };
  }, []);

  function getLocalUrl() {
    const host = window.location.hostname;
    const port = window.location.port;
    return `http://${host}:${port}`;
  }

  const sendMessage = () => {
    if (inputMessage.trim() && webrtcRef.current) {
      // Attempt to send over data channel
      try {
        const ok = webrtcRef.current.sendMessage ? webrtcRef.current.sendMessage(inputMessage) : false;
        if (!ok) {
          console.log('Data channel not available or send failed; using WS fallback');
        }
      } catch (e) {
        console.warn('Data channel send threw:', e);
      }

      // Always send via signaling WebSocket as a reliable fallback
      try {
        const wsok = webrtcRef.current.sendChat ? webrtcRef.current.sendChat(inputMessage) : false;
        if (!wsok) console.warn('WebSocket chat send failed or not available');
      } catch (e) {
        console.error('sendChat threw:', e);
      }

      // Update local UI immediately
      setMessages(prev => [...prev, { text: inputMessage, received: false }]);
      setInputMessage("");
    }
  };

  const statusText = serverMode ? 'Running on: SERVER'
    : (remoteDetections && remoteDetections.length > 0) ? 'Running on: SERVER'
    : isMobile ? (backend ? `Running on: ${backend.toUpperCase()}` : 'Detecting backend...')
    : 'Waiting for detections...';
  const statusClass = (serverMode || (remoteDetections && remoteDetections.length > 0) || connected) ? 'ok' : 'warn';

  return (
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">Heimdall</h1>
        <p className="app-subtitle">Phone camera stream and object detection</p>
      </div>

      <div className="status-bar">
        <div className={`status-pill ${statusClass}`}>{statusText}</div>
      </div>

      {isMobile ? (
        <div className="card stream-card">
          <ObjectDetection
            videoStream={localStream}
            sendDetectionToPeer={(d) => webrtcRef.current && webrtcRef.current.sendDetection(d)}
            onBackendChange={setBackend}
            enableLocalDetection={!serverMode}
          />
        </div>
      ) : (
        <div className="layout-grid">
          <div className="card">
            <h3>Connect your phone</h3>
            <div className="qr-wrapper">
              <div className="qr-code"><QRCode value={qrUrl} size={180} /></div>
              <div className="muted">Scan this QR code with your phone</div>
              <div className="copy-url">{qrUrl}</div>
            </div>
          </div>
          <div className="card stream-card">
            <h3>Live stream</h3>
            <ObjectDetection
              videoStream={remoteStream}
              remoteDetections={remoteDetections}
                    sendDetectionToPeer={(d) => webrtcRef.current && webrtcRef.current.sendDetection(d)}
                    sendTelemetryToPeer={(t) => webrtcRef.current && webrtcRef.current.sendTelemetry(t)}
              enableLocalDetection={!serverMode}
            />
            <div className="connection-state">{connected ? 'Connected' : 'Waiting for connection...'}</div>
          </div>
        </div>
      )}

      {error && <div className="connection-state" style={{ color: '#f2555a' }}>{error}</div>}

      
    </div>
  );
}