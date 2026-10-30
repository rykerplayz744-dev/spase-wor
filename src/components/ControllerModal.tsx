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

export const ControllerModal: React.FC<ControllerModalProps> = ({
  isOpen,
  onClose,
  mapping,
  onUpdateMapping,
}) => {
  const [listeningFor, setListeningFor] = useState<RemapTarget>(null);
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
      return;
    }

    let rafId = 0;
    let lastAngleDeg = -90;

    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp: Gamepad | null = null;
      for (const p of pads) {
        if (p && p.connected) {
          gp = p;
          break;
        }
      }

      if (gp) {
        const lx = gp.axes[0] ?? 0;
        const ly = gp.axes[1] ?? 0;
        const rx = gp.axes[2] ?? 0;
        const ry = gp.axes[3] ?? 0;
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
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i]?.pressed || gp.buttons[i]?.value > 0.4) {
            pressed.push(i);
          }
        }

        if (listeningFor && pressed.length > 0) {
          const btnIdx = pressed[0];
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
          id: gp.id,
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
  }, [isOpen, listeningFor, mapping, onUpdateMapping]);

  if (!isOpen) return null;

  const formatButtons = (indices: number[]) =>
    indices.map((i) => GAMEPAD_BUTTON_LABELS[i] || `Button ${i}`).join(' · ');

  const clearAndListen = (target: 'thrustButtons' | 'fireButtons' | 'warpButtons') => {
    onUpdateMapping({ ...mapping, [target]: [] });
    setListeningFor(target);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060913]/88 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0B1120] p-6 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              Controller & Direct Vector Aiming Setup
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Tilting the joystick points your ship nose in that exact 360° direction immediately.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>

        {/* Live Joystick Direction Visualizer + Stick Selection */}
        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800/90 bg-[#060913] p-4 md:col-span-5">
            <div className="text-xs font-medium text-slate-400">
              {liveState.connected ? 'Gamepad Active' : 'Press Any Controller Button'}
            </div>
            <div className="mt-0.5 max-w-full truncate text-[11px] text-slate-500">
              {liveState.connected ? liveState.id : 'USB / Bluetooth Standard Gamepad'}
            </div>

            {/* 360° Vector Compass Preview */}
            <div className="relative my-4 flex h-36 w-36 items-center justify-center rounded-full border border-slate-800 bg-[#0B1120]">
              {/* Crosshairs */}
              <div className="absolute inset-x-3 top-1/2 h-px bg-slate-800" />
              <div className="absolute inset-y-3 left-1/2 w-px bg-slate-800" />

              {/* Deadzone circle */}
              <div
                className="rounded-full border border-dashed border-amber-500/40"
                style={{
                  width: `${Math.round(mapping.deadzone * 144)}px`,
                  height: `${Math.round(mapping.deadzone * 144)}px`,
                }}
              />

              {/* Rotating Ship Preview matching exact Joystick Angle */}
              <svg
                viewBox="-24 -24 48 48"
                className="h-20 w-20 overflow-visible"
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
          <div className="flex flex-col justify-between space-y-4 md:col-span-7">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Directional Pointing Joystick
              </label>
              <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#060913] p-1 border border-slate-800">
                {(['both', 'left', 'right'] as const).map((stick) => (
                  <button
                    key={stick}
                    onClick={() => onUpdateMapping({ ...mapping, aimStick: stick })}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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
            <div className="space-y-2 pt-1">
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
                        onClick={() =>
                          setListeningFor(isListening ? null : item.key)
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          isListening
                            ? 'bg-amber-500 text-slate-950'
                            : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        {isListening ? 'Listening...' : 'Add Button'}
                      </button>
                      <button
                        onClick={() => clearAndListen(item.key)}
                        className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 whitespace-nowrap shrink-0"
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
                Keyboard / Mouse Fallback Mode
              </label>
              <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#060913] p-1 border border-slate-800">
                {(
                  [
                    { id: 'mouse_aim', label: 'Point to Cursor' },
                    { id: 'direct_wasd', label: 'Direct WASD Point' },
                    { id: 'classic_turn', label: 'Classic A/D Turn' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() =>
                      onUpdateMapping({ ...mapping, keyboardAimMode: mode.id })
                    }
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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

        <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
          <button
            onClick={() => onUpdateMapping({ ...DEFAULT_CONTROLLER_MAPPING })}
            className="text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
          >
            Reset to Standard Gamepad Defaults
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            Save & Return
          </button>
        </div>
      </div>
    </div>
  );
};
