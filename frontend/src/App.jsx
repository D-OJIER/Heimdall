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
    setQrUrl(window.location.href);

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

  return (
    <div style={{ textAlign: "center" }}>
      <h2>Heimdall: Phone Camera Stream (WebRTC)</h2>
      {/* Backend/Mode display - prefer showing SERVER when remote detections are present */}
      <div style={{ marginBottom: 8, fontWeight: 500 }}>
        {serverMode ? (
          'Running on: SERVER'
        ) : remoteDetections && remoteDetections.length > 0 ? (
          'Running on: SERVER'
        ) : isMobile ? (
          backend ? `Running on: ${backend.toUpperCase()}` : 'Detecting backend...'
        ) : (
          'Waiting for detections...'
        )}
      </div>
      {isMobile ? (
        <ObjectDetection
          videoStream={localStream}
          sendDetectionToPeer={(d) => webrtcRef.current && webrtcRef.current.sendDetection(d)}
          onBackendChange={setBackend}
          enableLocalDetection={!serverMode}
        />
      ) : (
        <>
          <div>
            <p>Scan this QR code with your phone to join:</p>
            <QRCode value={qrUrl} size={180} />
            <p>Or open: <b>{qrUrl}</b> on your phone</p>
          </div>
          <ObjectDetection
            videoStream={remoteStream}
            remoteDetections={remoteDetections}
            sendDetectionToPeer={(d) => webrtcRef.current && webrtcRef.current.sendDetection(d)}
            enableLocalDetection={!serverMode}
          />
          {connected ? <div style={{ color: "green" }}>2705 Connected!</div> : <div>Waiting for connection...</div>}
        </>
      )}
      {error && <div style={{ color: "red" }}>{error}</div>}
      {connected && (
        <div style={{ marginTop: "20px", maxWidth: "600px", margin: "20px auto" }}>
          <div style={{
            border: "1px solid #ccc",
            borderRadius: "5px",
            padding: "10px",
            height: "200px",
            overflowY: "auto",
            marginBottom: "10px",
            backgroundColor: "#f5f5f5"
          }}>
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  textAlign: msg.received ? "left" : "right",
                  margin: "5px",
                  padding: "8px",
                  backgroundColor: msg.received ? "#e3f2fd" : "#e8f5e9",
                  borderRadius: "10px",
                  display: "inline-block",
                  maxWidth: "70%",
                  wordWrap: "break-word"
                }}
              >
                {msg.text}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message..."
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "5px",
                border: "1px solid #ccc"
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "8px 16px",
                borderRadius: "5px",
                border: "none",
                backgroundColor: "#4CAF50",
                color: "white",
                cursor: "pointer"
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}