import React, { useCallback, useEffect, useState } from 'react';
import { CheatActionType, PlayerCheats, PlayerState } from '../shared/types.ts';
import { MusicBoxContent, MusicBoxController } from './MusicBox.tsx';

export interface ShipPngOption {
  filename: string;
  title: string;
  url: string;
  sizeBytes?: number;
}

const bundledShipPngs = import.meta.glob('./ships/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getBundledShipPngOptions(): ShipPngOption[] {
  return Object.entries(bundledShipPngs)
    .map(([relPath, url]) => {
      const filename = relPath.split('/').pop() || relPath;
      return {
        filename,
        title: filename.replace(/\.png$/i, '').replace(/[_-]+/g, ' '),
        url,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

interface CheatMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  cheats: PlayerCheats;
  onUpdateCheats: (next: PlayerCheats) => void;
  onTriggerAction: (action: CheatActionType) => void;
  playerCount: number;
  players: PlayerState[];
  selfId: string;
  onCheatRenameShip: (targetId: string | 'ALL_OTHERS', newName: string) => void;
  musicBox: MusicBoxController;
  spectateTargetId: string | null;
  onSelectSpectateTarget: (targetId: string | null) => void;
  warpSpeedActive: boolean;
  onToggleWarpSpeed: () => void;
  selectedShipPng: string | null;
  onSelectShipPng: (filename: string | null) => void;
}

export const CheatMenuModal: React.FC<CheatMenuModalProps> = ({
  isOpen,
  onClose,
  cheats,
  onUpdateCheats,
  onTriggerAction,
  playerCount,
  players,
  selfId,
  onCheatRenameShip,
  musicBox,
  spectateTargetId,
  onSelectSpectateTarget,
  warpSpeedActive,
  onToggleWarpSpeed,
  selectedShipPng,
  onSelectShipPng,
}) => {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [batchName, setBatchName] = useState<string>('');
  const [shipPngFiles, setShipPngFiles] = useState<ShipPngOption[]>(() =>
    getBundledShipPngOptions()
  );
  const [loadingPngs, setLoadingPngs] = useState<boolean>(false);

  const otherShips = players
    .filter((p) => p.id !== selfId)
    .sort((a, b) => Number(Boolean(a.isDrone)) - Number(Boolean(b.isDrone)))
    .slice(0, 32);

  const refreshShipPngs = useCallback(async () => {
    setLoadingPngs(true);
    try {
      const res = await fetch('/api/ship-pngs');
      if (res.ok) {
        const data = (await res.json()) as { files?: ShipPngOption[] };
        if (Array.isArray(data.files) && data.files.length > 0) {
          setShipPngFiles(data.files);
          setLoadingPngs(false);
          return;
        }
      }
    } catch {
      // Fallback to Vite glob bundled .png files
    }
    setShipPngFiles(getBundledShipPngOptions());
    setLoadingPngs(false);
  }, []);

  // Only refresh PNGs when the Cheat Menu is opened — never on 80ms player telemetry updates!
  useEffect(() => {
    if (!isOpen) return;
    refreshShipPngs();
  }, [isOpen, refreshShipPngs]);

  if (!isOpen) return null;

  const toggleCheat = (key: keyof PlayerCheats) => {
    onUpdateCheats({
      ...cheats,
      [key]: !cheats[key],
    });
  };

  const handleApplySingleRename = (targetId: string, currentName: string) => {
    const val = (draftNames[targetId] ?? currentName).trim().slice(0, 16);
    if (val) {
      onCheatRenameShip(targetId, val);
    }
  };

  const handleApplyBatchRename = () => {
    const val = batchName.trim().slice(0, 16);
    if (!val) return;
    onCheatRenameShip('ALL_OTHERS', val);
    const updatedDrafts: Record<string, string> = {};
    for (const p of otherShips) {
      updatedDrafts[p.id] = val;
    }
    setDraftNames((prev) => ({ ...prev, ...updatedDrafts }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060913]/80 p-4 pointer-events-auto"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-rose-500/40 bg-[#0B1120] p-6 text-slate-100 shadow-2xl pointer-events-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              Cheat & Experimental Weapons Menu
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Press <span className="font-mono-tabular text-amber-400">K</span> or <span className="font-mono-tabular text-amber-400">Esc</span> anytime to toggle this menu. Changes apply immediately in live play.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Resume (K / Esc)
          </button>
        </div>

        {/* Toggleable Weapon & Hull Cheats */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* 1. Homing Seeker Missiles */}
          <button
            onClick={() => toggleCheat('homingMissiles')}
            className={`flex flex-col justify-between rounded-lg border p-3.5 text-left transition-colors ${
              cheats.homingMissiles
                ? 'border-rose-500 bg-rose-950/30 text-white'
                : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">
                Homing Seeker Missiles
              </span>
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  cheats.homingMissiles ? 'text-rose-400' : 'text-slate-500'
                }`}
              >
                {cheats.homingMissiles ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Replaces standard lasers with heat-seeking missiles that lock onto and chase other players&apos; ships.
            </p>
          </button>

          {/* 2. Rapid Hyper-Fire */}
          <button
            onClick={() => toggleCheat('rapidFire')}
            className={`flex flex-col justify-between rounded-lg border p-3.5 text-left transition-colors ${
              cheats.rapidFire
                ? 'border-amber-500 bg-amber-950/25 text-white'
                : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">
                Hyper-Rapid Fire
              </span>
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  cheats.rapidFire ? 'text-amber-400' : 'text-slate-500'
                }`}
              >
                {cheats.rapidFire ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Overclocks weapon capacitors to fire a relentless stream of bolts or homing missiles.
            </p>
          </button>

          {/* 3. 360° Nova Spread */}
          <button
            onClick={() => toggleCheat('novaSpread')}
            className={`flex flex-col justify-between rounded-lg border p-3.5 text-left transition-colors ${
              cheats.novaSpread
                ? 'border-sky-500 bg-sky-950/25 text-white'
                : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">
                360° Nova Salvo
              </span>
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  cheats.novaSpread ? 'text-sky-400' : 'text-slate-500'
                }`}
              >
                {cheats.novaSpread ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Zero cooldown! Unleashes a continuous 360-projectile omnidirectional barrage in all directions every frame you fire.
            </p>
          </button>

          {/* 4. God Mode Shield */}
          <button
            onClick={() => toggleCheat('godMode')}
            className={`flex flex-col justify-between rounded-lg border p-3.5 text-left transition-colors ${
              cheats.godMode
                ? 'border-emerald-500 bg-emerald-950/25 text-white'
                : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">
                God Mode Hull Shield
              </span>
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  cheats.godMode ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {cheats.godMode ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Full invulnerability against enemy fire, asteroid impacts, and the central Gravity Star.
            </p>
          </button>

          {/* 5. Disconnect Ship / Free-Cam & Spectate Mode (Spans 2 columns) */}
          <div
            className={`sm:col-span-2 rounded-lg border p-4 transition-colors ${
              cheats.freeCam
                ? 'border-cyan-400 bg-cyan-950/25 text-white'
                : 'border-slate-800 bg-[#060913] text-slate-300'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-sm font-bold text-white">
                    Disconnect Ship · Free-Cam &amp; Spectate Mode
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 font-mono-tabular text-[11px] font-bold ${
                      cheats.freeCam
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {cheats.freeCam
                      ? spectateTargetId
                        ? 'SPECTATING PLAYER'
                        : 'FREE-CAM ACTIVE'
                      : 'ATTACHED TO SHIP'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Disconnects the camera from your ship so you can fly freely around the sector (<span className="font-mono-tabular text-slate-200">WASD / Arrows / Stick</span>, hold <span className="font-mono-tabular text-slate-200">Shift</span> to boost) or lock onto other players. <span className="text-cyan-300 font-medium">Other players can see your mouse cursor live on their screen!</span>
                </p>
              </div>

              <button
                onClick={() => {
                  const nextActive = !cheats.freeCam;
                  if (!nextActive) {
                    onSelectSpectateTarget(null);
                  }
                  onUpdateCheats({
                    ...cheats,
                    freeCam: nextActive,
                  });
                }}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  cheats.freeCam
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                }`}
              >
                {cheats.freeCam ? 'Reconnect to Ship' : 'Disconnect & Fly Camera'}
              </button>
            </div>

            {/* Spectate Other Players / Free-Fly Selector */}
            <div className="mt-3.5 border-t border-slate-800/80 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Camera Mode &amp; Spectate Target (Press [ or ] in-game to cycle players)
                </span>
                <button
                  onClick={() => {
                    onSelectSpectateTarget(null);
                    if (!cheats.freeCam) {
                      onUpdateCheats({ ...cheats, freeCam: true });
                    }
                  }}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    cheats.freeCam && !spectateTargetId
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/50 hover:text-white'
                  }`}
                >
                  Free-Fly Camera (WASD / Stick)
                </button>
              </div>

              {otherShips.length === 0 ? (
                <div className="mt-2 text-xs text-slate-500">
                  No other ships in sector yet. Spawn target ships below or wait for another player to join to spectate them.
                </div>
              ) : (
                <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {otherShips.map((ship) => {
                    const isSpectatingThis = cheats.freeCam && spectateTargetId === ship.id;
                    return (
                      <button
                        key={ship.id}
                        onClick={() => {
                          onSelectSpectateTarget(ship.id);
                          if (!cheats.freeCam) {
                            onUpdateCheats({ ...cheats, freeCam: true });
                          }
                        }}
                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono-tabular transition-colors ${
                          isSpectatingThis
                            ? 'border-cyan-400 bg-cyan-500/25 text-white font-bold'
                            : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-600 hover:text-white'
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: ship.color }}
                        />
                        <span className="truncate max-w-[110px]">{ship.name}</span>
                        <span className="text-[10px] text-slate-400">
                          {isSpectatingThis ? '● VIEWING' : 'Spectate'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Instant Trigger Actions */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="text-xs font-medium text-slate-300">
            Instant Actions, Warp Speed Drive &amp; Target Spawner
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              onClick={onToggleWarpSpeed}
              className={`sm:col-span-2 rounded-lg border px-4 py-3 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                warpSpeedActive
                  ? 'border-cyan-400 bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                  : 'border-cyan-500/60 bg-cyan-950/35 text-cyan-300 hover:border-cyan-400 hover:text-white'
              }`}
            >
              {warpSpeedActive
                ? '⏹ STOP WARP SPEED & ZERO MOMENTUM HERE (E) · [INVINCIBLE ACTIVE]'
                : '⚡ ENGAGE WARP SPEED DRIVE · INVINCIBLE + CLICK AGAIN TO STOP AT 0 u/s (E)'}
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <button
              onClick={() => onTriggerAction('missile_swarm')}
              className="rounded-lg bg-rose-600 px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-rose-500 whitespace-nowrap shrink-0"
            >
              Fire 8x Missile Swarm (M)
            </button>
            <button
              onClick={() => onTriggerAction('momentum_boost')}
              className="rounded-lg border border-amber-500/50 bg-[#060913] px-3.5 py-2.5 text-xs font-semibold text-amber-400 transition-colors hover:border-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
            >
              +2,500 u/s Velocity Boost
            </button>
            <button
              onClick={() => onTriggerAction('momentum_zero')}
              className="rounded-lg border border-slate-700 bg-[#060913] px-3.5 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
            >
              Zero-Stop Momentum
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-slate-800/90 bg-[#060913] px-3.5 py-3">
            <div>
              <div className="text-xs font-semibold text-slate-200">
                Target Ship Fleet Spawner ({players.filter((p) => p.isDrone).length} spawned / {playerCount} total in sector)
              </div>
              <div className="text-[11px] text-slate-400">
                Spawn single target ships, unleash 100 target ships at once, or remove all spawned ships.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onTriggerAction('spawn_drone')}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0"
              >
                + Spawn 1 Target Ship
              </button>
              <button
                onClick={() => onTriggerAction('spawn_drones_100')}
                className="rounded-md border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors hover:border-amber-400 hover:bg-amber-500/25 hover:text-white whitespace-nowrap shrink-0"
              >
                + Spawn 100 Target Ships
              </button>
              <button
                onClick={() => onTriggerAction('clear_drones')}
                className="rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:border-rose-400 hover:bg-rose-900/40 hover:text-white whitespace-nowrap shrink-0"
              >
                Remove All Target Ships
              </button>
            </div>
          </div>
        </div>

        {/* ADMIN SHIP PNG SPRITE SELECTOR SECTION */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-display text-sm font-bold text-cyan-400">
                Admin Ship PNG Sprite Override
              </h3>
              <p className="text-[11px] text-slate-400">
                Select any <span className="font-mono-tabular text-slate-200">.png</span> image on the server (<span className="font-mono-tabular text-slate-200">src/components/ships/</span>) to replace your ship hull. Syncs live to all players!
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedShipPng && (
                <button
                  onClick={() => onSelectShipPng(null)}
                  className="rounded-lg border border-rose-500/50 bg-rose-950/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:border-rose-400 hover:text-white whitespace-nowrap shrink-0"
                >
                  Reset to Vector Ship
                </button>
              )}
              <button
                onClick={refreshShipPngs}
                disabled={loadingPngs}
                className="rounded-lg border border-slate-700 bg-[#060913] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400 hover:text-white whitespace-nowrap shrink-0"
              >
                {loadingPngs ? 'Scanning...' : 'Refresh PNG Folder'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {/* Option 0: Standard Vector Hull */}
            <button
              onClick={() => onSelectShipPng(null)}
              className={`flex flex-col items-center justify-between rounded-lg border p-3 text-center transition-colors ${
                !selectedShipPng
                  ? 'border-cyan-400 bg-cyan-950/30 text-white'
                  : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-slate-800 bg-[#0B1120]">
                <svg viewBox="-22 -22 44 44" className="h-8 w-8">
                  <polygon
                    points="16,0 -11,-7 -6,0 -11,7"
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2.4"
                  />
                </svg>
              </div>
              <div className="mt-2 w-full">
                <div className="truncate font-display text-xs font-bold text-white">
                  Default Vector
                </div>
                <div className="font-mono-tabular text-[10px] text-slate-400">
                  {!selectedShipPng ? '● ACTIVE' : 'Standard Hull'}
                </div>
              </div>
            </button>

            {/* Server PNG Options */}
            {shipPngFiles.map((png) => {
              const isSelected = selectedShipPng === png.filename;
              return (
                <button
                  key={png.filename}
                  onClick={() => onSelectShipPng(png.filename)}
                  className={`flex flex-col items-center justify-between rounded-lg border p-3 text-center transition-colors ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-950/30 text-white'
                      : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-slate-800 bg-[#0B1120] p-1">
                    <img
                      src={png.url}
                      alt={png.title}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="mt-2 w-full">
                    <div className="truncate font-display text-xs font-bold capitalize text-white">
                      {png.title}
                    </div>
                    <div className="truncate font-mono-tabular text-[10px] text-slate-400">
                      {isSelected ? '● ACTIVE ON SHIP' : png.filename}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* MUSIC BOX SECTION */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-display text-sm font-bold text-amber-400">
                Music Box
              </h3>
              <p className="text-[11px] text-slate-400">
                Play specific <span className="font-mono-tabular text-slate-200">.ogg</span> audio files directly out of <span className="font-mono-tabular text-slate-200">src/components/music/</span>.
              </p>
            </div>

            <button
              onClick={() => musicBox.setPinnedWindowOpen((prev) => !prev)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                musicBox.pinnedWindowOpen
                  ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                  : 'border-slate-700 bg-[#060913] text-slate-300 hover:border-amber-500/60 hover:text-white'
              }`}
            >
              {musicBox.pinnedWindowOpen
                ? 'Window Pinned While Flying: ON'
                : 'Keep Music Box on Screen While Flying'}
            </button>
          </div>

          <MusicBoxContent controller={musicBox} />
        </div>

        {/* Rename Other Ships Section */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-300">
                Override & Rename Other Ships in Sector
              </div>
              <div className="text-[11px] text-slate-500">
                Renames other players&apos; or target ships live across all screens.
              </div>
            </div>

            {otherShips.length > 0 && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={16}
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyBatchRename();
                  }}
                  placeholder="Rename all others..."
                  className="w-36 rounded-md border border-slate-700 bg-[#060913] px-2.5 py-1 font-mono-tabular text-xs text-white focus:border-rose-500 focus:outline-none"
                />
                <button
                  onClick={handleApplyBatchRename}
                  className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2.5 py-1 text-xs font-medium text-rose-300 hover:border-rose-400 hover:text-white whitespace-nowrap shrink-0"
                >
                  Rename All
                </button>
              </div>
            )}
          </div>

          {otherShips.length === 0 ? (
            <div className="mt-2.5 rounded-lg border border-slate-800/80 bg-[#060913] px-3.5 py-3 text-xs text-slate-400">
              No other ships are currently in the sector. Wait for another player to join or click <span className="text-slate-200">+ Spawn Target Ship</span> above to spawn ships you can rename.
            </div>
          ) : (
            <div className="mt-2.5 max-h-40 space-y-2 overflow-y-auto pr-1">
              {otherShips.map((ship) => {
                const draftVal = draftNames[ship.id] ?? ship.name;
                return (
                  <div
                    key={ship.id}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-slate-800/90 bg-[#060913] px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: ship.color }}
                      />
                      <span
                        className="truncate font-mono-tabular text-xs font-medium"
                        style={{ color: ship.color }}
                      >
                        {ship.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="text"
                        maxLength={16}
                        value={draftVal}
                        onChange={(e) =>
                          setDraftNames((prev) => ({
                            ...prev,
                            [ship.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleApplySingleRename(ship.id, ship.name);
                          }
                        }}
                        placeholder="New ship name"
                        className="w-36 rounded-md border border-slate-700 bg-[#0B1120] px-2.5 py-1 font-mono-tabular text-xs text-white focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        onClick={() => handleApplySingleRename(ship.id, ship.name)}
                        className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white whitespace-nowrap shrink-0"
                      >
                        Rename
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
          <button
            onClick={() => {
              onSelectSpectateTarget(null);
              onUpdateCheats({
                homingMissiles: false,
                rapidFire: false,
                novaSpread: false,
                godMode: false,
                freeCam: false,
              });
            }}
            className="text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
          >
            Disable All Cheats
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            Back to Game (K)
          </button>
        </div>
      </div>
    </div>
  );
};
