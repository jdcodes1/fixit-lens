import React, { useEffect, useRef, useState } from 'react';

const FixItLens: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [transcript, setTranscript] = useState("Waiting for diagnosis...");
  const [safetyAlert, setSafetyAlert] = useState<string | null>(null);

  useEffect(() => {
    // Replace with your actual Cloud Run URL after Step 1 deployment
    const ws = new WebSocket('wss://fixit-lens-backend-490103.a.run.app/ws');
    setSocket(ws);

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') setTranscript(data.text);
      if (data.type === 'safety_alert') setSafetyAlert(data.message);
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (canvasRef.current && videoRef.current && socket?.readyState === WebSocket.OPEN) {
        const context = canvasRef.current.getContext('2d');
        context?.drawImage(videoRef.current, 0, 0, 640, 480);
        const frame = canvasRef.current.toDataURL('image/jpeg', 0.7);
        socket.send(JSON.stringify({ type: 'video_frame', data: frame }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [socket]);

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden flex flex-col items-center">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} width="640" height="480" className="hidden" />

      {safetyAlert && (
        <div className="absolute top-10 bg-red-600 text-white p-4 rounded shadow-xl z-50 animate-bounce">
          ⚠️ {safetyAlert}
        </div>
      )}

      <div className="absolute bottom-0 w-full bg-black/70 p-6 text-white text-center italic">
        {transcript}
      </div>
    </div>
  );
};

export default FixItLens;
