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
  startedAtServerMs: number;
  lastPacketUpdatedAt: number;
  lastPacketTrackTime: number;
  lastSeekPerfNow: number;
  loopTrack: boolean;
}

interface RamCachedTrack {
  filename: string;
  sourceUrl: string;
  blobUrl: string;
  audioBuffer: AudioBuffer | null;
  duration: number;
  byteLength: number;
}

// Persistent in-RAM cache of all .ogg tracks (ArrayBuffer -> Blob URL + decoded AudioBuffer)
const ramTrackCache = new Map<string, RamCachedTrack>();
const ramTrackInFlight = new Map<string, Promise<RamCachedTrack | null>>();
let sharedMusicAudioCtx: AudioContext | null = null;

function getSharedMusicAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedMusicAudioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      try {
        sharedMusicAudioCtx = new Ctx();
      } catch {
        sharedMusicAudioCtx = null;
      }
    }
  }
  return sharedMusicAudioCtx;
}

async function preloadTrackIntoRam(track: OggTrack): Promise<RamCachedTrack | null> {
  const existing = ramTrackCache.get(track.filename);
  if (existing) return existing;

  const inflight = ramTrackInFlight.get(track.filename);
  if (inflight) return inflight;

  const promise = (async (): Promise<RamCachedTrack | null> => {
    try {
      const res = await fetch(track.url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: 'audio/ogg' });
      const blobUrl = URL.createObjectURL(blob);

      let audioBuffer: AudioBuffer | null = null;
      let duration = 0;
      const ctx = getSharedMusicAudioContext();
      if (ctx) {
        try {
          audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          duration = audioBuffer.duration || 0;
        } catch {
          // Browser can still play the in-RAM Blob URL via HTMLAudioElement even if decodeAudioData is skipped
        }
      }

      const cached: RamCachedTrack = {
        filename: track.filename,
        sourceUrl: track.url,
        blobUrl,
        audioBuffer,
        duration,
        byteLength: arrayBuffer.byteLength,
      };
      ramTrackCache.set(track.filename, cached);
      return cached;
    } catch {
      return null;
    } finally {
      ramTrackInFlight.delete(track.filename);
    }
  })();

  ramTrackInFlight.set(track.filename, promise);
  return promise;
}

function getRamReadyUrl(track: OggTrack): string {
  return ramTrackCache.get(track.filename)?.blobUrl || track.url;
}

export interface SyncRemoteAudioOptions {
  localShipX?: number;
  localShipY?: number;
  isFreeCam?: boolean;
  yieldLocalCockpitToOtherTab?: boolean;
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
  ramLoadedCount: number;
  ramTotalCount: number;
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
  updateServerClock: (serverTimeMs: number) => void;
  getBroadcastMusicState: () => PlayerMusicState | null;
  syncRemotePlayersAudio: (
    players: Map<string, PlayerState>,
    selfId: string,
    listenerX: number,
    listenerY: number,
    isGlobalMuted: boolean,
    options?: SyncRemoteAudioOptions
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
  const [ramLoadedCount, setRamLoadedCount] = useState<number>(() => ramTrackCache.size);
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

  // Server clock offset (serverTimeMs - Date.now()) so all clients sync songs to the exact server clock
  const serverClockOffsetRef = useRef<number>(0);
  // Local epoch timestamp when the current track started (i.e. Date.now() - currentTime * 1000)
  const localStartedAtEpochRef = useRef<number>(0);

  const remoteStreamsRef = useRef<Map<string, RemoteAudioStream>>(new Map());
  const lastNearbyUiSyncRef = useRef<number>(0);

  const updateServerClock = useCallback((serverTimeMs: number) => {
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    const measuredOffset = serverTimeMs - Date.now();
    if (serverClockOffsetRef.current === 0) {
      serverClockOffsetRef.current = measuredOffset;
    } else {
      serverClockOffsetRef.current =
        serverClockOffsetRef.current * 0.8 + measuredOffset * 0.2;
    }
  }, []);

  // Automatically preload all .ogg tracks into RAM (Blob URL + AudioBuffer) on startup & whenever tracks list updates
  useEffect(() => {
    let cancelled = false;
    if (tracks.length === 0) return;

    const preloadAll = async () => {
      let loaded = 0;
      for (const track of tracks) {
        if (ramTrackCache.has(track.filename)) {
          loaded++;
        }
      }
      if (!cancelled) setRamLoadedCount(loaded);

      await Promise.all(
        tracks.map(async (track) => {
          const cached = await preloadTrackIntoRam(track);
          if (!cancelled && cached) {
            setRamLoadedCount(ramTrackCache.size);
            // If this is the currently selected (but not yet playing) track, swap its audio.src to the RAM Blob URL immediately
            const audio = audioRef.current;
            if (
              audio &&
              audio.paused &&
              currentTrackRef.current?.filename === track.filename &&
              audio.src !== cached.blobUrl
            ) {
              audio.src = cached.blobUrl;
              audio.load();
              if (cached.duration > 0) {
                setDuration(cached.duration);
              }
            }
          }
        })
      );
    };

    preloadAll();
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  // Unlock shared Web Audio context and resume any blocked remote ship streams on any user interaction
  useEffect(() => {
    const unlockAudio = () => {
      const ctx = getSharedMusicAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      for (const stream of remoteStreamsRef.current.values()) {
        if (stream.audio.paused && stream.audio.src) {
          stream.audio.play().catch(() => {});
        }
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  const refreshFolder = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/music');
      if (res.ok) {
        const data = (await res.json()) as { files?: OggTrack[] };
        if (Array.isArray(data.files) && data.files.length > 0) {
          setTracks(data.files);
          if (!currentTrackRef.current) {
            const first = data.files[0];
            setCurrentTrack(first);
            currentTrackRef.current = first;
            if (audioRef.current && !audioRef.current.src) {
              audioRef.current.src = getRamReadyUrl(first);
              audioRef.current.load();
            }
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
      const first = fallback[0];
      setCurrentTrack(first);
      currentTrackRef.current = first;
      if (audioRef.current && !audioRef.current.src) {
        audioRef.current.src = getRamReadyUrl(first);
        audioRef.current.load();
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshFolder();
  }, [refreshFolder]);

  // Initialize persistent HTMLAudioElement for local player's Music Box
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 0.75;
    audioRef.current = audio;

    if (currentTrackRef.current) {
      audio.src = getRamReadyUrl(currentTrackRef.current);
      audio.load();
    }

    const onTimeUpdate = () => {
      const cur = audio.currentTime || 0;
      setCurrentTime(cur);
      if (!audio.paused) {
        localStartedAtEpochRef.current = Date.now() - cur * 1000;
      }
    };
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onPlay = () => {
      isPlayingRef.current = true;
      localStartedAtEpochRef.current = Date.now() - (audio.currentTime || 0) * 1000;
      setIsPlaying(true);
    };
    const onPause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = 0;
        localStartedAtEpochRef.current = Date.now();
        audio.play().catch(() => {});
      } else {
        const list = tracksRef.current;
        const curr = currentTrackRef.current;
        if (list.length > 0 && curr) {
          const idx = list.findIndex((t) => t.filename === curr.filename);
          const next = list[(idx + 1) % list.length];
          setCurrentTrack(next);
          currentTrackRef.current = next;
          audio.src = getRamReadyUrl(next);
          audio.currentTime = 0;
          localStartedAtEpochRef.current = Date.now();
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

    const ramUrl = getRamReadyUrl(track);

    if (currentTrackRef.current?.filename === track.filename) {
      if (!audio.src || audio.src !== ramUrl) {
        const prevTime = audio.currentTime || 0;
        audio.src = ramUrl;
        audio.currentTime = prevTime;
      }
      if (audio.paused) {
        localStartedAtEpochRef.current = Date.now() - (audio.currentTime || 0) * 1000;
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      return;
    }

    setCurrentTrack(track);
    currentTrackRef.current = track;
    const cached = ramTrackCache.get(track.filename);
    if (cached && cached.duration > 0) {
      setDuration(cached.duration);
    }
    audio.src = ramUrl;
    audio.currentTime = 0;
    localStartedAtEpochRef.current = Date.now();
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

    const ramUrl = getRamReadyUrl(currentTrackRef.current);
    if (!audio.src || (audio.paused && audio.src !== ramUrl)) {
      const prevTime = audio.currentTime || 0;
      audio.src = ramUrl;
      audio.currentTime = prevTime;
    }

    if (audio.paused) {
      localStartedAtEpochRef.current = Date.now() - (audio.currentTime || 0) * 1000;
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
    const cached = ramTrackCache.get(next.filename);
    if (cached && cached.duration > 0) {
      setDuration(cached.duration);
    }
    if (audio) {
      audio.src = getRamReadyUrl(next);
      audio.currentTime = 0;
      localStartedAtEpochRef.current = Date.now();
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
    const cached = ramTrackCache.get(prev.filename);
    if (cached && cached.duration > 0) {
      setDuration(cached.duration);
    }
    if (audio) {
      audio.src = getRamReadyUrl(prev);
      audio.currentTime = 0;
      localStartedAtEpochRef.current = Date.now();
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
    localStartedAtEpochRef.current = Date.now() - seconds * 1000;
    setCurrentTime(seconds);
  }, []);

  const getBroadcastMusicState = useCallback((): PlayerMusicState | null => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!audio || !track || audio.paused || !isPlayingRef.current) {
      return null;
    }
    const nowLocal = Date.now();
    const serverNow = Math.round(nowLocal + serverClockOffsetRef.current);
    const trackTimeSec = Number((audio.currentTime || 0).toFixed(3));
    const startedAtServerMs = Math.round(serverNow - trackTimeSec * 1000);
    return {
      filename: track.filename,
      title: track.title,
      isPlaying: true,
      trackTime: trackTimeSec,
      updatedAt: serverNow,
      startedAtServerMs,
      volume: 1,
      loopTrack: loopRef.current,
    };
  }, []);

  const syncRemotePlayersAudio = useCallback(
    (
      players: Map<string, PlayerState>,
      selfId: string,
      listenerX: number,
      listenerY: number,
      isGlobalMuted: boolean,
      options?: SyncRemoteAudioOptions
    ): NearbyShipAudioInfo[] => {
      const nowPerf = performance.now();
      const serverNowMs = Date.now() + serverClockOffsetRef.current;
      const activeRemoteIds = new Set<string>();
      const audibleList: NearbyShipAudioInfo[] = [];
      const availableTracks =
        tracksRef.current.length > 0 ? tracksRef.current : getBundledFallbackTracks();

      // 1. Adjust local player's own ship stream volume:
      // - If another local browser tab/window is focused on the same machine, yield this background tab's flat cockpit audio so the focused tab's spatial proximity mix is heard clearly.
      // - If in Free-Cam / Spectating another player, attenuate the local ship's music based on distance from the local ship to the camera!
      const localAudio = audioRef.current;
      if (localAudio && !localAudio.paused) {
        if (isGlobalMuted || options?.yieldLocalCockpitToOtherTab) {
          localAudio.volume = 0;
        } else if (
          options?.isFreeCam &&
          typeof options.localShipX === 'number' &&
          typeof options.localShipY === 'number'
        ) {
          const ldx = shortestToroidalDeltaLocal(listenerX, options.localShipX, ARENA_WIDTH);
          const ldy = shortestToroidalDeltaLocal(listenerY, options.localShipY, ARENA_HEIGHT);
          const lDist = Math.hypot(ldx, ldy);
          const innerRadius = 240;
          const rawRatio =
            lDist <= innerRadius
              ? 1
              : lDist >= MUSIC_HEARING_RADIUS
              ? 0
              : 1 - (lDist - innerRadius) / (MUSIC_HEARING_RADIUS - innerRadius);
          const localAudibility = Math.pow(rawRatio, 1.65);
          localAudio.volume = Math.max(
            0,
            Math.min(1, localAudibility * volumeRef.current)
          );
        } else {
          localAudio.volume = volumeRef.current;
        }
      }

      // 2. Stream every remote ship's song directly from the RAM cache, synced to the authoritative server clock,
      //    with volume controlled strictly by distance between the two ships!
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

        // Full volume inside 240u, smooth spatial proximity curve out to MUSIC_HEARING_RADIUS (1800u)
        const innerRadius = 240;
        const rawRatio =
          dist <= innerRadius
            ? 1
            : dist >= MUSIC_HEARING_RADIUS
            ? 0
            : 1 - (dist - innerRadius) / (MUSIC_HEARING_RADIUS - innerRadius);
        const audibility = Math.pow(rawRatio, 1.65);
        // Listener volume preference (decoupled from what the sender's local volume slider is set to)
        const listenerMasterGain = Math.max(0.75, volumeRef.current);
        const targetVol = isGlobalMuted
          ? 0
          : Math.max(0, Math.min(1, audibility * listenerMasterGain));

        const packetStartedAt =
          typeof p.music.startedAtServerMs === 'number' && p.music.startedAtServerMs > 0
            ? p.music.startedAtServerMs
            : (p.music.updatedAt || serverNowMs) - (p.music.trackTime || 0) * 1000;

        let stream = remoteStreamsRef.current.get(p.id);
        if (!stream) {
          const remoteAudio = new Audio();
          remoteAudio.preload = 'auto';
          const newStream: RemoteAudioStream = {
            audio: remoteAudio,
            filename: '',
            startedAtServerMs: packetStartedAt,
            lastPacketUpdatedAt: p.music.updatedAt || 0,
            lastPacketTrackTime: p.music.trackTime || 0,
            lastSeekPerfNow: 0,
            loopTrack: Boolean(p.music.loopTrack),
          };
          stream = newStream;
          remoteStreamsRef.current.set(p.id, stream);
        }

        stream.loopTrack = Boolean(p.music.loopTrack);
        if (Math.abs(packetStartedAt - stream.startedAtServerMs) > 250) {
          stream.startedAtServerMs = packetStartedAt;
        }
        stream.lastPacketUpdatedAt = p.music.updatedAt || 0;
        stream.lastPacketTrackTime = p.music.trackTime || 0;

        const ramUrl = getRamReadyUrl(matchedTrack);
        if (stream.filename !== matchedTrack.filename || stream.audio.src !== ramUrl) {
          stream.filename = matchedTrack.filename;
          stream.audio.src = ramUrl;
          stream.audio.loop = Boolean(p.music.loopTrack);
          stream.audio.load();
        } else {
          stream.audio.loop = Boolean(p.music.loopTrack);
        }

        // Compute authoritative server playback position right now
        const cachedTrack = ramTrackCache.get(matchedTrack.filename);
        const dur =
          stream.audio.duration > 0 && Number.isFinite(stream.audio.duration)
            ? stream.audio.duration
            : cachedTrack?.duration || 0;

        let expectedTime = Math.max(0, (serverNowMs - stream.startedAtServerMs) / 1000);
        if (dur > 0 && Number.isFinite(dur)) {
          expectedTime = stream.loopTrack
            ? expectedTime % dur
            : Math.min(expectedTime, Math.max(0, dur - 0.05));
        }

        // Keep remote ship stream synced with the server clock (with loop wrap-around awareness and cooldown to prevent seek stutter)
        if (
          stream.audio.readyState >= 1 &&
          Number.isFinite(expectedTime) &&
          nowPerf - stream.lastSeekPerfNow > 1400
        ) {
          let drift = Math.abs((stream.audio.currentTime || 0) - expectedTime);
          if (dur > 0 && stream.loopTrack) {
            drift = Math.min(drift, Math.abs(dur - drift));
          }
          if (drift > 0.65) {
            try {
              stream.audio.currentTime = expectedTime;
              stream.lastSeekPerfNow = nowPerf;
            } catch {
              // Ignore seek errors
            }
          }
        }

        stream.audio.volume = targetVol;

        // Keep stream playing continuously from RAM (even at volume 0 when far away) so flying closer turns volume up smoothly with 0ms startup delay
        if (stream.audio.paused) {
          if (stream.audio.readyState >= 1 && Number.isFinite(expectedTime)) {
            try {
              stream.audio.currentTime = expectedTime;
              stream.lastSeekPerfNow = nowPerf;
            } catch {
              // Ignore
            }
          }
          stream.audio.play().catch(() => {});
        }

        if (audibility > 0.002 && !isGlobalMuted) {
          audibleList.push({
            playerId: p.id,
            playerName: p.name,
            playerColor: p.color,
            trackTitle: matchedTrack.title,
            distance: Math.round(dist),
            audibility,
          });
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
    ramLoadedCount,
    ramTotalCount: tracks.length,
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
    updateServerClock,
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
  const allInRam =
    controller.ramTotalCount > 0 &&
    controller.ramLoadedCount >= controller.ramTotalCount;

  return (
    <div className="space-y-3">
      {/* Folder Path, RAM Cache Status & Refresh Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px] text-slate-400">
          <span>
            Folder: <span className="text-amber-400">src/components/music/*.ogg</span> ({controller.tracks.length})
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
              allInRam
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
            title="All OGG tracks are preloaded directly into system RAM for instant 0ms playback"
          >
            {allInRam
              ? `RAM READY (${controller.ramLoadedCount}/${controller.ramTotalCount} · 0ms)`
              : `RAM CACHING (${controller.ramLoadedCount}/${controller.ramTotalCount})`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => controller.refreshFolder()}
            className="rounded border border-slate-700 bg-[#060913] px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
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
              {controller.isPlaying ? 'STREAMING FROM RAM' : 'READY IN RAM'} · {formatSec(controller.currentTime)} / {formatSec(controller.duration)}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={controller.prevTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              title="Previous OGG"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={controller.togglePlayPause}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {controller.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={controller.stopTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              Stop
            </button>
            <button
              type="button"
              onClick={controller.nextTrack}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
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
            type="button"
            onClick={() => controller.setLoopTrack((prev) => !prev)}
            className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
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
            const inRam = ramTrackCache.has(track.filename);
            return (
              <button
                type="button"
                key={track.filename}
                onClick={() => controller.playTrack(track)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
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
                    ? 'Playing (RAM)'
                    : isSelected
                    ? 'Paused (RAM)'
                    : inRam
                    ? 'RAM Ready'
                    : 'Loading RAM...'}
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
      if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        dragOffset.current = null;
        return;
      }
      const nextX = Math.max(8, Math.min(window.innerWidth - 320, e.clientX - dragOffset.current.dx));
      const nextY = Math.max(8, Math.min(window.innerHeight - 80, e.clientY - dragOffset.current.dy));
      setPos({ x: nextX, y: nextY });
    };
    const clearDrag = () => {
      dragOffset.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', clearDrag);
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', clearDrag);
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
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
          if ((e.target as HTMLElement)?.closest('button')) return;
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
            type="button"
            onClick={() => setMinimized((prev) => !prev)}
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {minimized ? 'Expand' : 'Min'}
          </button>
          <button
            type="button"
            onClick={() => controller.setPinnedWindowOpen(false)}
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-500/60 hover:text-rose-300 whitespace-nowrap shrink-0 cursor-pointer"
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
