import React, { useEffect, useState } from 'react';
import {
  ControllerMapping,
  DEFAULT_CONTROLLER_MAPPING,
  GAMEPAD_BUTTON_LABELS,
} from '../game/input.ts';

interface ControllerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapping: ControllerMapping;
  onUpdateMapping: (next: ControllerMapping) => void;
}

type RemapTarget = 'thrustButtons' | 'fireButtons' | 'warpButtons' | null;
type ShipAssignTarget = 'p1' | 'p2' | null;

interface DetectedPadSummary {
  slotIndex: number;
  hardwareIndex: number;
  id: string;
  active: boolean;
  pressedButtons: number[];
}

export function formatControllerSlotLabel(slot: number, fallbackLabel: string = 'Keyboard Only'): string {
  if (slot < 0) return fallbackLabel;
  return `Controller ${slot + 1}`;
}

export const ControllerModal: React.FC<ControllerModalProps> = ({
  isOpen,
  onClose,
  mapping,
  onUpdateMapping,
}) => {
  const [listeningFor, setListeningFor] = useState<RemapTarget>(null);
  const [assigningShip, setAssigningShip] = useState<ShipAssignTarget>(null);
  const [detectedPads, setDetectedPads] = useState<DetectedPadSummary[]>([]);
  const [liveState, setLiveState] = useState<{
    connected: boolean;
    id: string;
    lx: number;
    ly: number;
    rx: number;
    ry: number;
    angleDeg: number;
    stickActive: boolean;
    pressedButtons: number[];
  }>({
    connected: false,
    id: '',
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    angleDeg: -90,
    stickActive: false,
    pressedButtons: [],
  });

  useEffect(() => {
    if (!isOpen) {
      setListeningFor(null);
      setAssigningShip(null);
      return;
    }

    let rafId = 0;
    let lastAngleDeg = -90;

    const poll = () => {
      const rawPads = navigator.getGamepads ? navigator.getGamepads() : [];
      const connectedPads: Gamepad[] = [];
      for (const p of rawPads) {
        if (p && p.connected) {
          connectedPads.push(p);
        }
      }

      const summaries: DetectedPadSummary[] = connectedPads.map((p, idx) => {
        const pressed: number[] = [];
        for (let i = 0; i < p.buttons.length; i++) {
          if (p.buttons[i]?.pressed || p.buttons[i]?.value > 0.4) {
            pressed.push(i);
          }
        }
        const lx = p.axes[0] ?? 0;
        const ly = p.axes[1] ?? 0;
        const rawRx = p.axes[2] ?? 0;
        const rawRy = p.axes[3] ?? 0;
        const rx = Math.abs(rawRx + 1) < 0.02 ? 0 : rawRx;
        const ry = Math.abs(rawRy + 1) < 0.02 ? 0 : rawRy;
        const stickMoved = Math.hypot(lx, ly) > 0.35 || Math.hypot(rx, ry) > 0.35;
        const slotIndex =
          typeof p.index === 'number' && p.index >= 0 && p.index <= 3 ? p.index : idx;
        return {
          slotIndex,
          hardwareIndex: p.index,
          id: p.id,
          active: pressed.length > 0 || stickMoved,
          pressedButtons: pressed,
        };
      });
      setDetectedPads(summaries);

      // If user clicked "Press Button on Controller to Assign P1 / P2", detect whichever gamepad has a button press or stick deflection
      if (assigningShip) {
        const triggered = summaries.find((s) => s.pressedButtons.length > 0 || s.active);
        if (triggered) {
          const chosenSlot = triggered.slotIndex;
          if (assigningShip === 'p1') {
            const nextP2 =
              mapping.p2ControllerIndex === chosenSlot
                ? mapping.p1ControllerIndex >= 0
                  ? mapping.p1ControllerIndex
                  : chosenSlot === 0
                  ? 1
                  : 0
                : mapping.p2ControllerIndex;
            onUpdateMapping({
              ...mapping,
              p1ControllerIndex: chosenSlot,
              p2ControllerIndex: nextP2,
            });
          } else {
            const nextP1 =
              mapping.p1ControllerIndex === chosenSlot
                ? mapping.p2ControllerIndex >= 0
                  ? mapping.p2ControllerIndex
                  : chosenSlot === 1
                  ? 0
                  : 1
                : mapping.p1ControllerIndex;
            onUpdateMapping({
              ...mapping,
              p1ControllerIndex: nextP1,
              p2ControllerIndex: chosenSlot,
            });
          }
          setAssigningShip(null);
        }
      }

      // Preview P1's mapped controller (or the first active/connected controller)
      const p1Pad =
        (mapping.p1ControllerIndex >= 0
          ? connectedPads.find((g) => g.index === mapping.p1ControllerIndex) ||
            connectedPads[mapping.p1ControllerIndex]
          : null) ||
        connectedPads[0] ||
        null;

      if (p1Pad) {
        const lx = p1Pad.axes[0] ?? 0;
        const ly = p1Pad.axes[1] ?? 0;
        const rawRx = p1Pad.axes[2] ?? 0;
        const rawRy = p1Pad.axes[3] ?? 0;
        const rx = Math.abs(rawRx + 1) < 0.02 ? 0 : rawRx;
        const ry = Math.abs(rawRy + 1) < 0.02 ? 0 : rawRy;
        const lMag = Math.hypot(lx, ly);
        const rMag = Math.hypot(rx, ry);

        let cx = lx;
        let cy = ly;
        let cMag = lMag;
        if (mapping.aimStick === 'right' || (mapping.aimStick === 'both' && rMag > lMag)) {
          cx = rx;
          cy = ry;
          cMag = rMag;
        }

        const active = cMag > mapping.deadzone;
        if (active) {
          lastAngleDeg = Math.round((Math.atan2(cy, cx) * 180) / Math.PI);
        }

        const pressed: number[] = [];
        for (let i = 0; i < p1Pad.buttons.length; i++) {
          if (p1Pad.buttons[i]?.pressed || p1Pad.buttons[i]?.value > 0.4) {
            pressed.push(i);
          }
        }

        // Also allow button remapping from any connected controller
        let anyPressedBtn: number | null = pressed.length > 0 ? pressed[0] : null;
        if (anyPressedBtn === null) {
          for (const s of summaries) {
            if (s.pressedButtons.length > 0) {
              anyPressedBtn = s.pressedButtons[0];
              break;
            }
          }
        }

        if (listeningFor && anyPressedBtn !== null) {
          const btnIdx = anyPressedBtn;
          const currentList = mapping[listeningFor];
          const nextList = currentList.includes(btnIdx)
            ? currentList
            : [btnIdx, ...currentList.slice(0, 2)];
          onUpdateMapping({
            ...mapping,
            [listeningFor]: nextList,
          });
          setListeningFor(null);
        }

        setLiveState({
          connected: true,
          id: p1Pad.id,
          lx,
          ly,
          rx,
          ry,
          angleDeg: lastAngleDeg,
          stickActive: active,
          pressedButtons: pressed,
        });
      } else {
        setLiveState((prev) => ({ ...prev, connected: false, id: '', pressedButtons: [] }));
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [assigningShip, isOpen, listeningFor, mapping, onUpdateMapping]);

  if (!isOpen) return null;

  const formatButtons = (indices: number[]) =>
    indices.map((i) => GAMEPAD_BUTTON_LABELS[i] || `Button ${i}`).join(' · ');

  const clearAndListen = (target: 'thrustButtons' | 'fireButtons' | 'warpButtons') => {
    onUpdateMapping({ ...mapping, [target]: [] });
    setListeningFor(target);
  };

  const handleAssignSlot = (ship: 'p1' | 'p2', slot: number) => {
    setAssigningShip(null);
    if (ship === 'p1') {
      // If P2 was using the same controller slot (and slot >= 0), swap P2 to P1's previous slot
      const nextP2 =
        slot >= 0 && mapping.p2ControllerIndex === slot
          ? mapping.p1ControllerIndex >= 0
            ? mapping.p1ControllerIndex
            : slot === 0
            ? 1
            : 0
          : mapping.p2ControllerIndex;
      onUpdateMapping({
        ...mapping,
        p1ControllerIndex: slot,
        p2ControllerIndex: nextP2,
      });
    } else {
      const nextP1 =
        slot >= 0 && mapping.p1ControllerIndex === slot
          ? mapping.p2ControllerIndex >= 0
            ? mapping.p2ControllerIndex
            : slot === 1
            ? 0
            : 1
          : mapping.p1ControllerIndex;
      onUpdateMapping({
        ...mapping,
        p1ControllerIndex: nextP1,
        p2ControllerIndex: slot,
      });
    }
  };

  const handleSwapShipControllers = () => {
    setAssigningShip(null);
    onUpdateMapping({
      ...mapping,
      p1ControllerIndex: mapping.p2ControllerIndex,
      p2ControllerIndex: mapping.p1ControllerIndex,
    });
  };

  const p1Detected = detectedPads.find((d) => d.slotIndex === mapping.p1ControllerIndex);
  const p2Detected = detectedPads.find((d) => d.slotIndex === mapping.p2ControllerIndex);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060913]/88 p-4 pointer-events-auto overflow-y-auto"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0B1120] p-5 md:p-6 text-slate-100 shadow-2xl pointer-events-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              Ship Controller Mapping &amp; Vector Aim Setup
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Map any controller to Player 1 or Player 2, or tilt the stick to point your ship in any 360° direction.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Close (Esc)
          </button>
        </div>

        {/* ==================== SHIP CONTROLLER ASSIGNMENT (P1 vs P2) ==================== */}
        <div className="mt-4 rounded-xl border border-cyan-500/35 bg-[#060913] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/90">
            <div>
              <div className="font-display text-xs font-bold uppercase tracking-wider text-cyan-300">
                Map Controllers to Ships (Player 1 &amp; Player 2)
              </div>
              <div className="text-[11px] text-slate-400">
                Choose which controller drives each ship, or click &ldquo;Detect Button&rdquo; and press any button on the controller you want to use.
              </div>
            </div>
            <button
              type="button"
              onClick={handleSwapShipControllers}
              className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 font-mono-tabular text-xs font-bold text-amber-300 hover:border-amber-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              ⇄ Swap P1 &amp; P2 Controllers
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Player 1 Ship Controller Card */}
            <div className="rounded-lg border border-sky-500/40 bg-[#0B1120] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-display text-xs font-bold text-sky-300">
                    PLAYER 1 SHIP (P1)
                  </span>
                  <span className="ml-2 font-mono-tabular text-[11px] text-slate-400">
                    + WASD / Space
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAssigningShip(assigningShip === 'p1' ? null : 'p1')
                  }
                  className={`rounded px-2 py-1 font-mono-tabular text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    assigningShip === 'p1'
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : 'border border-sky-500/50 bg-[#060913] text-sky-300 hover:border-sky-400 hover:text-white'
                  }`}
                >
                  {assigningShip === 'p1'
                    ? 'Press Any Button on Pad...'
                    : '🎯 Detect Button'}
                </button>
              </div>

              <div className="mt-2 grid grid-cols-5 gap-1">
                {[
                  { slot: 0, label: 'Pad 1' },
                  { slot: 1, label: 'Pad 2' },
                  { slot: 2, label: 'Pad 3' },
                  { slot: 3, label: 'Pad 4' },
                  { slot: -1, label: 'KB Only' },
                ].map((opt) => {
                  const selected = mapping.p1ControllerIndex === opt.slot;
                  const isConnected = detectedPads.some((d) => d.slotIndex === opt.slot);
                  return (
                    <button
                      key={opt.slot}
                      type="button"
                      onClick={() => handleAssignSlot('p1', opt.slot)}
                      className={`rounded border px-1.5 py-1.5 font-mono-tabular text-[11px] font-bold transition-colors cursor-pointer ${
                        selected
                          ? 'border-sky-400 bg-sky-500/25 text-white'
                          : 'border-slate-800 bg-[#060913] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      <div>{opt.label}</div>
                      {opt.slot >= 0 && (
                        <div
                          className={`text-[9px] ${
                            isConnected ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                        >
                          {isConnected ? '● Ready' : '○ Empty'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 truncate font-mono-tabular text-[11px] text-slate-400">
                {mapping.p1ControllerIndex < 0 ? (
                  <span>Assigned: Keyboard (WASD + Space) &amp; Mouse Only</span>
                ) : p1Detected ? (
                  <span className="text-emerald-300">
                    Connected: Pad {mapping.p1ControllerIndex + 1} ({p1Detected.id})
                  </span>
                ) : (
                  <span>
                    Assigned: Controller {mapping.p1ControllerIndex + 1} (Press any button on controller to wake)
                  </span>
                )}
              </div>
            </div>

            {/* Player 2 Ship Controller Card */}
            <div className="rounded-lg border border-emerald-500/40 bg-[#0B1120] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-display text-xs font-bold text-emerald-300">
                    PLAYER 2 SHIP (P2)
                  </span>
                  <span className="ml-2 font-mono-tabular text-[11px] text-slate-400">
                    + Arrows / Enter
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAssigningShip(assigningShip === 'p2' ? null : 'p2')
                  }
                  className={`rounded px-2 py-1 font-mono-tabular text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    assigningShip === 'p2'
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : 'border border-emerald-500/50 bg-[#060913] text-emerald-300 hover:border-emerald-400 hover:text-white'
                  }`}
                >
                  {assigningShip === 'p2'
                    ? 'Press Any Button on Pad...'
                    : '🎯 Detect Button'}
                </button>
              </div>

              <div className="mt-2 grid grid-cols-5 gap-1">
                {[
                  { slot: 0, label: 'Pad 1' },
                  { slot: 1, label: 'Pad 2' },
                  { slot: 2, label: 'Pad 3' },
                  { slot: 3, label: 'Pad 4' },
                  { slot: -1, label: 'Arrows' },
                ].map((opt) => {
                  const selected = mapping.p2ControllerIndex === opt.slot;
                  const isConnected = detectedPads.some((d) => d.slotIndex === opt.slot);
                  return (
                    <button
                      key={opt.slot}
                      type="button"
                      onClick={() => handleAssignSlot('p2', opt.slot)}
                      className={`rounded border px-1.5 py-1.5 font-mono-tabular text-[11px] font-bold transition-colors cursor-pointer ${
                        selected
                          ? 'border-emerald-400 bg-emerald-500/25 text-white'
                          : 'border-slate-800 bg-[#060913] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      <div>{opt.label}</div>
                      {opt.slot >= 0 && (
                        <div
                          className={`text-[9px] ${
                            isConnected ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                        >
                          {isConnected ? '● Ready' : '○ Empty'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 truncate font-mono-tabular text-[11px] text-slate-400">
                {mapping.p2ControllerIndex < 0 ? (
                  <span>Assigned: Keyboard Arrow Keys + Enter/RShift Only</span>
                ) : p2Detected ? (
                  <span className="text-emerald-300">
                    Connected: Pad {mapping.p2ControllerIndex + 1} ({p2Detected.id})
                  </span>
                ) : (
                  <span>
                    Assigned: Controller {mapping.p2ControllerIndex + 1} (Press any button on controller to wake)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Live Connected Gamepads Activity Strip */}
          {detectedPads.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono-tabular">
              <span className="text-slate-400">Detected Gamepads:</span>
              {detectedPads.map((d) => (
                <span
                  key={d.hardwareIndex}
                  className={`rounded px-2 py-0.5 border ${
                    d.active
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200 font-bold'
                      : 'border-slate-800 bg-[#0B1120] text-slate-300'
                  }`}
                >
                  Pad {d.slotIndex + 1}
                  {mapping.p1ControllerIndex === d.slotIndex ? ' [P1]' : ''}
                  {mapping.p2ControllerIndex === d.slotIndex ? ' [P2]' : ''}
                  {d.active ? ' · ACTIVE' : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Live Joystick Direction Visualizer + Stick Selection */}
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800/90 bg-[#060913] p-4 md:col-span-5">
            <div className="text-xs font-medium text-slate-400">
              {liveState.connected ? 'Gamepad Active' : 'Press Any Controller Button'}
            </div>
            <div className="mt-0.5 max-w-full truncate text-[11px] text-slate-500">
              {liveState.connected ? liveState.id : 'USB / Bluetooth Standard Gamepad'}
            </div>

            {/* 360° Vector Compass Preview */}
            <div className="relative my-3.5 flex h-32 w-32 items-center justify-center rounded-full border border-slate-800 bg-[#0B1120]">
              {/* Crosshairs */}
              <div className="absolute inset-x-3 top-1/2 h-px bg-slate-800" />
              <div className="absolute inset-y-3 left-1/2 w-px bg-slate-800" />

              {/* Deadzone circle */}
              <div
                className="rounded-full border border-dashed border-amber-500/40"
                style={{
                  width: `${Math.round(mapping.deadzone * 128)}px`,
                  height: `${Math.round(mapping.deadzone * 128)}px`,
                }}
              />

              {/* Rotating Ship Preview matching exact Joystick Angle */}
              <svg
                viewBox="-24 -24 48 48"
                className="h-18 w-18 overflow-visible"
                style={{ transform: `rotate(${liveState.angleDeg}deg)` }}
              >
                <polygon
                  points="18,0 -12,-9 -7,0 -12,9"
                  fill="#0F172A"
                  stroke={liveState.stickActive ? '#F59E0B' : '#38BDF8'}
                  strokeWidth="2.2"
                />
                <line
                  x1="18"
                  y1="0"
                  x2="28"
                  y2="0"
                  stroke="#F59E0B"
                  strokeWidth="2"
                  strokeDasharray="2 2"
                />
              </svg>
            </div>

            <div className="font-mono-tabular text-xs text-slate-300">
              Heading: <span className="text-amber-400">{liveState.angleDeg}°</span>
              <span className="mx-2 text-slate-600">·</span>
              <span>{liveState.stickActive ? 'Direct Lock' : 'Hold Angle'}</span>
            </div>
          </div>

          {/* Stick & Button Mappings */}
          <div className="flex flex-col justify-between space-y-3.5 md:col-span-7">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Directional Pointing Joystick
              </label>
              <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#060913] p-1 border border-slate-800">
                {(['both', 'left', 'right'] as const).map((stick) => (
                  <button
                    key={stick}
                    type="button"
                    onClick={() => onUpdateMapping({ ...mapping, aimStick: stick })}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mapping.aimStick === stick
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {stick === 'both'
                      ? 'Either Stick'
                      : stick === 'left'
                      ? 'Left Stick Only'
                      : 'Right Stick Only'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Joystick Deadzone</span>
                <span className="font-mono-tabular text-amber-400">
                  {Math.round(mapping.deadzone * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.06"
                max="0.35"
                step="0.01"
                value={mapping.deadzone}
                onChange={(e) =>
                  onUpdateMapping({ ...mapping, deadzone: parseFloat(e.target.value) })
                }
                className="mt-1.5 w-full accent-amber-500"
              />
            </div>

            {/* Controller Button Remapping Rows */}
            <div className="space-y-2 pt-0.5">
              {(
                [
                  { key: 'thrustButtons', label: 'Thrust (Infinite Momentum)' },
                  { key: 'fireButtons', label: 'Fire Primary Weapon' },
                  { key: 'warpButtons', label: 'Hyperspace Warp Jump' },
                ] as const
              ).map((item) => {
                const isListening = listeningFor === item.key;
                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/90 bg-[#060913] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200">{item.label}</div>
                      <div className="truncate text-[11px] text-slate-400">
                        {isListening
                          ? 'Press any button or trigger on your controller...'
                          : formatButtons(mapping[item.key]) || 'Unbound'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setListeningFor(isListening ? null : item.key)
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isListening
                            ? 'bg-amber-500 text-slate-950'
                            : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        {isListening ? 'Listening...' : 'Add Button'}
                      </button>
                      <button
                        type="button"
                        onClick={() => clearAndListen(item.key)}
                        className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Rebind
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Keyboard Fallback Mode */}
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Player 1 Keyboard / Mouse Steering Mode
              </label>
              <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#060913] p-1 border border-slate-800">
                {(
                  [
                    { id: 'mouse_aim', label: 'A/D Turn + Mouse Aim' },
                    { id: 'direct_wasd', label: 'Direct WASD Point' },
                    { id: 'classic_turn', label: 'Classic A/D Turn Only' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() =>
                      onUpdateMapping({ ...mapping, keyboardAimMode: mode.id })
                    }
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mapping.keyboardAimMode === mode.id
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-3.5">
          <button
            type="button"
            onClick={() => onUpdateMapping({ ...DEFAULT_CONTROLLER_MAPPING })}
            className="text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset to Standard Gamepad Defaults (P1: Pad 1 · P2: Pad 2)
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Save &amp; Return
          </button>
        </div>
      </div>
    </div>
  );
};

