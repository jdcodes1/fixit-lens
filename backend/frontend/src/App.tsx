import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle2, Wrench, RefreshCw, X, Mic, MicOff, Camera, Send, XCircle } from 'lucide-react';
import LandingPage from './components/LandingPage';
import PanelSwitcher, { type PanelTab } from './components/PanelSwitcher';
import StepTracker, { MiniStepIndicator, type StepState } from './components/StepTracker';
import PartCard, { PartToast, type IdentifiedPart } from './components/PartCard';
import ResourcePanel, { type ResourceData } from './components/ResourcePanel';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: number;
}

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export default function FixitApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  // Use refs for values accessed in closures
  const isMutedRef = useRef(false);
  const isStreamingRef = useRef(false);
  const geminiReadyRef = useRef(false);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [safetyAlert, setSafetyAlert] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [readyState, setReadyState] = useState<number>(3);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);

  // New feature state
  const [activePanel, setActivePanel] = useState<PanelTab>('chat');
  const [stepState, setStepState] = useState<StepState>({
    steps: [], currentStep: 0, totalSteps: 0, message: '',
  });
  const [identifiedParts, setIdentifiedParts] = useState<IdentifiedPart[]>([]);
  const [partToast, setPartToast] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceData | null>(null);

  // Keep refs in sync with state
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages(prev => {
      if (
        (role === 'assistant' || role === 'user') &&
        prev.length > 0 &&
        prev[prev.length - 1].role === role
      ) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: updated[updated.length - 1].text + text,
        };
        return updated;
      }
      return [...prev, { id: crypto.randomUUID(), role, text, timestamp: Date.now() }];
    });
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Audio flush for interruption ---
  function flushAudioQueue() {
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    nextPlayTimeRef.current = 0;
  }

  // --- WebSocket ---
  const connectWs = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setReadyState(1);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playAudioChunk(event.data);
        return;
      }

      const msg = JSON.parse(event.data);
      setIsProcessing(false);

      if (msg.type === 'status') {
        if (msg.status === 'ready') {
          geminiReadyRef.current = true;
        }
      } else if (msg.type === 'interrupted') {
        flushAudioQueue();
      } else if (msg.type === 'safety_alert') {
        setSafetyAlert(msg.message);
        addMessage('assistant', `[SAFETY] ${msg.message}`);
      } else if (msg.type === 'transcript') {
        addMessage('assistant', msg.text);
      } else if (msg.type === 'user_transcript') {
        addMessage('user', msg.text);
      } else if (msg.type === 'error') {
        addMessage('error', msg.message);
      } else if (msg.type === 'step_update') {
        setStepState({
          steps: msg.steps,
          currentStep: msg.current_step,
          totalSteps: msg.total_steps,
          message: msg.message || '',
        });
        if (activePanel === 'chat' && msg.steps.length > 0) {
          setActivePanel('steps');
        }
      } else if (msg.type === 'part_identified') {
        const part: IdentifiedPart = {
          id: crypto.randomUUID(),
          name: msg.name,
          modelNumber: msg.model_number || '',
          buyLinks: msg.buy_links || [],
          timestamp: Date.now(),
        };
        setIdentifiedParts(prev => [part, ...prev].slice(0, 10));
        if (activePanel !== 'parts') {
          setPartToast(msg.name);
          setTimeout(() => setPartToast(null), 4000);
        }
      } else if (msg.type === 'resources') {
        setResources({
          query: msg.query,
          youtube: msg.youtube || [],
          guides: msg.guides || [],
        });
      }
    };

    ws.onclose = () => {
      setReadyState(3);
      geminiReadyRef.current = false;
      if (isStreamingRef.current) {
        setTimeout(connectWs, 3000);
      }
    };

    ws.onerror = () => {
      setReadyState(3);
    };
  }, [addMessage, playAudioChunk]);

  // --- Audio Playback ---
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function playAudioChunk(buffer: ArrayBuffer) {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackContextRef.current;
    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
  }

  // --- Audio Capture (mic → backend) ---
  const startAudioCapture = useCallback((mediaStream: MediaStream) => {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(mediaStream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (isMutedRef.current) return;
      if (!geminiReadyRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }, []);

  // --- Start/Stop Camera + Mic ---
  const toggleCamera = async () => {
    if (isStreaming) {
      stream?.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsStreaming(false);
      setFrozenFrame(null);
      scriptProcessorRef.current?.disconnect();
      audioContextRef.current?.close();
      playbackContextRef.current?.close();
      playbackContextRef.current = null;
      wsRef.current?.close();
      return;
    }

    try {
      setIsLoading(true);
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      setStream(newStream);
      setIsStreaming(true);
      setIsLoading(false);

      connectWs();
      startAudioCapture(newStream);
    } catch (err) {
      setIsLoading(false);
      console.error('Error accessing camera/mic:', err);
      addMessage('error', err instanceof Error ? err.message : 'Camera/mic access denied.');
    }
  };

  // Attach stream to video
  useEffect(() => {
    if (isStreaming && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [isStreaming, stream]);

  // Frame capture loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isStreaming && readyState === 1 && !frozenFrame) {
      interval = setInterval(captureFrame, 2000);
    }
    return () => clearInterval(interval);
  }, [isStreaming, readyState, frozenFrame]);

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessing(true);

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const base64Frame = canvasRef.current.toDataURL('image/jpeg', 0.6);

    sendJson({ type: 'video_frame', data: base64Frame.split(',')[1] });
  };

  const sendJson = (data: any) => {
    if (!geminiReadyRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  // --- Voice commands (step nav) ---
  const handleVoiceCommand = (command: 'next' | 'back' | 'repeat') => {
    sendJson({ type: 'voice_command', command });
  };

  // --- Photo Capture / Freeze ---
  const handleCapture = () => {
    if (frozenFrame) {
      setFrozenFrame(null);
      return;
    }
    if (!videoRef.current || !canvasRef.current) return;

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, 640, 480);
    const highQuality = canvasRef.current.toDataURL('image/jpeg', 0.9);
    setFrozenFrame(highQuality);

    sendJson({ type: 'video_frame', data: highQuality.split(',')[1] });
    sendJson({
      type: 'text_message',
      text: 'I just captured this frame for a closer look. Please give a detailed analysis of what you see, including any parts, damage, or repair steps.',
    });
    setIsProcessing(true);
  };

  // --- Text Input ---
  const handleSendText = () => {
    const text = textInput.trim();
    if (!text) return;
    sendJson({ type: 'text_message', text });
    addMessage('user', text);
    setTextInput('');
  };

  // --- Mute toggle ---
  const toggleMute = () => setIsMuted(prev => !prev);

  // --- Part dismiss ---
  const handleDismissPart = useCallback((id: string) => {
    setIdentifiedParts(prev => prev.filter(p => p.id !== id));
  }, []);

  const connectionStatus = {
    0: 'Connecting',
    1: 'Live',
    2: 'Closing',
    3: 'Offline',
  }[readyState] || 'Offline';

  const hasSteps = stepState.steps.length > 0;
  const hasParts = identifiedParts.length > 0;
  const hasResources = resources !== null && (resources.youtube.length > 0 || resources.guides.length > 0);

  // Landing Page
  if (!isStreaming) {
    return <LandingPage onStart={toggleCamera} isLoading={isLoading} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white font-sans overflow-hidden select-none">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 px-6 py-4 flex justify-between items-center z-20 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/80 backdrop-blur-md rounded-lg shadow-lg">
            <Wrench className="text-white" size={16} />
          </div>
          <h1 className="text-sm font-black tracking-tight uppercase leading-none text-white/90">Fixit Lens</h1>

          {/* Capture / Freeze Button */}
          <button
            onClick={handleCapture}
            className={`ml-2 p-2 rounded-full border backdrop-blur-md transition-all active:scale-90 ${
              frozenFrame
                ? 'bg-amber-500/30 border-amber-400/60 text-amber-300'
                : 'bg-white/10 border-white/30 text-white'
            }`}
          >
            {frozenFrame ? <XCircle size={18} /> : <Camera size={18} />}
          </button>
          {frozenFrame && (
            <span className="text-amber-300 text-[10px] font-bold uppercase tracking-widest">
              Frozen
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border backdrop-blur-md ${readyState === 1 ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${readyState === 1 ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {connectionStatus}
          </div>
          <button
            onClick={toggleMute}
            className={`p-2 backdrop-blur-md rounded-full border transition-colors ${isMuted ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-black/40 border-white/10 text-white/70'}`}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            onClick={toggleCamera}
            className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white/70 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 relative flex flex-col min-h-0 bg-black">
        <div className="absolute inset-0 z-0 flex items-center justify-center">
          {frozenFrame ? (
            <img src={frozenFrame} alt="Captured frame" className="h-full w-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          )}
        </div>

        {/* HUD Overlays */}
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
            <div className="absolute top-20 right-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-md">
              <RefreshCw size={12} className="animate-spin" />
              Analyzing
            </div>
          )}
        </div>

        {/* Mini step indicator (when steps tab not active) */}
        {hasSteps && activePanel !== 'steps' && (
          <MiniStepIndicator currentStep={stepState.currentStep} totalSteps={stepState.totalSteps} />
        )}

        {/* Part toast (when parts tab not active) */}
        {partToast && activePanel !== 'parts' && (
          <PartToast name={partToast} onClick={() => { setActivePanel('parts'); setPartToast(null); }} />
        )}

        {/* Safety Alert Overlay */}
        {safetyAlert && (
          <div className="absolute top-24 left-4 right-4 z-50 bg-red-600 text-white p-5 rounded-2xl flex items-start gap-4 shadow-[0_20px_50px_rgba(220,38,38,0.5)] border border-red-400">
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

        {/* Bottom Drawer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-20 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
          <div className="max-w-xl mx-auto flex flex-col gap-3">
            {/* Text input */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSendText(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-slate-800/80 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/50 transition-colors"
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="p-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-white transition-colors"
              >
                <Send size={18} />
              </button>
            </form>

            {/* Panel Switcher */}
            <PanelSwitcher
              activePanel={activePanel}
              onChange={setActivePanel}
              hasSteps={hasSteps}
              hasParts={hasParts}
              hasResources={hasResources}
            />

            {/* Panel Content */}
            <div className="bg-slate-900/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl">
              <div className="p-4 flex flex-col gap-2">
                {activePanel === 'chat' && (
                  <>
                    <div className="flex items-center gap-2 text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
                      <CheckCircle2 size={14} />
                      Conversation
                    </div>
                    <div className="max-h-48 overflow-y-auto flex flex-col gap-2">
                      {messages.length === 0 && (
                        <p className="text-slate-500 text-sm">Listening... speak or type to begin.</p>
                      )}
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'text-blue-300'
                              : msg.role === 'error'
                              ? 'text-red-400'
                              : 'text-white'
                          }`}
                        >
                          <span className="font-bold text-[10px] uppercase tracking-wider opacity-60 mr-2">
                            {msg.role === 'user' ? 'You' : msg.role === 'error' ? 'Error' : 'AI'}
                          </span>
                          {msg.text}
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  </>
                )}

                {activePanel === 'steps' && (
                  <StepTracker stepState={stepState} onVoiceCommand={handleVoiceCommand} />
                )}

                {activePanel === 'parts' && (
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {identifiedParts.length === 0 ? (
                      <p className="text-slate-500 text-sm">No parts identified yet.</p>
                    ) : (
                      identifiedParts.map(part => (
                        <PartCard key={part.id} part={part} onDismiss={handleDismissPart} />
                      ))
                    )}
                  </div>
                )}

                {activePanel === 'resources' && resources && (
                  <ResourcePanel resources={resources} />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Canvas */}
      <canvas ref={canvasRef} width="640" height="480" className="hidden" />
    </div>
  );
}
