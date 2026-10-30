import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface OggTrack {
  filename: string;
  title: string;
  url: string;
  sizeBytes?: number;
}

// Vite static glob fallback for any .ogg files bundled in src/components/music/
const bundledOggModules = import.meta.glob('./music/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getBundledFallbackTracks(): OggTrack[] {
  return Object.entries(bundledOggModules)
    .map(([relPath, url]) => {
      const filename = relPath.split('/').pop() || relPath;
      return {
        filename,
        title: filename.replace(/\.ogg$/i, '').replace(/[_-]+/g, ' '),
        url,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export interface MusicBoxController {
  tracks: OggTrack[];
  currentTrack: OggTrack | null;
  isPlaying: boolean;
  loopTrack: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  isLoading: boolean;
  pinnedWindowOpen: boolean;
  setPinnedWindowOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playTrack: (track: OggTrack) => void;
  togglePlayPause: () => void;
  stopTrack: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setLoopTrack: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (vol: number) => void;
  seek: (seconds: number) => void;
  refreshFolder: () => Promise<void>;
  uploadOggFile: (file: File) => Promise<void>;
}

export function useMusicBoxController(): MusicBoxController {
  const [tracks, setTracks] = useState<OggTrack[]>(() => getBundledFallbackTracks());
  const [currentTrack, setCurrentTrack] = useState<OggTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopTrack, setLoopTrack] = useState<boolean>(true);
  const [volume, setVolumeState] = useState<number>(0.75);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pinnedWindowOpen, setPinnedWindowOpen] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<OggTrack[]>(tracks);
  tracksRef.current = tracks;
  const loopRef = useRef<boolean>(loopTrack);
  loopRef.current = loopTrack;
  const currentTrackRef = useRef<OggTrack | null>(currentTrack);
  currentTrackRef.current = currentTrack;

  const refreshFolder = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/music');
      if (res.ok) {
        const data = (await res.json()) as { files?: OggTrack[] };
        if (Array.isArray(data.files) && data.files.length > 0) {
          setTracks(data.files);
          if (!currentTrackRef.current) {
            setCurrentTrack(data.files[0]);
          }
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fallback to Vite glob tracks
    }
    const fallback = getBundledFallbackTracks();
    setTracks(fallback);
    if (!currentTrackRef.current && fallback.length > 0) {
      setCurrentTrack(fallback[0]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshFolder();
  }, [refreshFolder]);

  // Initialize persistent HTMLAudioElement
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = 0.75;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        const list = tracksRef.current;
        const curr = currentTrackRef.current;
        if (list.length > 0 && curr) {
          const idx = list.findIndex((t) => t.filename === curr.filename);
          const next = list[(idx + 1) % list.length];
          setCurrentTrack(next);
          audio.src = next.url;
          audio.play().catch(() => {});
        } else {
          setIsPlaying(false);
        }
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const playTrack = useCallback((track: OggTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrackRef.current?.filename === track.filename) {
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      return;
    }

    setCurrentTrack(track);
    currentTrackRef.current = track;
    audio.src = track.url;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrackRef.current) {
      if (tracksRef.current.length > 0) {
        playTrack(tracksRef.current[0]);
      }
      return;
    }

    if (!audio.src) {
      audio.src = currentTrackRef.current.url;
    }

    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playTrack]);

  const stopTrack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const nextTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    const curr = currentTrackRef.current;
    const idx = curr ? list.findIndex((t) => t.filename === curr.filename) : -1;
    const next = list[(idx + 1) % list.length];
    const audio = audioRef.current;
    setCurrentTrack(next);
    currentTrackRef.current = next;
    if (audio) {
      audio.src = next.url;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, []);

  const prevTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    const curr = currentTrackRef.current;
    const idx = curr ? list.findIndex((t) => t.filename === curr.filename) : 0;
    const prev = list[(idx - 1 + list.length) % list.length];
    const audio = audioRef.current;
    setCurrentTrack(prev);
    currentTrackRef.current = prev;
    if (audio) {
      audio.src = prev.url;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const uploadOggFile = useCallback(
    async (file: File) => {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);
      const res = await fetch('/api/music/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          base64Data,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { file?: OggTrack };
        await refreshFolder();
        if (data.file) {
          playTrack(data.file);
        }
      }
    },
    [playTrack, refreshFolder]
  );

  return {
    tracks,
    currentTrack,
    isPlaying,
    loopTrack,
    volume,
    currentTime,
    duration,
    isLoading,
    pinnedWindowOpen,
    setPinnedWindowOpen,
    playTrack,
    togglePlayPause,
    stopTrack,
    nextTrack,
    prevTrack,
    setLoopTrack,
    setVolume,
    seek,
    refreshFolder,
    uploadOggFile,
  };
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface MusicBoxContentProps {
  controller: MusicBoxController;
  compact?: boolean;
}

export const MusicBoxContent: React.FC<MusicBoxContentProps> = ({
  controller,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await controller.uploadOggFile(file);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {/* Folder Path & Pin Toggle Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono-tabular text-[11px] text-slate-400">
          Folder: <span className="text-amber-400">src/components/music/*.ogg</span> ({controller.tracks.length} files)
        </div>

        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".ogg,audio/ogg"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Add an .ogg file into src/components/music/"
            className="rounded border border-slate-700 bg-[#060913] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0"
          >
            + Add .OGG
          </button>
          <button
            onClick={() => controller.refreshFolder()}
            className="rounded border border-slate-700 bg-[#060913] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Now Playing & Transport Controls */}
      <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-display text-xs font-bold text-white">
              {controller.currentTrack ? controller.currentTrack.filename : 'Select an .ogg file'}
            </div>
            <div className="font-mono-tabular text-[11px] text-slate-400">
              {controller.isPlaying ? 'PLAYING OGG' : 'PAUSED'} · {formatSec(controller.currentTime)} / {formatSec(controller.duration)}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={controller.prevTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
              title="Previous OGG"
            >
              Prev
            </button>
            <button
              onClick={controller.togglePlayPause}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              {controller.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={controller.stopTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
            >
              Stop
            </button>
            <button
              onClick={controller.nextTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
              title="Next OGG"
            >
              Next
            </button>
          </div>
        </div>

        {/* Scrubber & Volume Row */}
        <div className="mt-2.5 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(1, controller.duration || 1)}
            step={0.1}
            value={Math.min(controller.currentTime, controller.duration || 1)}
            onChange={(e) => controller.seek(parseFloat(e.target.value))}
            className="h-1 flex-1 accent-amber-500"
          />

          <button
            onClick={() => controller.setLoopTrack((prev) => !prev)}
            className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-medium whitespace-nowrap shrink-0 ${
              controller.loopTrack
                ? 'border-amber-500/60 text-amber-400'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {controller.loopTrack ? 'Loop 1' : 'Auto-All'}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="font-mono-tabular text-[10px] text-slate-400">VOL</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={controller.volume}
              onChange={(e) => controller.setVolume(parseFloat(e.target.value))}
              className="h-1 w-16 accent-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Track List from src/components/music/*.ogg */}
      <div
        className={`space-y-1.5 overflow-y-auto pr-1 ${
          compact ? 'max-h-36' : 'max-h-44'
        }`}
      >
        {controller.tracks.length === 0 ? (
          <div className="rounded-lg border border-slate-800/80 bg-[#060913] px-3 py-2.5 text-xs text-slate-400">
            No <span className="font-mono-tabular text-slate-200">.ogg</span> files found in{' '}
            <span className="font-mono-tabular text-amber-400">src/components/music/</span>. Place{' '}
            <span className="font-mono-tabular text-slate-200">.ogg</span> files in that folder or click{' '}
            <span className="text-slate-200">+ Add .OGG</span>.
          </div>
        ) : (
          controller.tracks.map((track) => {
            const isSelected = controller.currentTrack?.filename === track.filename;
            const isActivelyPlaying = isSelected && controller.isPlaying;
            return (
              <button
                key={track.filename}
                onClick={() => controller.playTrack(track)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'border-amber-500/80 bg-[#111C33] text-white'
                    : 'border-slate-800/90 bg-[#060913] text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono-tabular text-xs font-bold text-amber-400">
                    {isActivelyPlaying ? '▶' : '♪'}
                  </span>
                  <span className="truncate font-mono-tabular text-xs">
                    {track.filename}
                  </span>
                </div>
                <span className="font-mono-tabular text-[11px] text-slate-400 shrink-0">
                  {isActivelyPlaying
                    ? 'Playing'
                    : isSelected
                    ? 'Paused'
                    : 'Play .OGG'}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

interface FloatingMusicBoxWindowProps {
  controller: MusicBoxController;
}

export const FloatingMusicBoxWindow: React.FC<FloatingMusicBoxWindowProps> = ({
  controller,
}) => {
  const [minimized, setMinimized] = useState<boolean>(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: 16,
    y: 210,
  });
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragOffset.current) return;
      const nextX = Math.max(8, Math.min(window.innerWidth - 320, e.clientX - dragOffset.current.dx));
      const nextY = Math.max(8, Math.min(window.innerHeight - 80, e.clientY - dragOffset.current.dy));
      setPos({ x: nextX, y: nextY });
    };
    const onMouseUp = () => {
      dragOffset.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (!controller.pinnedWindowOpen) return null;

  return (
    <div
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
      }}
      className="fixed left-0 top-0 z-30 w-80 rounded-xl border border-amber-500/40 bg-[#0B1120]/95 p-3.5 text-slate-100 shadow-2xl pointer-events-auto"
    >
      {/* Draggable Window Title Bar */}
      <div
        onMouseDown={(e) => {
          dragOffset.current = {
            dx: e.clientX - pos.x,
            dy: e.clientY - pos.y,
          };
        }}
        className="flex cursor-move items-center justify-between border-b border-slate-800 pb-2"
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold tracking-wide text-amber-400">
            MUSIC BOX
          </span>
          <span className="text-slate-600">·</span>
          <span className="font-mono-tabular text-[10px] text-slate-400">
            {controller.isPlaying ? 'LIVE' : 'IDLE'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMinimized((prev) => !prev)}
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            {minimized ? 'Expand' : 'Min'}
          </button>
          <button
            onClick={() => controller.setPinnedWindowOpen(false)}
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-500/60 hover:text-rose-300 whitespace-nowrap shrink-0"
            title="Hide floating Music Box window (audio keeps playing)"
          >
            Close
          </button>
        </div>
      </div>

      {minimized ? (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate font-mono-tabular text-xs text-slate-200">
            {controller.currentTrack ? controller.currentTrack.filename : 'No track'}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={controller.togglePlayPause}
              className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              {controller.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={controller.nextTrack}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 whitespace-nowrap shrink-0"
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <MusicBoxContent controller={controller} compact />
        </div>
      )}
    </div>
  );
};
