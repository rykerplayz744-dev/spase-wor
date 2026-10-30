import React, { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from '../game/sound.ts';

export interface OggSoundEffect {
  filename: string;
  title: string;
  url: string;
  sizeBytes?: number;
}

// Vite static glob for any .ogg files placed in src/components/deathsounds/
const bundledDeathSoundModules = import.meta.glob('./deathsounds/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getBundledDeathSounds(): OggSoundEffect[] {
  return Object.entries(bundledDeathSoundModules)
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

export const DEFAULT_DEATH_SOUND_FILE = 'classic_explosion.ogg';
export const DEFAULT_SMASH_SOUND_FILE = 'smash_collision.ogg';

// Persistent in-RAM Blob URL cache for all .ogg death/smash sound effects
const ramDeathSoundCache = new Map<string, string>();
const ramDeathSoundInFlight = new Map<string, Promise<string | null>>();

async function preloadDeathSoundIntoRam(snd: OggSoundEffect): Promise<string | null> {
  const key = snd.filename.toLowerCase();
  const existing = ramDeathSoundCache.get(key);
  if (existing) return existing;

  const inflight = ramDeathSoundInFlight.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(snd.url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([ab], { type: 'audio/ogg' }));
      ramDeathSoundCache.set(key, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      ramDeathSoundInFlight.delete(key);
    }
  })();

  ramDeathSoundInFlight.set(key, promise);
  return promise;
}

export interface DeathSoundController {
  sounds: OggSoundEffect[];
  selectedDeathSound: string;
  selectedSmashSound: string;
  isLoading: boolean;
  setSelectedDeathSound: (filename: string) => void;
  setSelectedSmashSound: (filename: string) => void;
  previewSound: (filename: string) => void;
  playDeathSound: (filename?: string | null, isMuted?: boolean) => void;
  playSmashSound: (filename?: string | null, isMuted?: boolean) => void;
  refreshFolder: () => Promise<void>;
}

export function useDeathSoundController(): DeathSoundController {
  const [sounds, setSounds] = useState<OggSoundEffect[]>(() => getBundledDeathSounds());
  const [selectedDeathSound, setSelectedDeathSoundState] = useState<string>(() => {
    return localStorage.getItem('spacewar_death_sound') || DEFAULT_DEATH_SOUND_FILE;
  });
  const [selectedSmashSound, setSelectedSmashSoundState] = useState<string>(() => {
    return localStorage.getItem('spacewar_smash_sound') || DEFAULT_SMASH_SOUND_FILE;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const soundsRef = useRef<OggSoundEffect[]>(sounds);
  soundsRef.current = sounds;
  const selectedDeathRef = useRef<string>(selectedDeathSound);
  selectedDeathRef.current = selectedDeathSound;
  const selectedSmashRef = useRef<string>(selectedSmashSound);
  selectedSmashRef.current = selectedSmashSound;

  // Automatically preload all death & smash .ogg sound effects into RAM on startup
  useEffect(() => {
    for (const snd of sounds) {
      preloadDeathSoundIntoRam(snd);
    }
  }, [sounds]);

  const refreshFolder = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/deathsounds');
      if (res.ok) {
        const data = (await res.json()) as { files?: OggSoundEffect[] };
        if (Array.isArray(data.files) && data.files.length > 0) {
          setSounds(data.files);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fallback to Vite glob bundled .ogg files
    }
    const fallback = getBundledDeathSounds();
    setSounds(fallback);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshFolder();
  }, [refreshFolder]);

  const setSelectedDeathSound = useCallback((filename: string) => {
    setSelectedDeathSoundState(filename);
    selectedDeathRef.current = filename;
    localStorage.setItem('spacewar_death_sound', filename);
  }, []);

  const setSelectedSmashSound = useCallback((filename: string) => {
    setSelectedSmashSoundState(filename);
    selectedSmashRef.current = filename;
    localStorage.setItem('spacewar_smash_sound', filename);
  }, []);

  const resolveSoundUrl = useCallback((filename?: string | null, fallbackDefault?: string): string | null => {
    const list = soundsRef.current.length > 0 ? soundsRef.current : getBundledDeathSounds();
    if (list.length === 0) return null;
    const targetName = filename || fallbackDefault || DEFAULT_DEATH_SOUND_FILE;
    const exact = list.find((s) => s.filename.toLowerCase() === targetName.toLowerCase());
    if (exact) {
      return ramDeathSoundCache.get(exact.filename.toLowerCase()) || exact.url;
    }
    if (fallbackDefault) {
      const fb = list.find((s) => s.filename.toLowerCase() === fallbackDefault.toLowerCase());
      if (fb) {
        return ramDeathSoundCache.get(fb.filename.toLowerCase()) || fb.url;
      }
    }
    const first = list[0];
    return ramDeathSoundCache.get(first.filename.toLowerCase()) || first.url;
  }, []);

  const previewSound = useCallback(
    (filename: string) => {
      const url = resolveSoundUrl(filename);
      if (!url) {
        soundEngine.playHit(true);
        return;
      }
      const audio = new Audio(url);
      audio.volume = 0.85;
      audio.play().catch(() => {
        soundEngine.playHit(true);
      });
    },
    [resolveSoundUrl]
  );

  const lastDeathPlayTimeRef = useRef<number>(0);
  const lastSmashPlayTimeRef = useRef<number>(0);
  const activeDeathAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeSmashAudioRef = useRef<HTMLAudioElement | null>(null);

  const playDeathSound = useCallback(
    (filename?: string | null, isMuted: boolean = false) => {
      if (isMuted || soundEngine.isMuted()) return;
      const now = performance.now();
      if (now - lastDeathPlayTimeRef.current < 450) {
        return;
      }
      lastDeathPlayTimeRef.current = now;

      const url = resolveSoundUrl(filename || selectedDeathRef.current, DEFAULT_DEATH_SOUND_FILE);
      if (!url) {
        soundEngine.playHit(true);
        return;
      }
      if (activeDeathAudioRef.current) {
        try {
          activeDeathAudioRef.current.pause();
          activeDeathAudioRef.current.currentTime = 0;
        } catch {
          // ignore
        }
      }
      const audio = new Audio(url);
      audio.volume = 0.85;
      activeDeathAudioRef.current = audio;
      audio.play().catch(() => {
        soundEngine.playHit(true);
      });
    },
    [resolveSoundUrl]
  );

  const playSmashSound = useCallback(
    (filename?: string | null, isMuted: boolean = false) => {
      if (isMuted || soundEngine.isMuted()) return;
      const now = performance.now();
      if (now - lastSmashPlayTimeRef.current < 450) {
        return;
      }
      lastSmashPlayTimeRef.current = now;

      const url = resolveSoundUrl(filename || selectedSmashRef.current, DEFAULT_SMASH_SOUND_FILE);
      if (!url) {
        soundEngine.playHit(true);
        return;
      }
      if (activeSmashAudioRef.current) {
        try {
          activeSmashAudioRef.current.pause();
          activeSmashAudioRef.current.currentTime = 0;
        } catch {
          // ignore
        }
      }
      const audio = new Audio(url);
      audio.volume = 0.95;
      activeSmashAudioRef.current = audio;
      audio.play().catch(() => {
        soundEngine.playHit(true);
      });
    },
    [resolveSoundUrl]
  );

  return {
    sounds,
    selectedDeathSound,
    selectedSmashSound,
    isLoading,
    setSelectedDeathSound,
    setSelectedSmashSound,
    previewSound,
    playDeathSound,
    playSmashSound,
    refreshFolder,
  };
}

interface DeathSoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  controller: DeathSoundController;
}

export const DeathSoundModal: React.FC<DeathSoundModalProps> = ({
  isOpen,
  onClose,
  controller,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060913]/85 p-4 pointer-events-auto"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-[#0B1120] p-6 text-slate-100 shadow-2xl pointer-events-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <h2 className="font-display text-lg font-bold tracking-wide text-white">
                DEATH & SMASH SOUND EFFECTS (.OGG)
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Choose your ship&apos;s custom <span className="font-mono-tabular text-amber-400">.ogg</span> death sound and high-velocity (<span className="font-mono-tabular text-slate-200">1,000+ u/s</span>) collision smash sound.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Close (Esc)
          </button>
        </div>

        {/* Folder Info & Refresh */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/90 bg-[#060913] px-3.5 py-2.5">
          <div className="font-mono-tabular text-[11px] text-slate-400">
            Folder: <span className="text-amber-400">src/components/deathsounds/*.ogg</span> ({controller.sounds.length} files)
          </div>
          <button
            onClick={() => controller.refreshFolder()}
            className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            Refresh Folder
          </button>
        </div>

        {/* 1. Personal Death Sound Selector */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-200">
              Your Ship Death Sound (Heard by all players when you die)
            </label>
            <span className="font-mono-tabular text-[11px] text-amber-400">
              Active: {controller.selectedDeathSound}
            </span>
          </div>

          <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {controller.sounds.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#060913] px-3 py-3 text-xs text-slate-400">
                No <span className="font-mono-tabular text-slate-200">.ogg</span> files found in{' '}
                <span className="font-mono-tabular text-amber-400">src/components/deathsounds/</span>.
              </div>
            ) : (
              controller.sounds.map((snd) => {
                const isSelected =
                  controller.selectedDeathSound.toLowerCase() === snd.filename.toLowerCase();
                return (
                  <div
                    key={`death_${snd.filename}`}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      isSelected
                        ? 'border-amber-500/80 bg-[#111C33] text-white'
                        : 'border-slate-800/90 bg-[#060913] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <button
                      onClick={() => {
                        controller.setSelectedDeathSound(snd.filename);
                        controller.previewSound(snd.filename);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="font-mono-tabular text-xs font-bold text-amber-400">
                        {isSelected ? '●' : '○'}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-mono-tabular text-xs font-medium text-white">
                          {snd.filename}
                        </div>
                        <div className="truncate text-[10px] text-slate-400 capitalize">
                          {snd.title}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => controller.previewSound(snd.filename)}
                        className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 font-mono-tabular text-[11px] text-slate-300 hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0"
                      >
                        ♪ Test
                      </button>
                      <button
                        onClick={() => controller.setSelectedDeathSound(snd.filename)}
                        className={`rounded px-2.5 py-1 font-mono-tabular text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950'
                            : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Use'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 2. High-Velocity (1,000+ u/s) Ship Smash Collision Sound Selector */}
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-rose-300">
              High-Speed Ship Smash Sound (1,000+ u/s Collision)
            </label>
            <span className="font-mono-tabular text-[11px] text-rose-400">
              Active: {controller.selectedSmashSound}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Plays when two ships smash into each other at <span className="font-mono-tabular text-slate-200">1,000+ u/s</span> relative velocity.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {controller.sounds.map((snd) => {
              const isSelected =
                controller.selectedSmashSound.toLowerCase() === snd.filename.toLowerCase();
              return (
                <button
                  key={`smash_${snd.filename}`}
                  onClick={() => {
                    controller.setSelectedSmashSound(snd.filename);
                    controller.previewSound(snd.filename);
                  }}
                  className={`rounded-lg border px-3 py-1.5 font-mono-tabular text-xs transition-colors ${
                    isSelected
                      ? 'border-rose-500 bg-rose-500/20 font-bold text-rose-300'
                      : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {isSelected ? '★ ' : ''}
                  {snd.filename}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-5 py-2 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
