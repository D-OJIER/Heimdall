import React, { useRef, useEffect, useState } from "react";
import QRCode from "react-qr-code";


function getLocalUrl() {
  // Use the current hostname (works for LAN IP or localhost)
  const host = window.location.hostname;
  // Default to 3000 for Vite dev server
  return `http://${host}:3000`;
}

export default function App() {
  const videoRef = useRef(null);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    // Start camera
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });

    // Generate QR code URL for phone using current host
    setQrUrl(getLocalUrl());
  }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <h2>Heimdall: Phone Camera Stream</h2>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: 320, height: 240, border: "1px solid #ccc" }}
      />
      <div style={{ margin: "20px" }}>
        <p>Scan this QR code with your phone to join:</p>
  <QRCode value={qrUrl} size={180} />
        <p>Or open: <b>{qrUrl}</b> on your phone</p>
      </div>
    </div>
  );
}