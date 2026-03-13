import { Camera, Wrench, Zap, ShieldCheck, ArrowRight, Scan, Sparkles, Loader2 } from 'lucide-react';

interface LandingPageProps {
  onStart: () => void;
  isLoading?: boolean;
}

export default function LandingPage({ onStart, isLoading = false }: LandingPageProps) {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white overflow-y-auto">
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-[128px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-[128px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col px-6 pb-8 max-w-lg mx-auto w-full">
        {/* Safe area */}
        <div className="h-12 shrink-0" />

        {/* Hero Section */}
        <div className="flex flex-col items-center text-center gap-6 mt-8 mb-10">
          {/* Animated logo */}
          <div className="relative">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/30 rotate-3 hover:rotate-0 transition-transform duration-500">
              <Wrench className="text-white w-10 h-10 -rotate-3" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-cyan-400/40">
              <Sparkles size={12} className="text-slate-900" />
            </div>
          </div>

          <div>
            <h1 className="text-5xl font-black tracking-tighter leading-none">
              <span className="bg-gradient-to-r from-white via-blue-100 to-blue-300 bg-clip-text text-transparent">
                Fixit Lens
              </span>
            </h1>
            <p className="text-slate-400 text-lg mt-3 leading-relaxed max-w-sm mx-auto">
              Point your camera at anything broken. Get instant AI-powered repair guidance.
            </p>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="flex flex-col gap-3 mb-10">
          <FeatureCard
            icon={<Scan size={22} />}
            iconColor="text-blue-400"
            iconBg="bg-blue-500/10 border-blue-500/20"
            title="Real-Time Vision"
            description="Gemini 2.0 analyzes your camera feed live, identifying parts and problems instantly"
          />
          <FeatureCard
            icon={<Zap size={22} />}
            iconColor="text-amber-400"
            iconBg="bg-amber-500/10 border-amber-500/20"
            title="Step-by-Step Fixes"
            description="Get clear repair instructions tailored to exactly what the AI sees"
          />
          <FeatureCard
            icon={<ShieldCheck size={22} />}
            iconColor="text-emerald-400"
            iconBg="bg-emerald-500/10 border-emerald-500/20"
            title="Safety Alerts"
            description="Automatic hazard detection warns you about electrical, water, and other dangers"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1 min-h-4" />

        {/* CTA Section */}
        <div className="flex flex-col gap-4 mb-4">
          {/* How it works hint */}
          <div className="flex items-center justify-center gap-6 text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">
            <span className="flex items-center gap-1.5">
              <Camera size={13} /> Point
            </span>
            <span className="text-slate-700">→</span>
            <span className="flex items-center gap-1.5">
              <Scan size={13} /> Scan
            </span>
            <span className="text-slate-700">→</span>
            <span className="flex items-center gap-1.5">
              <Wrench size={13} /> Fix
            </span>
          </div>

          <button
            onClick={onStart}
            disabled={isLoading}
            className="group w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-300 h-16 rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-blue-600/25 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 text-blue-200 animate-spin" />
                <span className="text-white font-bold text-lg tracking-wide">Requesting Access...</span>
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 text-blue-200 group-hover:scale-110 transition-transform" />
                <span className="text-white font-bold text-lg tracking-wide">Start AR Lens</span>
                <ArrowRight className="w-5 h-5 text-blue-200 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          <p className="text-center text-slate-600 text-[11px] uppercase tracking-[0.2em] font-medium">
            Powered by Gemini 2.0 Flash Live
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, iconColor, iconBg, title, description }: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex items-start gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-300 backdrop-blur-sm">
      <div className={`shrink-0 p-2.5 rounded-xl border ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="font-bold text-white text-[15px] mb-0.5">{title}</h3>
        <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
