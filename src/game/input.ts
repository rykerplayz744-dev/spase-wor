export interface ControllerMapping {
  aimStick: 'left' | 'right' | 'both';
  deadzone: number;
  thrustButtons: number[]; // Default: RT (7), A/Cross (0), LT (6), L3 (10)
  fireButtons: number[]; // Default: RB (5), X/Square (2), B/Circle (1), R3 (11)
  warpButtons: number[]; // Default: Y/Triangle (3), LB (4)
  pauseButtons: number[]; // Default: Start/Options (9)
  keyboardAimMode: 'direct_wasd' | 'mouse_aim' | 'classic_turn';
  p1ControllerIndex: number; // 0 = Controller 1, 1 = Controller 2, 2 = Controller 3, 3 = Controller 4, -1 = Keyboard/Mouse Only
  p2ControllerIndex: number; // 1 = Controller 2, 0 = Controller 1, 2 = Controller 3, 3 = Controller 4, -1 = Keyboard Arrows Only
}

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  aimStick: 'both',
  deadzone: 0.14,
  thrustButtons: [7, 0, 6], // RT, South (A/Cross), LT
  fireButtons: [5, 2, 1], // RB, West (X/Square), East (B/Circle)
  warpButtons: [3, 4], // North (Y/Triangle), LB
  pauseButtons: [9], // Start / Options
  keyboardAimMode: 'mouse_aim',
  p1ControllerIndex: 0,
  p2ControllerIndex: 1,
};

export const GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A / Cross (South)',
  1: 'B / Circle (East)',
  2: 'X / Square (West)',
  3: 'Y / Triangle (North)',
  4: 'LB / L1 (Left Bumper)',
  5: 'RB / R1 (Right Bumper)',
  6: 'LT / L2 (Left Trigger)',
  7: 'RT / R2 (Right Trigger)',
  8: 'Back / Select / Share',
  9: 'Start / Options',
  10: 'L3 (Left Stick Press)',
  11: 'R3 (Right Stick Press)',
  12: 'D-Pad Up',
  13: 'D-Pad Down',
  14: 'D-Pad Left',
  15: 'D-Pad Right',
};

export interface SampledInput {
  angle: number;
  thrusting: boolean;
  shooting: boolean;
  warpJustPressed: boolean;
  pauseJustPressed: boolean;
  startJustPressed: boolean;
  cheatMenuJustPressed: boolean;
  missileSwarmJustPressed: boolean;
  autoFireToggleJustPressed: boolean;
  inputSource: 'gamepad' | 'keyboard';
  gamepadConnected: boolean;
  gamepadName: string;
  stickVector: { x: number; y: number; magnitude: number; active: boolean };
  pressedButtonIndices: number[];
  mouseScreenX: number;
  mouseScreenY: number;
  panVector: { x: number; y: number };
  boostHeld: boolean;
  spectatePrevJustPressed: boolean;
  spectateNextJustPressed: boolean;
}

export function loadControllerMapping(): ControllerMapping {
  try {
    const raw = localStorage.getItem('spacewar_controller_mapping_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONTROLLER_MAPPING,
        ...parsed,
        p1ControllerIndex:
          typeof parsed.p1ControllerIndex === 'number'
            ? parsed.p1ControllerIndex
            : DEFAULT_CONTROLLER_MAPPING.p1ControllerIndex,
        p2ControllerIndex:
          typeof parsed.p2ControllerIndex === 'number'
            ? parsed.p2ControllerIndex
            : DEFAULT_CONTROLLER_MAPPING.p2ControllerIndex,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_CONTROLLER_MAPPING };
}

export function saveControllerMapping(mapping: ControllerMapping) {
  try {
    localStorage.setItem('spacewar_controller_mapping_v1', JSON.stringify(mapping));
  } catch {
    // ignore storage errors
  }
}

export class InputManager {
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private prevGamepadButtons = new Map<number, boolean[]>();
  private mousePos = {
    x: typeof window !== 'undefined' ? window.innerWidth * 0.5 : 640,
    y: typeof window !== 'undefined' ? window.innerHeight * 0.5 : 360,
  };
  private mouseMovedRecently = false;
  private mouseLeftDown = false;
  private mouseRightDown = false;
  private currentAngle = -Math.PI / 2; // Default facing Up
  private lastInputSource: 'gamepad' | 'keyboard' = 'keyboard';
  private mapping: ControllerMapping;

  private cachedGamepads: Gamepad[] = [];
  private lastGamepadPollAt = 0;

  constructor() {
    this.mapping = loadControllerMapping();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('focusin', this.onFocusIn);
      window.addEventListener('mousemove', this.onMouseMove, { passive: true });
      window.addEventListener('mousedown', this.onMouseDown, { passive: true });
      window.addEventListener('mouseup', this.onMouseUp, { passive: true });
      window.addEventListener('pointerup', this.onPointerUpOrCancel, { passive: true });
      window.addEventListener('pointercancel', this.onPointerUpOrCancel, { passive: true });
      window.addEventListener('touchend', this.onTouchEndOrCancel, { passive: true });
      window.addEventListener('touchcancel', this.onTouchEndOrCancel, { passive: true });
      window.addEventListener('contextmenu', this.onContextMenu);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focusin', this.onFocusIn);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mouseup', this.onMouseUp);
      window.removeEventListener('pointerup', this.onPointerUpOrCancel);
      window.removeEventListener('pointercancel', this.onPointerUpOrCancel);
      window.removeEventListener('touchend', this.onTouchEndOrCancel);
      window.removeEventListener('touchcancel', this.onTouchEndOrCancel);
      window.removeEventListener('contextmenu', this.onContextMenu);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  public getMapping(): ControllerMapping {
    return this.mapping;
  }

  public updateMapping(next: ControllerMapping) {
    this.mapping = next;
    saveControllerMapping(next);
  }

  public setAngle(angle: number) {
    this.currentAngle = angle;
  }

  public clearHeldInputs() {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    this.mouseMovedRecently = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Never intercept ChromeOS system shortcuts, browser tab/window controls, or function keys
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const code = e.code || (e.key === 'Escape' ? 'Escape' : '');

    // Always allow Escape to release pointer lock and blur inputs on Chromebooks
    if (code === 'Escape' || e.key === 'Escape' || e.key === 'BrowserBack') {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.tagName === 'BUTTON')
      ) {
        active.blur();
      }
      if (!e.repeat) {
        this.justPressedKeys.add('Escape');
      }
      return;
    }

    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Prevent Space or Enter (used for P1/P2 firing) from activating a previously clicked HUD <button> (such as Remove P2 or Switch Room)
    if (tag === 'BUTTON' || (typeof document !== 'undefined' && document.activeElement?.tagName === 'BUTTON')) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
        e.preventDefault();
      }
    }

    // One-shot toggle keys should always register on non-repeat keydown even if ChromeOS swallowed a prior keyup
    const isOneShotKey =
      code === 'KeyK' ||
      code === 'KeyP' ||
      code === 'KeyE' ||
      code === 'KeyQ' ||
      code === 'KeyF' ||
      code === 'Enter' ||
      code === 'BracketLeft' ||
      code === 'BracketRight';

    if (!this.heldKeys.has(code) || (isOneShotKey && !e.repeat)) {
      this.justPressedKeys.add(code);
    }
    this.heldKeys.add(code);
    // Only mark P1 input source as keyboard if it's not a P2-only arrow key
    if (
      code !== 'ArrowUp' &&
      code !== 'ArrowDown' &&
      code !== 'ArrowLeft' &&
      code !== 'ArrowRight' &&
      code !== 'ShiftRight' &&
      code !== 'Slash' &&
      code !== 'Period'
    ) {
      this.lastInputSource = 'keyboard';
      this.mouseMovedRecently = false;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code) {
      this.heldKeys.delete(e.code);
    }
    if (e.key === 'Escape') {
      this.heldKeys.delete('Escape');
    }
  };

  private onFocusIn = (e: FocusEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      this.clearHeldInputs();
    }
  };

  private onBlur = () => {
    this.clearHeldInputs();
  };

  private onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.clearHeldInputs();
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    const moveDist = Math.hypot(e.clientX - this.mousePos.x, e.clientY - this.mousePos.y);
    this.mousePos.x = e.clientX;
    this.mousePos.y = e.clientY;
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'CANVAS' && moveDist >= 4) {
      this.mouseMovedRecently = true;
    }
    // Chromebook touchpad safeguard: if no mouse buttons are physically held during move, clear any stuck button state
    if (typeof e.buttons === 'number') {
      if ((e.buttons & 1) === 0 && this.mouseLeftDown) {
        this.mouseLeftDown = false;
      }
      if ((e.buttons & 2) === 0 && this.mouseRightDown) {
        this.mouseRightDown = false;
      }
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    const target = e.target as HTMLElement | null;
    // Only treat clicks directly on the game <canvas> as ship fire/thrust; never intercept UI buttons or modals
    if (
      !target ||
      target.tagName !== 'CANVAS' ||
      target.closest('button, input, textarea, select, a, label, [role="button"], [role="dialog"]')
    ) {
      this.mouseLeftDown = false;
      this.mouseRightDown = false;
      return;
    }
    if (e.button === 0) {
      this.mouseLeftDown = true;
      this.lastInputSource = 'keyboard';
    } else if (e.button === 2) {
      this.mouseRightDown = true;
      this.lastInputSource = 'keyboard';
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseLeftDown = false;
    if (e.button === 2) this.mouseRightDown = false;
    if (typeof e.buttons === 'number' && e.buttons === 0) {
      this.mouseLeftDown = false;
      this.mouseRightDown = false;
    }
  };

  private onPointerUpOrCancel = () => {
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
  };

  private onTouchEndOrCancel = () => {
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
  };

  private onContextMenu = (e: MouseEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'CANVAS') {
      e.preventDefault();
    }
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
  };

  public getConnectedGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastGamepadPollAt < 16) {
      return this.cachedGamepads;
    }
    this.lastGamepadPollAt = now;
    try {
      const list = navigator.getGamepads();
      const result: Gamepad[] = [];
      for (const gp of list) {
        if (gp && gp.connected) {
          result.push(gp);
        }
      }
      this.cachedGamepads = result;
      return result;
    } catch {
      return this.cachedGamepads;
    }
  }

  /**
   * Resolves a controller by slot index (0..3), or returns null if slotIndex < 0 (Keyboard Only).
   */
  public getGamepadBySlot(slotIndex: number): Gamepad | null {
    if (slotIndex < 0) return null;
    const connected = this.getConnectedGamepads();
    if (connected.length === 0) return null;
    const byHardwareIdx = connected.find((g) => g.index === slotIndex);
    if (byHardwareIdx) return byHardwareIdx;
    return connected[slotIndex] || null;
  }

  private p2Angle = -Math.PI / 2;
  private p2WarpWasHeld = false;
  private p2LastInputSource: 'gamepad' | 'keyboard' = 'keyboard';
  private prevGamepadStick = new Map<number, { x: number; y: number }>();

  /**
   * Samples both Gamepad and Keyboard/Mouse inputs for Player 1 (Pad 1) on the current frame.
   * - Keyboard (WASD + Space/Mouse) ALWAYS controls Player 1 even when a controller is set to Pad 1.
   * - A connected controller on Pad 1 never locks out or snaps back keyboard turning (A/D or WASD).
   */
  public sample(
    dt: number,
    shipScreenX: number,
    shipScreenY: number,
    gamepadIndexOverride?: number,
    splitKeyboardForP2: boolean = false,
    isFixedCameraArena: boolean = false
  ): SampledInput {
    // 1. Check Player 1 Keyboard & Mouse state first so keyboard always works even when a controller is set to Pad 1
    const kbUp =
      this.heldKeys.has('KeyW') || (!splitKeyboardForP2 && this.heldKeys.has('ArrowUp'));
    const kbDown =
      this.heldKeys.has('KeyS') || (!splitKeyboardForP2 && this.heldKeys.has('ArrowDown'));
    const kbLeft =
      this.heldKeys.has('KeyA') || (!splitKeyboardForP2 && this.heldKeys.has('ArrowLeft'));
    const kbRight =
      this.heldKeys.has('KeyD') || (!splitKeyboardForP2 && this.heldKeys.has('ArrowRight'));

    const kbThrust =
      this.mapping.keyboardAimMode === 'direct_wasd'
        ? this.heldKeys.has('ShiftLeft') ||
          (!splitKeyboardForP2 && this.heldKeys.has('ShiftRight')) ||
          this.mouseRightDown
        : kbUp || this.heldKeys.has('ShiftLeft') || this.mouseRightDown;

    const kbShoot =
      this.heldKeys.has('Space') ||
      this.heldKeys.has('KeyJ') ||
      this.mouseLeftDown;

    const anyP1KeyboardHeld =
      kbUp ||
      kbDown ||
      kbLeft ||
      kbRight ||
      kbThrust ||
      kbShoot ||
      this.mouseLeftDown ||
      this.mouseRightDown ||
      this.mouseMovedRecently;

    if (anyP1KeyboardHeld) {
      this.lastInputSource = 'keyboard';
    }

    // 2. Sample Gamepad mapped to Player 1 (default Pad 1 / slot 0)
    const p1Slot =
      typeof gamepadIndexOverride === 'number'
        ? gamepadIndexOverride
        : this.mapping.p1ControllerIndex;
    const gp = this.getGamepadBySlot(p1Slot);

    let stickVector = { x: 0, y: 0, magnitude: 0, active: false };
    const pressedButtonIndices: number[] = [];
    let gpThrust = false;
    let gpShoot = false;
    let gpWarpJustPressed = false;
    let gpPauseJustPressed = false;
    let gpStartJustPressed = false;
    let gpAutoFireJustPressed = false;

    if (gp) {
      const prevBtns = this.prevGamepadButtons.get(gp.index) || [];
      const currBtns: boolean[] = [];

      for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        const isPressed = Boolean(b && (b.pressed || b.value > 0.35));
        currBtns[i] = isPressed;
        if (isPressed) {
          pressedButtonIndices.push(i);
          if (!anyP1KeyboardHeld) {
            this.lastInputSource = 'gamepad';
          }
        }
      }

      const wasJustPressed = (btnIdx: number) => Boolean(currBtns[btnIdx] && !prevBtns[btnIdx]);

      // Sample joystick axes for direct directional pointing
      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;
      const rawRx = gp.axes[2] ?? 0;
      const rawRy = gp.axes[3] ?? 0;
      // Guard against unpressed analog triggers resting at -1.0 on axes[2]/axes[3] on Linux/ChromeOS
      const rx = Math.abs(rawRx + 1) < 0.02 ? 0 : rawRx;
      const ry = Math.abs(rawRy + 1) < 0.02 ? 0 : rawRy;

      const lMag = Math.hypot(lx, ly);
      const rMag = Math.hypot(rx, ry);

      let chosenX = 0;
      let chosenY = 0;
      let chosenMag = 0;

      if (this.mapping.aimStick === 'left') {
        chosenX = lx;
        chosenY = ly;
        chosenMag = lMag;
      } else if (this.mapping.aimStick === 'right') {
        chosenX = rx;
        chosenY = ry;
        chosenMag = rMag;
      } else {
        if (rMag > lMag) {
          chosenX = rx;
          chosenY = ry;
          chosenMag = rMag;
        } else {
          chosenX = lx;
          chosenY = ly;
          chosenMag = lMag;
        }
      }

      // Also support D-Pad direct 8-way pointing if stick is neutral
      let dpadActive = false;
      if (chosenMag <= this.mapping.deadzone) {
        const dUp = currBtns[12] ? -1 : 0;
        const dDown = currBtns[13] ? 1 : 0;
        const dLeft = currBtns[14] ? -1 : 0;
        const dRight = currBtns[15] ? 1 : 0;
        const dx = dLeft + dRight;
        const dy = dUp + dDown;
        if (dx !== 0 || dy !== 0) {
          chosenX = dx;
          chosenY = dy;
          chosenMag = 1;
          dpadActive = true;
        }
      }

      const prevStick = this.prevGamepadStick.get(gp.index) || { x: chosenX, y: chosenY };
      const stickMovedDelta = Math.hypot(chosenX - prevStick.x, chosenY - prevStick.y);
      this.prevGamepadStick.set(gp.index, { x: chosenX, y: chosenY });

      const activeDeadzone =
        this.lastInputSource === 'keyboard'
          ? Math.max(this.mapping.deadzone, 0.25)
          : this.mapping.deadzone;

      if (chosenMag > activeDeadzone) {
        if (!anyP1KeyboardHeld && (stickMovedDelta > 0.12 || dpadActive)) {
          this.lastInputSource = 'gamepad';
        }
        // Only let the controller steer when keyboard keys are not held and gamepad is the active input source
        if (!anyP1KeyboardHeld && this.lastInputSource === 'gamepad') {
          this.currentAngle = Math.atan2(chosenY, chosenX);
          this.mouseMovedRecently = false;
          stickVector = {
            x: chosenX / Math.max(1, chosenMag),
            y: chosenY / Math.max(1, chosenMag),
            magnitude: Math.min(1, chosenMag),
            active: true,
          };
        } else {
          stickVector = { x: chosenX, y: chosenY, magnitude: chosenMag, active: false };
        }
      } else {
        stickVector = { x: chosenX, y: chosenY, magnitude: chosenMag, active: false };
      }

      gpThrust = this.mapping.thrustButtons.some((idx) => currBtns[idx]);
      gpShoot = this.mapping.fireButtons.some((idx) => currBtns[idx]);
      gpWarpJustPressed = this.mapping.warpButtons.some((idx) => wasJustPressed(idx));
      gpPauseJustPressed = this.mapping.pauseButtons.some((idx) => wasJustPressed(idx));
      gpStartJustPressed = wasJustPressed(0) || wasJustPressed(9);
      gpAutoFireJustPressed = wasJustPressed(11); // R3 (Right Stick Click) toggles Auto-Fire

      this.prevGamepadButtons.set(gp.index, currBtns);
    }

    // 3. Always apply Player 1 Keyboard & Mouse steering (even when a controller is set to Pad 1!)
    if (this.mapping.keyboardAimMode === 'direct_wasd') {
      const kx = (kbRight ? 1 : 0) - (kbLeft ? 1 : 0);
      const ky = (kbDown ? 1 : 0) - (kbUp ? 1 : 0);
      if (kx !== 0 || ky !== 0) {
        this.currentAngle = Math.atan2(ky, kx);
      }
    } else if (this.mapping.keyboardAimMode === 'classic_turn') {
      const turnSpeed = 4.2;
      if (kbLeft) this.currentAngle -= turnSpeed * dt;
      if (kbRight) this.currentAngle += turnSpeed * dt;
    } else {
      // 'mouse_aim' (default):
      // - Pressing A / D ALWAYS turns the ship immediately.
      // - In fixed-camera Couch Co-Op, only aim toward the mouse cursor when a mouse button is held or the mouse is actively moved while not pressing WASD.
      const turnSpeed = 4.2;
      if (kbLeft || kbRight) {
        if (kbLeft) this.currentAngle -= turnSpeed * dt;
        if (kbRight) this.currentAngle += turnSpeed * dt;
      } else {
        const allowMouseSteer =
          this.mouseLeftDown ||
          this.mouseRightDown ||
          (this.mouseMovedRecently && (!isFixedCameraArena || !kbUp));
        if (allowMouseSteer) {
          const dx = this.mousePos.x - shipScreenX;
          const dy = this.mousePos.y - shipScreenY;
          if (Math.hypot(dx, dy) > 8) {
            this.currentAngle = Math.atan2(dy, dx);
          }
        }
      }
    }

    // Reset single-frame mouse movement flag so a stationary mouse cursor never continually steers the ship
    this.mouseMovedRecently = false;

    const kbWarpJustPressed = this.justPressedKeys.has('KeyE') || this.justPressedKeys.has('KeyQ');
    const kbPauseJustPressed = this.justPressedKeys.has('Escape') || this.justPressedKeys.has('KeyP');
    const kbStartJustPressed = this.justPressedKeys.has('Enter') || this.justPressedKeys.has('Space');
    const cheatMenuJustPressed = this.justPressedKeys.has('KeyK');
    const missileSwarmJustPressed = this.heldKeys.has('KeyM') || this.justPressedKeys.has('KeyM');
    const autoFireToggleJustPressed = this.justPressedKeys.has('KeyF') || gpAutoFireJustPressed;
    const spectatePrevJustPressed = this.justPressedKeys.has('BracketLeft');
    const spectateNextJustPressed = this.justPressedKeys.has('BracketRight');

    // Compute camera pan vector for Free-Cam / Spectator mode
    let panX = (kbRight ? 1 : 0) - (kbLeft ? 1 : 0);
    let panY = (kbDown ? 1 : 0) - (kbUp ? 1 : 0);
    if (panX !== 0 && panY !== 0) {
      const inv = 1 / Math.SQRT2;
      panX *= inv;
      panY *= inv;
    } else if (panX === 0 && panY === 0 && stickVector.active) {
      panX = stickVector.x * stickVector.magnitude;
      panY = stickVector.y * stickVector.magnitude;
    }

    const boostHeld =
      this.heldKeys.has('ShiftLeft') ||
      (!splitKeyboardForP2 && this.heldKeys.has('ShiftRight')) ||
      gpThrust;

    this.justPressedKeys.clear();

    return {
      angle: this.currentAngle,
      thrusting: gpThrust || kbThrust,
      shooting: gpShoot || kbShoot,
      warpJustPressed: gpWarpJustPressed || kbWarpJustPressed,
      pauseJustPressed: gpPauseJustPressed || kbPauseJustPressed,
      startJustPressed: gpStartJustPressed || kbStartJustPressed,
      cheatMenuJustPressed,
      missileSwarmJustPressed,
      autoFireToggleJustPressed,
      inputSource: this.lastInputSource,
      gamepadConnected: Boolean(gp),
      gamepadName: gp ? gp.id : '',
      stickVector,
      pressedButtonIndices,
      mouseScreenX: this.mousePos.x,
      mouseScreenY: this.mousePos.y,
      panVector: { x: panX, y: panY },
      boostHeld,
      spectatePrevJustPressed,
      spectateNextJustPressed,
    };
  }

  /**
   * Samples Local Player 2 (up to 2 players max on the same screen):
   * - Controlled by the controller mapped to `p2ControllerIndex` (default Controller 2, slot 1)
   * - Also ALWAYS supports Keyboard controls:
   *   - Arrow Keys (ArrowLeft / ArrowRight to rotate, ArrowUp to thrust, Enter / RightShift / Slash / ArrowDown to fire, Period '.' for Warp)
   *   - Plus WASD + Space if P2 is mapped to Pad 1 (slot 0) and P1 is mapped elsewhere!
   */
  public samplePlayer2(dt: number): {
    angle: number;
    thrusting: boolean;
    shooting: boolean;
    warpJustPressed: boolean;
    inputSource: 'gamepad' | 'keyboard';
    gamepadConnected: boolean;
    gamepadName: string;
  } {
    const turnSpeed = 4.3;
    const kbLeft = this.heldKeys.has('ArrowLeft');
    const kbRight = this.heldKeys.has('ArrowRight');
    const kbThrust = this.heldKeys.has('ArrowUp') || this.heldKeys.has('KeyI');
    const kbShoot =
      this.heldKeys.has('Enter') ||
      this.heldKeys.has('NumpadEnter') ||
      this.heldKeys.has('ShiftRight') ||
      this.heldKeys.has('Slash') ||
      this.heldKeys.has('ArrowDown');

    const warpHeldNow = this.heldKeys.has('Period') || this.heldKeys.has('NumpadDecimal');
    const kbWarpJustPressed = warpHeldNow && !this.p2WarpWasHeld;
    this.p2WarpWasHeld = warpHeldNow;

    const anyP2KeyboardHeld = kbLeft || kbRight || kbThrust || kbShoot || kbWarpJustPressed;
    if (anyP2KeyboardHeld) {
      this.p2LastInputSource = 'keyboard';
    }

    const gp = this.getGamepadBySlot(this.mapping.p2ControllerIndex);

    let gpThrust = false;
    let gpShoot = false;
    let gpWarpJustPressed = false;

    if (gp) {
      const prevBtns = this.prevGamepadButtons.get(gp.index + 100) || [];
      const currBtns: boolean[] = [];
      for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        currBtns[i] = Boolean(b && (b.pressed || b.value > 0.35));
      }
      const wasJustPressed = (btnIdx: number) => Boolean(currBtns[btnIdx] && !prevBtns[btnIdx]);

      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;
      const rawRx = gp.axes[2] ?? 0;
      const rawRy = gp.axes[3] ?? 0;
      const rx = Math.abs(rawRx + 1) < 0.02 ? 0 : rawRx;
      const ry = Math.abs(rawRy + 1) < 0.02 ? 0 : rawRy;
      const lMag = Math.hypot(lx, ly);
      const rMag = Math.hypot(rx, ry);

      let chosenX = 0;
      let chosenY = 0;
      let chosenMag = 0;
      if (this.mapping.aimStick === 'left') {
        chosenX = lx;
        chosenY = ly;
        chosenMag = lMag;
      } else if (this.mapping.aimStick === 'right') {
        chosenX = rx;
        chosenY = ry;
        chosenMag = rMag;
      } else {
        chosenX = rMag > lMag ? rx : lx;
        chosenY = rMag > lMag ? ry : ly;
        chosenMag = Math.max(lMag, rMag);
      }

      let dpadActive = false;
      if (chosenMag <= this.mapping.deadzone) {
        const dUp = currBtns[12] ? -1 : 0;
        const dDown = currBtns[13] ? 1 : 0;
        const dLeft = currBtns[14] ? -1 : 0;
        const dRight = currBtns[15] ? 1 : 0;
        if (dLeft + dRight !== 0 || dUp + dDown !== 0) {
          chosenX = dLeft + dRight;
          chosenY = dUp + dDown;
          chosenMag = 1;
          dpadActive = true;
        }
      }

      const prevStick = this.prevGamepadStick.get(gp.index + 100) || { x: chosenX, y: chosenY };
      const stickMovedDelta = Math.hypot(chosenX - prevStick.x, chosenY - prevStick.y);
      this.prevGamepadStick.set(gp.index + 100, { x: chosenX, y: chosenY });

      if (chosenMag > this.mapping.deadzone) {
        if (!anyP2KeyboardHeld && (stickMovedDelta > 0.045 || dpadActive)) {
          this.p2LastInputSource = 'gamepad';
        }
        if (!anyP2KeyboardHeld && this.p2LastInputSource === 'gamepad') {
          this.p2Angle = Math.atan2(chosenY, chosenX);
        }
      }

      gpThrust = this.mapping.thrustButtons.some((idx) => currBtns[idx]);
      gpShoot = this.mapping.fireButtons.some((idx) => currBtns[idx]);
      gpWarpJustPressed = this.mapping.warpButtons.some((idx) => wasJustPressed(idx));
      if (!anyP2KeyboardHeld && (gpThrust || gpShoot || gpWarpJustPressed)) {
        this.p2LastInputSource = 'gamepad';
      }
      this.prevGamepadButtons.set(gp.index + 100, currBtns);
    }

    // Always allow Keyboard Arrow Keys to rotate Player 2 even when a controller is mapped to P2
    if (kbLeft) {
      this.p2Angle -= turnSpeed * dt;
    }
    if (kbRight) {
      this.p2Angle += turnSpeed * dt;
    }

    return {
      angle: this.p2Angle,
      thrusting: gpThrust || kbThrust,
      shooting: gpShoot || kbShoot,
      warpJustPressed: gpWarpJustPressed || kbWarpJustPressed,
      inputSource: this.p2LastInputSource,
      gamepadConnected: Boolean(gp),
      gamepadName: gp ? gp.id : '',
    };
  }
}
