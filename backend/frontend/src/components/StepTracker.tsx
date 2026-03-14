import { Check, Circle, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

export interface StepInfo {
  number: number;
  text: string;
  status: 'pending' | 'active' | 'completed';
}

export interface StepState {
  steps: StepInfo[];
  currentStep: number;
  totalSteps: number;
  message: string;
}

interface StepTrackerProps {
  stepState: StepState;
  onVoiceCommand: (command: 'next' | 'back' | 'repeat') => void;
}

export default function StepTracker({ stepState, onVoiceCommand }: StepTrackerProps) {
  const { steps, currentStep, totalSteps, message } = stepState;

  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Steps list */}
      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
        {steps.map(step => (
          <div
            key={step.number}
            className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
              step.status === 'active'
                ? 'bg-blue-500/10 border border-blue-500/30'
                : step.status === 'completed'
                ? 'bg-emerald-500/5 border border-emerald-500/20 opacity-70'
                : 'bg-white/[0.02] border border-white/5 opacity-50'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {step.status === 'completed' ? (
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check size={14} className="text-emerald-400" />
                </div>
              ) : step.status === 'active' ? (
                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
                  <Circle size={14} className="text-blue-400 fill-blue-400" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-slate-700/50 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-slate-500">{step.number}</span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className={`text-sm leading-relaxed ${
                step.status === 'active' ? 'text-white font-medium' :
                step.status === 'completed' ? 'text-slate-400 line-through' :
                'text-slate-500'
              }`}>
                {step.text}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* AI confirmation message */}
      {message && (
        <p className="text-xs text-blue-300/80 italic px-1">{message}</p>
      )}

      {/* Step nav buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onVoiceCommand('back')}
          disabled={currentStep <= 1}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-white/10 active:scale-95 transition-all"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <button
          onClick={() => onVoiceCommand('repeat')}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/10 active:scale-95 transition-all"
        >
          <RotateCcw size={14} /> Repeat
        </button>
        <button
          onClick={() => onVoiceCommand('next')}
          disabled={currentStep >= totalSteps}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-blue-600/50 active:scale-95 transition-all"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/** Mini indicator shown when Steps tab is not active */
export function MiniStepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  if (totalSteps === 0) return null;
  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
      <div className="w-10 h-10 rounded-full bg-blue-600/80 backdrop-blur-md border border-blue-400/50 flex items-center justify-center shadow-lg shadow-blue-600/30">
        <span className="text-white text-xs font-black">{Math.min(currentStep, totalSteps)}/{totalSteps}</span>
      </div>
    </div>
  );
}
