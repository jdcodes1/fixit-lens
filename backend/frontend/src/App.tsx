import { useEffect, useRef, useState } from 'react';
import { Camera, AlertCircle, CheckCircle2, Wrench, RefreshCw } from 'lucide-react';

const WEBSOCKET_URL = 'ws://localhost:8000/ws';

export default function FixitApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [safetyAlert, setSafetyAlert] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("Initializing...");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [readyState, setReadyState] = useState<number>(0); // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED

  // WebSocket Connection
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setReadyState(1);
        setTranscript("Connected to Fixit Backend.");
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        setIsProcessing(false);
        if (msg.type === 'safety_alert') {
          setSafetyAlert(msg.message);
        } else if (msg.type === 'transcript') {
          setTranscript(msg.text);
        }
      };

      ws.onclose = () => {
        setReadyState(3);
        setTranscript("Connection lost. Reconnecting...");
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setReadyState(3);
      };
    };

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const sendJsonMessage = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  // Start/Stop Camera
  const toggleCamera = async () => {
    if (isStreaming) {
      stream?.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsStreaming(false);
      setTranscript("Camera stopped.");
    } else {
      try {
        setTranscript("Requesting camera access...");
        const newStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' }, 
          audio: false 
        });
        setStream(newStream);
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
        }
        setIsStreaming(true);
        setTranscript("Live vision active. Show me the problem.");
      } catch (err) {
        console.error("Error accessing camera:", err);
        setTranscript("Error: " + (err instanceof Error ? err.message : "Camera access denied."));
      }
    }
  };

  // Frame Capture Loop
  useEffect(() => {
    let interval: any;
    if (isStreaming && readyState === 1) {
      interval = setInterval(() => {
        captureFrame();
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isStreaming, readyState]);

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessing(true);
    
    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    // Draw video frame to canvas
    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const base64Frame = canvasRef.current.toDataURL('image/jpeg', 0.6);
    
    sendJsonMessage({
      type: 'video_frame',
      data: base64Frame.split(',')[1]
    });
  };

  const connectionStatus = {
    0: 'Connecting',
    1: 'Live',
    2: 'Closing',
    3: 'Offline',
  }[readyState] || 'Offline';

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white font-sans overflow-hidden select-none">
      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-800/50 backdrop-blur-md flex justify-between items-center z-20 bg-slate-950/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
            <Wrench className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight uppercase leading-none">Fixit Lens</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] mt-1 font-bold">Hackathon Prototype</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${readyState === 1 ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${readyState === 1 ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          {connectionStatus}
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 relative flex flex-col min-h-0 bg-black">
        <div className="absolute inset-0 z-0 flex items-center justify-center">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className={`h-full w-full object-cover transform transition-opacity duration-1000 ${isStreaming ? 'opacity-100' : 'opacity-0'}`}
          />
          {!isStreaming && (
            <div className="flex flex-col items-center justify-center gap-6 text-slate-600 animate-pulse">
              <Camera size={64} strokeWidth={1} />
              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-widest">Vision System Standby</p>
                <p className="text-xs mt-1">Tap the camera icon below to begin</p>
              </div>
            </div>
          )}
        </div>

        {/* HUD Overlays */}
        {isStreaming && (
          <div className="absolute inset-0 pointer-events-none z-10 border-[1px] border-white/10 m-4 rounded-3xl overflow-hidden">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-500/50 rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-500/50 rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-500/50 rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-500/50 rounded-br-xl" />
            
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20">
              <div className="w-12 h-12 border border-white rounded-full flex items-center justify-center">
                <div className="w-1 h-1 bg-white rounded-full" />
              </div>
            </div>

            {isProcessing && (
              <div className="absolute top-8 right-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-md">
                <RefreshCw size={12} className="animate-spin" />
                Analyzing
              </div>
            )}
          </div>
        )}

        {/* Safety Alert Overlay */}
        {safetyAlert && (
          <div className="absolute top-24 left-4 right-4 z-50 bg-red-600 text-white p-5 rounded-2xl flex items-start gap-4 shadow-[0_20px_50px_rgba(220,38,38,0.5)] border border-red-400 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="p-3 bg-red-800 rounded-xl">
              <AlertCircle size={24} />
            </div>
            <div className="flex-1">
              <p className="font-black uppercase text-xs tracking-widest mb-1 opacity-80">Severe Danger Warning</p>
              <p className="text-lg font-bold leading-tight">{safetyAlert}</p>
              <button 
                onClick={() => setSafetyAlert(null)}
                className="mt-4 px-4 py-2 bg-white text-red-600 rounded-lg font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
              >
                Acknowledge
              </button>
            </div>
          </div>
        )}

        {/* Instructions/Transcript Drawer */}
        <div className="absolute bottom-0 left-0 right-0 p-6 z-20 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
          <div className="max-w-xl mx-auto">
            <div className="bg-slate-900/60 backdrop-blur-2xl rounded-2xl p-5 border border-white/10 shadow-2xl transition-all duration-500">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-blue-400 text-[10px] font-black uppercase tracking-[0.2em]">
                  <CheckCircle2 size={14} />
                  Lens Feedback
                </div>
                {readyState === 1 && isStreaming && (
                  <div className="flex gap-1">
                    {[1,2,3].map(i => (
                      <div key={i} className="w-1 h-1 bg-blue-500/50 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="text-white text-lg font-medium leading-relaxed min-h-[3rem]">
                {transcript}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} width="640" height="480" className="hidden" />

      {/* Controls */}
      <footer className="px-6 py-10 bg-slate-950 flex justify-center items-center relative z-30">
        <button 
          onClick={toggleCamera}
          className={`group relative flex items-center justify-center transition-all duration-500 active:scale-90 ${isStreaming ? 'w-20 h-20' : 'w-24 h-24'}`}
        >
          <div className={`absolute inset-0 rounded-full border-2 transition-all duration-500 scale-125 opacity-20 ${isStreaming ? 'border-red-500' : 'border-blue-500'}`} />
          
          <div className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${isStreaming ? 'bg-red-500 hover:bg-red-400 shadow-red-900/40' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/40'}`}>
            {isStreaming ? (
              <div className="w-7 h-7 bg-white rounded-md animate-pulse" />
            ) : (
              <Camera className="text-white group-hover:scale-110 transition-transform" size={32} />
            )}
          </div>
        </button>
        
        <div className="absolute right-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 pointer-events-none">
          Live Agent v0.1
        </div>
      </footer>
    </div>
  );
}
