import { MessageSquare, ListChecks, Package, BookOpen } from 'lucide-react';

export type PanelTab = 'chat' | 'steps' | 'parts' | 'resources';

interface PanelSwitcherProps {
  activePanel: PanelTab;
  onChange: (tab: PanelTab) => void;
  hasSteps: boolean;
  hasParts: boolean;
  hasResources: boolean;
}

const tabs: { id: PanelTab; label: string; icon: typeof MessageSquare; needsContent?: boolean }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'steps', label: 'Steps', icon: ListChecks, needsContent: true },
  { id: 'parts', label: 'Parts', icon: Package, needsContent: true },
  { id: 'resources', label: 'Resources', icon: BookOpen, needsContent: true },
];

export default function PanelSwitcher({ activePanel, onChange, hasSteps, hasParts, hasResources }: PanelSwitcherProps) {
  const contentFlags: Record<string, boolean> = {
    steps: hasSteps,
    parts: hasParts,
    resources: hasResources,
  };

  const visibleTabs = tabs.filter(t => !t.needsContent || contentFlags[t.id]);

  if (visibleTabs.length <= 1) return null;

  return (
    <div className="flex gap-1 bg-slate-800/60 backdrop-blur-md rounded-xl p-1 border border-white/5">
      {visibleTabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activePanel === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
              isActive
                ? 'bg-blue-600/80 text-white shadow-lg'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Icon size={13} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
