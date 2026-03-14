import { X, ExternalLink, Package } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface BuyLink {
  title: string;
  url: string;
  source: string;
}

export interface IdentifiedPart {
  id: string;
  name: string;
  modelNumber: string;
  buyLinks: BuyLink[];
  timestamp: number;
}

interface PartCardProps {
  part: IdentifiedPart;
  onDismiss: (id: string) => void;
}

export default function PartCard({ part, onDismiss }: PartCardProps) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 15s
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss(part.id);
    }, 15000);
    return () => clearTimeout(timer);
  }, [part.id, onDismiss]);

  if (!visible) return null;

  return (
    <div className="bg-slate-800/90 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-3 animate-in slide-in-from-bottom-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/10 rounded-lg border border-amber-500/20">
            <Package size={16} className="text-amber-400" />
          </div>
          <div>
            <h4 className="text-white text-sm font-bold">{part.name}</h4>
            {part.modelNumber && (
              <p className="text-slate-400 text-[11px] font-mono">{part.modelNumber}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => { setVisible(false); onDismiss(part.id); }}
          className="text-slate-500 hover:text-white p-1 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {part.buyLinks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {part.buyLinks.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-300 text-[11px] font-semibold hover:bg-blue-600/40 transition-colors"
            >
              {link.source || link.title}
              <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Toast notification when Parts tab isn't active */
export function PartToast({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-24 left-4 right-4 z-40 bg-amber-600/90 backdrop-blur-md text-white p-3 rounded-xl flex items-center gap-3 shadow-lg border border-amber-400/30 animate-in slide-in-from-top-2 active:scale-98 transition-transform"
    >
      <Package size={18} />
      <span className="text-sm font-bold">Part identified: {name}</span>
    </button>
  );
}
