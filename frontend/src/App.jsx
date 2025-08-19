import React, { useRef, useEffect, useState } from "react";
import QRCode from "react-qr-code";


function getLocalUrl() {
  // Get the local IP address for the QR code
  const host = window.location.hostname;
  // Use port 3000 for the Vite dev server
  return `http://${host}:3000`;
}

export default function App() {
  const videoRef = useRef(null);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Check if mediaDevices is supported
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported by your browser");
      return;
    }

    // Start camera
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        setError("Failed to access camera: " + err.message);
      });

    // Generate QR code URL for phone using current host
    setQrUrl(getLocalUrl());
  }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <h2>Heimdall: Phone Camera Stream</h2>
      {error ? (
        <div style={{ color: "red", margin: "20px" }}>
          {error}
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: 320, height: 240, border: "1px solid #ccc" }}
        />
      )}
      <div style={{ margin: "20px" }}>
        <p>Scan this QR code with your phone to join:</p>
        <QRCode value={qrUrl} size={180} />
        <p>Or open: <b>{qrUrl}</b> on your phone</p>
      </div>
    </div>
  );
}