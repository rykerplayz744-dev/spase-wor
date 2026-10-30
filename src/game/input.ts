export interface ControllerMapping {
  aimStick: 'left' | 'right' | 'both';
  deadzone: number;
  thrustButtons: number[]; // Default: RT (7), A/Cross (0), LT (6), L3 (10)
  fireButtons: number[]; // Default: RB (5), X/Square (2), B/Circle (1), R3 (11)
  warpButtons: number[]; // Default: Y/Triangle (3), LB (4)
  pauseButtons: number[]; // Default: Start/Options (9)
  keyboardAimMode: 'direct_wasd' | 'mouse_aim' | 'classic_turn';
}

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  aimStick: 'both',
  deadzone: 0.14,
  thrustButtons: [7, 0, 6], // RT, South (A/Cross), LT
  fireButtons: [5, 2, 1], // RB, West (X/Square), East (B/Circle)
  warpButtons: [3, 4], // North (Y/Triangle), LB
  pauseButtons: [9], // Start / Options
  keyboardAimMode: 'mouse_aim',
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
      return { ...DEFAULT_CONTROLLER_MAPPING, ...parsed };
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

  constructor() {
    this.mapping = loadControllerMapping();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('contextmenu', this.onContextMenu);
    }
  }

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mouseup', this.onMouseUp);
      window.removeEventListener('contextmenu', this.onContextMenu);
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

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const code = e.code;
    if (!this.heldKeys.has(code)) {
      this.justPressedKeys.add(code);
    }
    this.heldKeys.add(code);
    this.lastInputSource = 'keyboard';
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private onBlur = () => {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mousePos.x = e.clientX;
    this.mousePos.y = e.clientY;
    this.mouseMovedRecently = true;
  };

  private onMouseDown = (e: MouseEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || (e.target as HTMLElement)?.closest('button')) return;
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
  };

  private onContextMenu = (e: MouseEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'CANVAS') {
      e.preventDefault();
    }
  };

  public getConnectedGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    const list = navigator.getGamepads();
    const result: Gamepad[] = [];
    for (const gp of list) {
      if (gp && gp.connected) {
        result.push(gp);
      }
    }
    return result;
  }

  /**
   * Samples both Gamepad and Keyboard/Mouse inputs for the current frame.
   * For a controller: points the ship in the EXACT direction of the joystick vector (Math.atan2(y, x)).
   */
  public sample(
    dt: number,
    shipScreenX: number,
    shipScreenY: number,
    gamepadIndex: number = 0
  ): SampledInput {
    const gamepads = this.getConnectedGamepads();
    const gp = gamepads[gamepadIndex] || gamepads[0] || null;

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
          this.lastInputSource = 'gamepad';
        }
      }

      const wasJustPressed = (btnIdx: number) => Boolean(currBtns[btnIdx] && !prevBtns[btnIdx]);

      // Sample joystick axes for direct directional pointing
      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;
      const rx = gp.axes[2] ?? 0;
      const ry = gp.axes[3] ?? 0;

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
        // 'both': use whichever stick has greater deflection
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
        }
      }

      if (chosenMag > this.mapping.deadzone) {
        // EXACT DIRECTION OF THE JOYSTICK:
        // Left (-1, 0) -> Math.PI (Left)
        // Right (1, 0) -> 0 (Right)
        // Up (0, -1) -> -Math.PI/2 (Up)
        // Down (0, 1) -> Math.PI/2 (Down)
        this.currentAngle = Math.atan2(chosenY, chosenX);
        this.lastInputSource = 'gamepad';
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

      gpThrust = this.mapping.thrustButtons.some((idx) => currBtns[idx]);
      gpShoot = this.mapping.fireButtons.some((idx) => currBtns[idx]);
      gpWarpJustPressed = this.mapping.warpButtons.some((idx) => wasJustPressed(idx));
      gpPauseJustPressed = this.mapping.pauseButtons.some((idx) => wasJustPressed(idx));
      gpStartJustPressed = wasJustPressed(0) || wasJustPressed(9);
      gpAutoFireJustPressed = wasJustPressed(11); // R3 (Right Stick Click) toggles Auto-Fire

      this.prevGamepadButtons.set(gp.index, currBtns);
    }

    // Keyboard & Mouse sampling
    const kbUp = this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp');
    const kbDown = this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown');
    const kbLeft = this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft');
    const kbRight = this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight');

    let kbThrust = false;
    let kbShoot = false;

    if (this.lastInputSource === 'keyboard') {
      if (this.mapping.keyboardAimMode === 'direct_wasd') {
        // WASD / Arrows directly point the ship in that direction (just like the joystick!)
        const kx = (kbRight ? 1 : 0) - (kbLeft ? 1 : 0);
        const ky = (kbDown ? 1 : 0) - (kbUp ? 1 : 0);
        if (kx !== 0 || ky !== 0) {
          this.currentAngle = Math.atan2(ky, kx);
        }
        kbThrust =
          this.heldKeys.has('ShiftLeft') ||
          this.heldKeys.has('ShiftRight') ||
          this.mouseRightDown;
        kbShoot =
          this.heldKeys.has('Space') ||
          this.heldKeys.has('KeyJ') ||
          this.mouseLeftDown;
      } else if (this.mapping.keyboardAimMode === 'classic_turn') {
        const turnSpeed = 4.2;
        if (kbLeft) this.currentAngle -= turnSpeed * dt;
        if (kbRight) this.currentAngle += turnSpeed * dt;
        kbThrust = kbUp || this.heldKeys.has('ShiftLeft') || this.mouseRightDown;
        kbShoot = this.heldKeys.has('Space') || this.mouseLeftDown;
      } else {
        // 'mouse_aim' (default when using mouse/keyboard):
        // If mouse moved or clicked, point toward cursor; A/D can also fine-tune rotation
        if (this.mouseMovedRecently || this.mouseLeftDown || this.mouseRightDown) {
          const dx = this.mousePos.x - shipScreenX;
          const dy = this.mousePos.y - shipScreenY;
          if (Math.hypot(dx, dy) > 8) {
            this.currentAngle = Math.atan2(dy, dx);
          }
        } else {
          const turnSpeed = 4.2;
          if (kbLeft) this.currentAngle -= turnSpeed * dt;
          if (kbRight) this.currentAngle += turnSpeed * dt;
        }
        kbThrust = kbUp || this.heldKeys.has('ShiftLeft') || this.mouseRightDown;
        kbShoot = this.heldKeys.has('Space') || this.mouseLeftDown;
      }
    }

    const kbWarpJustPressed = this.justPressedKeys.has('KeyE') || this.justPressedKeys.has('KeyQ');
    const kbPauseJustPressed = this.justPressedKeys.has('Escape') || this.justPressedKeys.has('KeyP');
    const kbStartJustPressed = this.justPressedKeys.has('Enter') || this.justPressedKeys.has('Space');
    const cheatMenuJustPressed = this.justPressedKeys.has('KeyK');
    const missileSwarmJustPressed = this.heldKeys.has('KeyM') || this.justPressedKeys.has('KeyM');
    const autoFireToggleJustPressed = this.justPressedKeys.has('KeyF') || gpAutoFireJustPressed;
    const spectatePrevJustPressed = this.justPressedKeys.has('BracketLeft');
    const spectateNextJustPressed = this.justPressedKeys.has('BracketRight');

    // Compute camera pan vector for Free-Cam / Spectator mode (WASD, Arrows, or Gamepad Stick)
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
      this.heldKeys.has('ShiftRight') ||
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
}
