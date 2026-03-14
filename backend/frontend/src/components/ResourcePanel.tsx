import { Play, ExternalLink, BookOpen } from 'lucide-react';

export interface YouTubeResult {
  title: string;
  url: string;
  thumbnail: string;
  channel: string;
}

export interface GuideResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ResourceData {
  query: string;
  youtube: YouTubeResult[];
  guides: GuideResult[];
}

interface ResourcePanelProps {
  resources: ResourceData;
}

export default function ResourcePanel({ resources }: ResourcePanelProps) {
  const { youtube, guides } = resources;

  if (youtube.length === 0 && guides.length === 0) {
    return <p className="text-slate-500 text-sm">No resources found yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4 max-h-48 overflow-y-auto">
      {/* YouTube videos */}
      {youtube.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400 flex items-center gap-1.5">
            <Play size={12} /> Video Guides
          </h4>
          {youtube.map((video, i) => (
            <a
              key={i}
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors group"
            >
              {video.thumbnail && (
                <img
                  src={video.thumbnail}
                  alt=""
                  className="w-16 h-12 rounded-md object-cover shrink-0 bg-slate-800"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-xs font-semibold leading-tight line-clamp-2 group-hover:text-blue-300 transition-colors">
                  {video.title}
                </p>
                <p className="text-slate-500 text-[10px] mt-0.5">{video.channel}</p>
              </div>
              <ExternalLink size={12} className="text-slate-600 shrink-0" />
            </a>
          ))}
        </div>
      )}

      {/* Repair guides */}
      {guides.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-1.5">
            <BookOpen size={12} /> Repair Guides
          </h4>
          {guides.map((guide, i) => (
            <a
              key={i}
              href={guide.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors group"
            >
              <p className="text-white text-xs font-semibold leading-tight line-clamp-1 group-hover:text-blue-300 transition-colors">
                {guide.title}
              </p>
              {guide.snippet && (
                <p className="text-slate-500 text-[10px] mt-0.5 line-clamp-2 leading-relaxed">{guide.snippet}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
