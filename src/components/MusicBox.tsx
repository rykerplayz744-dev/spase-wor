import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MUSIC_HEARING_RADIUS,
  PlayerMusicState,
  PlayerState,
} from '../shared/types.ts';

export interface OggTrack {
  filename: string;
  title: string;
  url: string;
  sizeBytes?: number;
}

export interface NearbyShipAudioInfo {
  playerId: string;
  playerName: string;
  playerColor: string;
  trackTitle: string;
  distance: number;
  audibility: number; // 0..1
}

interface RemoteAudioStream {
  audio: HTMLAudioElement;
  filename: string;
  lastPacketUpdatedAt: number;
  lastPacketTrackTime: number;
  anchorTrackTime: number;
  anchorPerfNow: number;
  loopTrack: boolean;
}

function shortestToroidalDeltaLocal(from: number, to: number, size: number): number {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  if (delta < -size * 0.5) delta += size;
  return delta;
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
  nearbyStreams: NearbyShipAudioInfo[];
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
  getBroadcastMusicState: () => PlayerMusicState | null;
  syncRemotePlayersAudio: (
    players: Map<string, PlayerState>,
    selfId: string,
    listenerX: number,
    listenerY: number,
    isGlobalMuted: boolean
  ) => NearbyShipAudioInfo[];
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
  const [nearbyStreams, setNearbyStreams] = useState<NearbyShipAudioInfo[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<OggTrack[]>(tracks);
  tracksRef.current = tracks;
  const loopRef = useRef<boolean>(loopTrack);
  loopRef.current = loopTrack;
  const currentTrackRef = useRef<OggTrack | null>(currentTrack);
  currentTrackRef.current = currentTrack;
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;
  const volumeRef = useRef<number>(volume);
  volumeRef.current = volume;

  const remoteStreamsRef = useRef<Map<string, RemoteAudioStream>>(new Map());
  const lastNearbyUiSyncRef = useRef<number>(0);

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

  // Initialize persistent HTMLAudioElement for local player's Music Box
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = 0.75;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onPlay = () => {
      isPlayingRef.current = true;
      setIsPlaying(true);
    };
    const onPause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
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
          currentTrackRef.current = next;
          audio.src = next.url;
          audio.play().catch(() => {});
        } else {
          isPlayingRef.current = false;
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
      for (const stream of remoteStreamsRef.current.values()) {
        stream.audio.pause();
        stream.audio.src = '';
      }
      remoteStreamsRef.current.clear();
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
    isPlayingRef.current = false;
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
    volumeRef.current = clamped;
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

  const getBroadcastMusicState = useCallback((): PlayerMusicState | null => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track || audio.paused || !isPlayingRef.current) {
      return null;
    }
    return {
      filename: track.filename,
      title: track.title,
      isPlaying: true,
      trackTime: Number((audio.currentTime || 0).toFixed(3)),
      updatedAt: Date.now(),
      volume: volumeRef.current,
      loopTrack: loopRef.current,
    };
  }, []);

  const syncRemotePlayersAudio = useCallback(
    (
      players: Map<string, PlayerState>,
      selfId: string,
      listenerX: number,
      listenerY: number,
      isGlobalMuted: boolean
    ): NearbyShipAudioInfo[] => {
      const nowPerf = performance.now();
      const nowEpoch = Date.now();
      const activeRemoteIds = new Set<string>();
      const audibleList: NearbyShipAudioInfo[] = [];
      const availableTracks =
        tracksRef.current.length > 0 ? tracksRef.current : getBundledFallbackTracks();

      for (const p of players.values()) {
        if (p.id === selfId || !p.alive || !p.music || !p.music.isPlaying) {
          continue;
        }

        const matchedTrack =
          availableTracks.find((t) => t.filename === p.music!.filename) ||
          availableTracks.find(
            (t) => t.title.toLowerCase() === p.music!.title.toLowerCase()
          );
        if (!matchedTrack) continue;

        activeRemoteIds.add(p.id);

        const dx = shortestToroidalDeltaLocal(listenerX, p.x, ARENA_WIDTH);
        const dy = shortestToroidalDeltaLocal(listenerY, p.y, ARENA_HEIGHT);
        const dist = Math.hypot(dx, dy);

        // Full volume inside 220u, smooth quadratic spatial falloff out to MUSIC_HEARING_RADIUS (1800u)
        const innerRadius = 220;
        const rawRatio =
          dist <= innerRadius
            ? 1
            : dist >= MUSIC_HEARING_RADIUS
            ? 0
            : 1 - (dist - innerRadius) / (MUSIC_HEARING_RADIUS - innerRadius);
        const audibility = rawRatio * rawRatio;
        const senderVol = typeof p.music.volume === 'number' ? p.music.volume : 0.75;
        const targetVol = isGlobalMuted
          ? 0
          : Math.max(0, Math.min(1, audibility * senderVol));

        let stream = remoteStreamsRef.current.get(p.id);
        if (!stream) {
          const remoteAudio = new Audio();
          remoteAudio.preload = 'auto';
          const newStream: RemoteAudioStream = {
            audio: remoteAudio,
            filename: '',
            lastPacketUpdatedAt: 0,
            lastPacketTrackTime: -1,
            anchorTrackTime: p.music.trackTime || 0,
            anchorPerfNow: nowPerf,
            loopTrack: Boolean(p.music.loopTrack),
          };

          const syncOnReady = () => {
            const liveExpected =
              newStream.anchorTrackTime +
              Math.max(0, (performance.now() - newStream.anchorPerfNow) / 1000);
            const dur = remoteAudio.duration;
            const targetTime =
              dur > 0 && Number.isFinite(dur)
                ? newStream.loopTrack
                  ? liveExpected % dur
                  : Math.min(liveExpected, Math.max(0, dur - 0.05))
                : liveExpected;
            if (Number.isFinite(targetTime) && targetTime >= 0) {
              try {
                remoteAudio.currentTime = targetTime;
              } catch {
                // Ignore if seek not yet ready
              }
            }
          };

          remoteAudio.addEventListener('loadedmetadata', syncOnReady);
          remoteAudio.addEventListener('canplay', syncOnReady);
          stream = newStream;
          remoteStreamsRef.current.set(p.id, stream);
        }

        // Update time anchor whenever a fresh network packet arrives from this remote player
        if (
          p.music.updatedAt !== stream.lastPacketUpdatedAt ||
          Math.abs(p.music.trackTime - stream.lastPacketTrackTime) > 0.02
        ) {
          const clockDiffSec = (nowEpoch - p.music.updatedAt) / 1000;
          // If clocks are NTP-aligned within 2s, use exact clock delta; otherwise use ~0.06s transit estimate
          const transitOffset =
            clockDiffSec >= 0 && clockDiffSec <= 2.0 ? clockDiffSec : 0.06;
          stream.anchorTrackTime = Math.max(0, (p.music.trackTime || 0) + transitOffset);
          stream.anchorPerfNow = nowPerf;
          stream.lastPacketUpdatedAt = p.music.updatedAt;
          stream.lastPacketTrackTime = p.music.trackTime;
          stream.loopTrack = Boolean(p.music.loopTrack);
        }

        // Switch audio source if remote player changed songs
        if (stream.filename !== matchedTrack.filename) {
          stream.filename = matchedTrack.filename;
          stream.audio.src = matchedTrack.url;
          stream.audio.loop = Boolean(p.music.loopTrack);
          stream.audio.load();
        } else {
          stream.audio.loop = Boolean(p.music.loopTrack);
        }

        // Compute exact live playback timestamp right now
        let expectedTime =
          stream.anchorTrackTime + Math.max(0, (nowPerf - stream.anchorPerfNow) / 1000);
        const dur = stream.audio.duration;
        if (dur > 0 && Number.isFinite(dur)) {
          expectedTime = stream.loopTrack
            ? expectedTime % dur
            : Math.min(expectedTime, Math.max(0, dur - 0.05));
        }

        // Keep remote playback head tightly locked to the sender's current timestamp (within 0.45s)
        if (
          stream.audio.readyState >= 1 &&
          Number.isFinite(expectedTime) &&
          Math.abs(stream.audio.currentTime - expectedTime) > 0.45
        ) {
          try {
            stream.audio.currentTime = expectedTime;
          } catch {
            // Ignore seek errors during buffering
          }
        }

        stream.audio.volume = targetVol;

        if (targetVol > 0.002) {
          if (stream.audio.paused) {
            if (
              stream.audio.readyState >= 1 &&
              Number.isFinite(expectedTime) &&
              Math.abs(stream.audio.currentTime - expectedTime) > 0.2
            ) {
              try {
                stream.audio.currentTime = expectedTime;
              } catch {
                // Ignore
              }
            }
            stream.audio.play().catch(() => {});
          }
          audibleList.push({
            playerId: p.id,
            playerName: p.name,
            playerColor: p.color,
            trackTitle: matchedTrack.title,
            distance: Math.round(dist),
            audibility,
          });
        } else if (dist > MUSIC_HEARING_RADIUS + 250 && !stream.audio.paused) {
          stream.audio.pause();
        }
      }

      // Clean up streams for remote players who stopped playing music, died, or left the game
      for (const [remoteId, stream] of remoteStreamsRef.current.entries()) {
        if (!activeRemoteIds.has(remoteId)) {
          stream.audio.pause();
          stream.audio.src = '';
          remoteStreamsRef.current.delete(remoteId);
        }
      }

      audibleList.sort((a, b) => a.distance - b.distance);
      if (nowPerf - lastNearbyUiSyncRef.current > 180) {
        lastNearbyUiSyncRef.current = nowPerf;
        setNearbyStreams(audibleList);
      }

      return audibleList;
    },
    []
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
    nearbyStreams,
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
    getBroadcastMusicState,
    syncRemotePlayersAudio,
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
  return (
    <div className="space-y-3">
      {/* Folder Path & Refresh Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono-tabular text-[11px] text-slate-400">
          Folder: <span className="text-amber-400">src/components/music/*.ogg</span> ({controller.tracks.length} files)
        </div>

        <div className="flex items-center gap-1.5">
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
            <span className="font-mono-tabular text-amber-400">src/components/music/</span>.
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
