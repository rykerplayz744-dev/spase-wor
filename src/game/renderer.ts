import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  BulletState,
  getRoomArenaConfig,
  GRAVITY_STAR_RADIUS,
  GRAVITY_STAR_X,
  GRAVITY_STAR_Y,
  HULL_SPECS,
  MUSIC_HEARING_RADIUS,
  PLANET_LANDING_SPEED_THRESHOLD,
  PlanetState,
  PlayerState,
  ShipHullType,
  WARP_DRIVE_SPEED,
} from '../shared/types.ts';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  isLine?: boolean;
  angle?: number;
}

export interface StarPoint {
  x: number;
  y: number;
  size: number;
  alpha: number;
  depth: number; // 0.15 to 0.85 parallax factor
}

export function wrapCoord(val: number, max: number): number {
  if (!Number.isFinite(val)) return max * 0.5;
  return ((val % max) + max) % max;
}

export function shortestToroidalDelta(from: number, to: number, size: number): number {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  if (delta < -size * 0.5) delta += size;
  return delta;
}

function normalizeAngleDiff(diff: number): number {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function drawShipHullPath(
  ctx: CanvasRenderingContext2D,
  hull: ShipHullType,
  radius: number
) {
  ctx.beginPath();
  if (hull === 'needle') {
    // Classic PDP-1 slender needle wedge with aft stabilizers
    ctx.moveTo(radius * 1.35, 0);
    ctx.lineTo(-radius * 0.9, -radius * 0.58);
    ctx.lineTo(-radius * 0.55, -radius * 0.18);
    ctx.lineTo(-radius * 0.95, -radius * 0.18);
    ctx.lineTo(-radius * 0.95, radius * 0.18);
    ctx.lineTo(-radius * 0.55, radius * 0.18);
    ctx.lineTo(-radius * 0.9, radius * 0.58);
    ctx.closePath();
  } else if (hull === 'wedge') {
    // Heavy broad delta dreadnought
    ctx.moveTo(radius * 1.15, 0);
    ctx.lineTo(-radius * 0.4, -radius * 0.95);
    ctx.lineTo(-radius * 0.95, -radius * 0.72);
    ctx.lineTo(-radius * 0.65, 0);
    ctx.lineTo(-radius * 0.95, radius * 0.72);
    ctx.lineTo(-radius * 0.4, radius * 0.95);
    ctx.closePath();
  } else if (hull === 'interceptor') {
    // Forward-swept hyper-vector dart
    ctx.moveTo(radius * 1.4, 0);
    ctx.lineTo(0, -radius * 0.42);
    ctx.lineTo(radius * 0.25, -radius * 0.88);
    ctx.lineTo(-radius * 0.95, -radius * 0.48);
    ctx.lineTo(-radius * 0.62, 0);
    ctx.lineTo(-radius * 0.95, radius * 0.48);
    ctx.lineTo(radius * 0.25, radius * 0.88);
    ctx.lineTo(0, radius * 0.42);
    ctx.closePath();
  } else {
    // Saucer Array with forward directional lance
    ctx.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
    ctx.moveTo(radius * 0.3, -radius * 0.28);
    ctx.lineTo(radius * 1.32, 0);
    ctx.lineTo(radius * 0.3, radius * 0.28);
  }
}

const bundledShipPngModules = import.meta.glob('../components/ships/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const bundledShipPngUrlByName = new Map<string, string>();
for (const [relPath, url] of Object.entries(bundledShipPngModules)) {
  const filename = (relPath.split('/').pop() || relPath).toLowerCase();
  bundledShipPngUrlByName.set(filename, url);
}

export class SpacewarRenderer {
  private stars: StarPoint[] = [];
  public particles: Particle[] = [];
  public hitFlashes = new Map<string, number>();
  public cameraShake = 0;
  public hitstopTimer = 0;
  private roomId: string = 'SECTOR-01';
  private camX = GRAVITY_STAR_X;
  private camY = GRAVITY_STAR_Y;
  private lastCursorTrail = new Map<string, { x: number; y: number }>();
  private shipImageCache = new Map<string, HTMLImageElement>();

  private getShipSpriteImage(filename?: string | null): HTMLImageElement | null {
    if (!filename || typeof window === 'undefined') return null;
    const key = filename.trim();
    if (!key) return null;

    let img = this.shipImageCache.get(key);
    if (!img) {
      img = new Image();
      const bundledUrl = bundledShipPngUrlByName.get(key.toLowerCase());
      img.src = bundledUrl || `/ship-pngs/${encodeURIComponent(key)}`;
      img.onerror = () => {
        if (bundledUrl && img && img.src !== bundledUrl) {
          img.src = bundledUrl;
        }
      };
      this.shipImageCache.set(key, img);
    }

    if (img.complete && img.naturalWidth > 0) {
      return img;
    }
    return null;
  }

  constructor() {
    for (let i = 0; i < 420; i++) {
      this.stars.push({
        x: Math.random() * ARENA_WIDTH,
        y: Math.random() * ARENA_HEIGHT,
        size: Math.random() < 0.18 ? 2.1 : 1.2,
        alpha: 0.25 + Math.random() * 0.65,
        depth: 0.2 + Math.random() * 0.75,
      });
    }
  }

  public setRoomId(roomId: string) {
    const clean = roomId === 'COUCH-COOP' ? 'COUCH-COOP' : 'SECTOR-01';
    if (this.roomId !== clean) {
      this.roomId = clean;
      const arena = getRoomArenaConfig(clean);
      this.camX = arena.starX;
      this.camY = arena.starY;
      this.particles.length = 0;
    }
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public getCameraPosition(): { x: number; y: number } {
    return { x: this.camX, y: this.camY };
  }

  public setCameraPosition(x: number, y: number) {
    const arena = getRoomArenaConfig(this.roomId);
    this.camX = wrapCoord(x, arena.width);
    this.camY = wrapCoord(y, arena.height);
  }

  /**
   * Converts world/arena coordinates to actual browser screen coordinates,
   * accounting for the fixed-camera scaled viewport in COUCH-COOP mode.
   */
  public arenaToScreen(
    wx: number,
    wy: number,
    viewWidth: number,
    viewHeight: number
  ): { sx: number; sy: number } {
    const arena = getRoomArenaConfig(this.roomId);
    if (arena.isCouch) {
      const scale = Math.min(viewWidth / arena.width, viewHeight / arena.height);
      const offsetX = (viewWidth - arena.width * scale) * 0.5;
      const offsetY = (viewHeight - arena.height * scale) * 0.5;
      return {
        sx: offsetX + wx * scale,
        sy: offsetY + wy * scale,
      };
    }
    const dx = shortestToroidalDelta(this.camX, wx, arena.width);
    const dy = shortestToroidalDelta(this.camY, wy, arena.height);
    return {
      sx: viewWidth * 0.5 + dx,
      sy: viewHeight * 0.5 + dy,
    };
  }

  /**
   * Converts browser mouse screen coordinates into world/arena coordinates.
   */
  public screenToArena(
    clientX: number,
    clientY: number,
    viewWidth: number,
    viewHeight: number,
    refCamX?: number,
    refCamY?: number
  ): { x: number; y: number } {
    const arena = getRoomArenaConfig(this.roomId);
    if (arena.isCouch) {
      const scale = Math.min(viewWidth / arena.width, viewHeight / arena.height);
      const offsetX = (viewWidth - arena.width * scale) * 0.5;
      const offsetY = (viewHeight - arena.height * scale) * 0.5;
      const ax = (clientX - offsetX) / Math.max(0.01, scale);
      const ay = (clientY - offsetY) / Math.max(0.01, scale);
      return {
        x: Math.round(wrapCoord(ax, arena.width)),
        y: Math.round(wrapCoord(ay, arena.height)),
      };
    }
    const cx = refCamX ?? this.camX;
    const cy = refCamY ?? this.camY;
    return {
      x: Math.round(wrapCoord(cx + (clientX - viewWidth * 0.5), arena.width)),
      y: Math.round(wrapCoord(cy + (clientY - viewHeight * 0.5), arena.height)),
    };
  }

  public addBurst(
    x: number,
    y: number,
    baseVx: number,
    baseVy: number,
    color: string,
    count: number,
    speedSpread: number,
    isDebris: boolean = false
  ) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 450) {
        this.particles.shift();
      }
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.2 + Math.random() * 0.8) * speedSpread;
      const maxLife = isDebris ? 0.45 + Math.random() * 0.45 : 0.2 + Math.random() * 0.28;
      this.particles.push({
        x,
        y,
        vx: baseVx * 0.35 + Math.cos(angle) * spd,
        vy: baseVy * 0.35 + Math.sin(angle) * spd,
        color,
        size: isDebris ? 7 + Math.random() * 8 : 2 + Math.random() * 2.5,
        alpha: 1,
        life: maxLife,
        maxLife,
        isLine: isDebris,
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  public stepClientPlanets(planets: PlanetState[], dt: number) {
    const arena = getRoomArenaConfig(this.roomId);
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      p.orbitAngle = (p.orbitAngle + p.orbitSpeed * dt) % (Math.PI * 2);
      p.x = arena.starX + Math.cos(p.orbitAngle) * p.orbitRadius;
      p.y = arena.starY + Math.sin(p.orbitAngle) * p.orbitRadius;
      p.vx = -Math.sin(p.orbitAngle) * p.orbitSpeed * p.orbitRadius;
      p.vy = Math.cos(p.orbitAngle) * p.orbitSpeed * p.orbitRadius;
    }
  }

  public stepLocalPlayerPhysics(
    player: PlayerState,
    dt: number,
    gravityStarEnabled: boolean,
    planets: PlanetState[] = [],
    asteroids: AsteroidState[] = [],
    onEnvironmentHit?: (
      target: PlayerState,
      cause: 'asteroid' | 'planet',
      sourceId: string,
      sourceName: string,
      sourceColor: string,
      damage: number,
      fatal: boolean,
      impactSpeed: number
    ) => void
  ) {
    if (!player.alive) return;

    const arena = getRoomArenaConfig(this.roomId);

    if (player.cheats?.godMode) {
      player.hp = player.maxHp;
      player.invulnerableTimer = 0;
    } else if (player.invulnerableTimer > 0) {
      player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);
    }

    const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

    if (player.warping) {
      player.landedPlanetId = null;
      player.landedSurfaceAngle = undefined;
      // Continuous Warp Speed along exact ship facing direction + full invincibility
      const currentSpd = Math.hypot(player.vx, player.vy);
      const warpSpd = Math.max(WARP_DRIVE_SPEED, currentSpd);
      player.vx = Math.cos(player.angle) * warpSpd;
      player.vy = Math.sin(player.angle) * warpSpd;

      // Dense cyan/violet warp-tunnel plasma trail
      for (let w = 0; w < 2; w++) {
        if (this.particles.length > 450) {
          this.particles.shift();
        }
        const rearX = wrapCoord(
          player.x - Math.cos(player.angle) * (spec.radius * 1.1),
          arena.width
        );
        const rearY = wrapCoord(
          player.y - Math.sin(player.angle) * (spec.radius * 1.1),
          arena.height
        );
        const spread = (Math.random() - 0.5) * 0.55;
        const ejectAngle = player.angle + Math.PI + spread;
        const ejectSpeed = 320 + Math.random() * 280;
        this.particles.push({
          x: rearX,
          y: rearY,
          vx: player.vx * 0.25 + Math.cos(ejectAngle) * ejectSpeed,
          vy: player.vy * 0.25 + Math.sin(ejectAngle) * ejectSpeed,
          color: Math.random() < 0.55 ? '#38BDF8' : '#A855F7',
          size: 8 + Math.random() * 7,
          alpha: 0.95,
          life: 0.26,
          maxLife: 0.26,
          isLine: true,
          angle: player.angle,
        });
      }

      player.x = wrapCoord(player.x + player.vx * dt, arena.width);
      player.y = wrapCoord(player.y + player.vy * dt, arena.height);
      if (warpSpd > player.peakSpeed) {
        player.peakSpeed = Math.round(warpSpd);
      }
      return;
    }

    // 0. If currently anchored/landed on a planet, ride the planet's surface so the pilot can freely aim & shoot from there
    if (player.landedPlanetId && !player.isDrone) {
      const landedPlanet = planets.find((p) => p.id === player.landedPlanetId);
      if (landedPlanet) {
        const surfaceAngle =
          typeof player.landedSurfaceAngle === 'number'
            ? player.landedSurfaceAngle
            : Math.atan2(player.y - landedPlanet.y, player.x - landedPlanet.x);
        player.landedSurfaceAngle = surfaceAngle;

        // Launch off the planet if the pilot thrusts while aiming away from the planet's surface
        const outwardAlignment = Math.cos(player.angle - surfaceAngle);
        if (player.thrusting && outwardAlignment > 0.2) {
          player.landedPlanetId = null;
          player.landedSurfaceAngle = undefined;
          const outX = Math.cos(surfaceAngle);
          const outY = Math.sin(surfaceAngle);
          const launchDist = landedPlanet.radius + spec.radius + 9;
          player.x = wrapCoord(landedPlanet.x + outX * launchDist, arena.width);
          player.y = wrapCoord(landedPlanet.y + outY * launchDist, arena.height);
          const launchBoost = Math.max(195, spec.thrustAccel * 0.36);
          player.vx = landedPlanet.vx + Math.cos(player.angle) * launchBoost + outX * 85;
          player.vy = landedPlanet.vy + Math.sin(player.angle) * launchBoost + outY * 85;
        } else {
          // Stay anchored on the planet surface at surfaceAngle
          const anchorDist = landedPlanet.radius + spec.radius + 2;
          player.x = wrapCoord(
            landedPlanet.x + Math.cos(surfaceAngle) * anchorDist,
            arena.width
          );
          player.y = wrapCoord(
            landedPlanet.y + Math.sin(surfaceAngle) * anchorDist,
            arena.height
          );
          player.vx = landedPlanet.vx;
          player.vy = landedPlanet.vy;
          return;
        }
      } else {
        player.landedPlanetId = null;
        player.landedSurfaceAngle = undefined;
      }
    }

    // 1. Apply thrust in exact ship facing angle (NO DRAG, NO SPEED CAP -> INFINITE MOMENTUM)
    if (player.thrusting) {
      player.vx += Math.cos(player.angle) * spec.thrustAccel * dt;
      player.vy += Math.sin(player.angle) * spec.thrustAccel * dt;

      // Spawn thruster exhaust particles opposite to facing direction
      if (Math.random() < 0.85) {
        const rearX = wrapCoord(player.x - Math.cos(player.angle) * (spec.radius * 0.85), arena.width);
        const rearY = wrapCoord(player.y - Math.sin(player.angle) * (spec.radius * 0.85), arena.height);
        const spread = (Math.random() - 0.5) * 0.42;
        const ejectAngle = player.angle + Math.PI + spread;
        const ejectSpeed = 160 + Math.random() * 140;
        this.particles.push({
          x: rearX,
          y: rearY,
          vx: player.vx * 0.5 + Math.cos(ejectAngle) * ejectSpeed,
          vy: player.vy * 0.5 + Math.sin(ejectAngle) * ejectSpeed,
          color: Math.random() < 0.45 ? '#F59E0B' : player.color,
          size: 2.4,
          alpha: 0.9,
          life: 0.22,
          maxLife: 0.22,
        });
      }
    }

    // 2. Apply central Gravity Star pull
    if (gravityStarEnabled) {
      const dx = arena.starX - player.x;
      const dy = arena.starY - player.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      const maxPullRange = arena.isCouch ? 1100 : 9500;
      const minClampSq = arena.isCouch ? 22000 : 280000;
      if (dist < maxPullRange && dist > arena.starRadius * 0.4) {
        const pullAccel = Math.min(620, arena.gravityStrength / Math.max(minClampSq, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }

    // 2b. Apply Orbiting Planets gravity slingshots before integrating position
    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i];
      const dx = shortestToroidalDelta(player.x, planet.x, arena.width);
      const dy = shortestToroidalDelta(player.y, planet.y, arena.height);
      const distSq = dx * dx + dy * dy;
      const minSep = spec.radius + planet.radius;
      if (distSq >= minSep * minSep && distSq < (planet.radius * 5.5) ** 2 && distSq > 1000) {
        const dist = Math.sqrt(distSq);
        const pullAccel = Math.min(380, planet.gravityStrength / Math.max(180000, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }

    // 3. Toroidal / Screen-Edge Loop position integration
    player.x = wrapCoord(player.x + player.vx * dt, arena.width);
    player.y = wrapCoord(player.y + player.vy * dt, arena.height);

    // 4. Check Asteroid collisions & damage
    for (let i = 0; i < asteroids.length; i++) {
      const ast = asteroids[i];
      const dx = shortestToroidalDelta(ast.x, player.x, arena.width);
      const dy = shortestToroidalDelta(ast.y, player.y, arena.height);
      const minSep = spec.radius + ast.radius * 0.9;
      if (Math.abs(dx) > minSep || Math.abs(dy) > minSep) continue;
      const distSq = dx * dx + dy * dy;
      if (distSq < minSep * minSep && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        const preSpeed = Math.hypot(player.vx, player.vy);
        const relVx = player.vx - ast.vx;
        const relVy = player.vy - ast.vy;
        const relSpeed = Math.hypot(relVx, relVy);
        const impactSpeed = Math.max(preSpeed, relSpeed);

        player.x = wrapCoord(ast.x + nx * (minSep + 3), arena.width);
        player.y = wrapCoord(ast.y + ny * (minSep + 3), arena.height);

        const normalVel = relVx * nx + relVy * ny;
        if (normalVel < 0) {
          player.vx -= 1.85 * normalVel * nx;
          player.vy -= 1.85 * normalVel * ny;
        }

        this.addBurst(player.x, player.y, 0, 0, '#94A3B8', 14, 180, false);

        if (player.invulnerableTimer <= 0 && !player.cheats?.godMode && !player.warping) {
          const impactDmg = Math.min(55, Math.max(18, Math.round(impactSpeed * 0.035)));
          player.invulnerableTimer = 0.25;
          const fatal = player.hp - impactDmg <= 0;
          onEnvironmentHit?.(
            player,
            'asteroid',
            ast.id,
            'ASTEROID',
            '#94A3B8',
            impactDmg,
            fatal,
            Math.round(impactSpeed)
          );
          if (fatal || !player.alive) return;
        }
      }
    }

    // 5. Check Planet collisions: slow landing (<= 500 u/s) vs high-speed surface crash & damage (> 500 u/s)
    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i];
      const dx = shortestToroidalDelta(player.x, planet.x, arena.width);
      const dy = shortestToroidalDelta(player.y, planet.y, arena.height);
      const minSep = spec.radius + planet.radius;
      if (Math.abs(dx) > minSep || Math.abs(dy) > minSep) continue;
      const distSq = dx * dx + dy * dy;

      if (distSq < minSep * minSep && distSq > 0.001) {
        const dist = Math.sqrt(distSq);
        const nx = -dx / dist;
        const ny = -dy / dist;

        const preSpeed = Math.hypot(player.vx, player.vy);
        const relVx = player.vx - planet.vx;
        const relVy = player.vy - planet.vy;
        const relSpeed = Math.hypot(relVx, relVy);

        // If hitting the planet at <= 500 u/s, anchor/land the ship on the planet surface with 0 damage!
        if (!player.isDrone && !player.warping && preSpeed <= PLANET_LANDING_SPEED_THRESHOLD) {
          const surfaceAngle = Math.atan2(ny, nx);
          player.landedPlanetId = planet.id;
          player.landedSurfaceAngle = surfaceAngle;
          const anchorDist = planet.radius + spec.radius + 2;
          player.x = wrapCoord(planet.x + Math.cos(surfaceAngle) * anchorDist, arena.width);
          player.y = wrapCoord(planet.y + Math.sin(surfaceAngle) * anchorDist, arena.height);
          player.vx = planet.vx;
          player.vy = planet.vy;
          this.addBurst(
            player.x,
            player.y,
            planet.vx * 0.15,
            planet.vy * 0.15,
            planet.accentColor,
            14,
            135,
            false
          );
          return;
        }

        player.x = wrapCoord(planet.x + nx * (minSep + 4), arena.width);
        player.y = wrapCoord(planet.y + ny * (minSep + 4), arena.height);

        const normalVel = relVx * nx + relVy * ny;
        if (normalVel < 0) {
          player.vx -= 1.85 * normalVel * nx;
          player.vy -= 1.85 * normalVel * ny;
        }

        this.addBurst(player.x, player.y, 0, 0, planet.color, 18, 220, false);

        if (player.invulnerableTimer <= 0 && !player.cheats?.godMode && !player.warping) {
          const impactSpeed = Math.max(preSpeed, relSpeed);
          const impactDmg = Math.min(65, Math.max(22, Math.round(impactSpeed * 0.038)));
          player.invulnerableTimer = 0.28;
          const fatal = player.hp - impactDmg <= 0;
          onEnvironmentHit?.(
            player,
            'planet',
            planet.id,
            planet.name,
            planet.color,
            impactDmg,
            fatal,
            Math.round(impactSpeed)
          );
          if (fatal || !player.alive) return;
        }
      }
    }

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > player.peakSpeed) {
      player.peakSpeed = Math.round(speed);
    }
  }

  /**
   * Smoothly dead-reckons and exponentially blends remote players (and their spectator cursors)
   * at 60fps so choppy HTTP relay updates on Vercel appear completely fluid on screen.
   */
  public stepRemotePlayerSmooth(
    player: PlayerState,
    dt: number,
    gravityStarEnabled: boolean,
    planets: PlanetState[] = []
  ) {
    const arena = getRoomArenaConfig(this.roomId);

    // 1. Smoothly interpolate remote spectator cursor if detached in Free-Cam / Spectate
    if (
      player.spectating &&
      typeof player.netTargetCursorX === 'number' &&
      typeof player.netTargetCursorY === 'number'
    ) {
      if (typeof player.cursorX !== 'number' || typeof player.cursorY !== 'number') {
        player.cursorX = player.netTargetCursorX;
        player.cursorY = player.netTargetCursorY;
      } else {
        const cdx = shortestToroidalDelta(player.cursorX, player.netTargetCursorX, arena.width);
        const cdy = shortestToroidalDelta(player.cursorY, player.netTargetCursorY, arena.height);
        const cursorLerp = 1 - Math.exp(-18 * dt);
        player.cursorX = wrapCoord(player.cursorX + cdx * cursorLerp, arena.width);
        player.cursorY = wrapCoord(player.cursorY + cdy * cursorLerp, arena.height);
      }
    }

    if (!player.alive) return;

    const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

    // If parked in spectator mode, smoothly settle ship to its parked coordinates
    if (player.spectating) {
      player.vx = 0;
      player.vy = 0;
      player.thrusting = false;
      player.shooting = false;
      if (typeof player.netTargetX === 'number' && typeof player.netTargetY === 'number') {
        const dx = shortestToroidalDelta(player.x, player.netTargetX, arena.width);
        const dy = shortestToroidalDelta(player.y, player.netTargetY, arena.height);
        const posLerp = 1 - Math.exp(-12 * dt);
        player.x = wrapCoord(player.x + dx * posLerp, arena.width);
        player.y = wrapCoord(player.y + dy * posLerp, arena.height);
      }
      return;
    }

    // If remote ship is anchored/landed on a planet, lock it smoothly onto that planet's surface
    if (player.landedPlanetId) {
      const landedPlanet = planets.find((p) => p.id === player.landedPlanetId);
      if (landedPlanet) {
        const surfaceAngle =
          typeof player.landedSurfaceAngle === 'number'
            ? player.landedSurfaceAngle
            : Math.atan2(player.y - landedPlanet.y, player.x - landedPlanet.x);
        player.landedSurfaceAngle = surfaceAngle;
        const anchorDist = landedPlanet.radius + spec.radius + 2;
        player.x = wrapCoord(
          landedPlanet.x + Math.cos(surfaceAngle) * anchorDist,
          arena.width
        );
        player.y = wrapCoord(
          landedPlanet.y + Math.sin(surfaceAngle) * anchorDist,
          arena.height
        );
        player.vx = landedPlanet.vx;
        player.vy = landedPlanet.vy;
        const tAngle = player.netTargetAngle ?? player.angle;
        const angleDiff = normalizeAngleDiff(tAngle - player.angle);
        player.angle = player.angle + angleDiff * (1 - Math.exp(-18 * dt));
        return;
      }
    }

    if (typeof player.netTargetX !== 'number' || typeof player.netTargetY !== 'number') {
      player.netTargetX = player.x;
      player.netTargetY = player.y;
      player.netTargetVx = player.vx;
      player.netTargetVy = player.vy;
      player.netTargetAngle = player.angle;
    }

    let tx = player.netTargetX;
    let ty = player.netTargetY;
    let tvx = player.netTargetVx ?? player.vx;
    let tvy = player.netTargetVy ?? player.vy;
    const tAngle = player.netTargetAngle ?? player.angle;

    // Step the predicted target forward using the exact same orbital & thrust physics
    if (player.thrusting) {
      tvx += Math.cos(tAngle) * spec.thrustAccel * dt;
      tvy += Math.sin(tAngle) * spec.thrustAccel * dt;
    }

    if (gravityStarEnabled) {
      const sdx = arena.starX - tx;
      const sdy = arena.starY - ty;
      const distSq = sdx * sdx + sdy * sdy;
      const dist = Math.sqrt(distSq);
      const maxPullRange = arena.isCouch ? 1100 : 9500;
      const minClampSq = arena.isCouch ? 22000 : 280000;
      if (dist < maxPullRange && dist > arena.starRadius * 0.4) {
        const pullAccel = Math.min(620, arena.gravityStrength / Math.max(minClampSq, distSq));
        tvx += (sdx / dist) * pullAccel * dt;
        tvy += (sdy / dist) * pullAccel * dt;
      }
    }

    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i];
      const pdx = planet.x - tx;
      const pdy = planet.y - ty;
      const distSq = pdx * pdx + pdy * pdy;
      if (distSq < (planet.radius * 5.5) ** 2 && distSq > 1000) {
        const dist = Math.sqrt(distSq);
        const pullAccel = Math.min(380, planet.gravityStrength / Math.max(180000, distSq));
        tvx += (pdx / dist) * pullAccel * dt;
        tvy += (pdy / dist) * pullAccel * dt;
      }
    }

    tx = wrapCoord(tx + tvx * dt, arena.width);
    ty = wrapCoord(ty + tvy * dt, arena.height);

    player.netTargetX = tx;
    player.netTargetY = ty;
    player.netTargetVx = tvx;
    player.netTargetVy = tvy;

    // Smoothly blend visual velocity, position, and rotation toward the dead-reckoned target
    const velLerp = 1 - Math.exp(-14 * dt);
    player.vx += (tvx - player.vx) * velLerp;
    player.vy += (tvy - player.vy) * velLerp;

    const nextPredX = wrapCoord(player.x + player.vx * dt, arena.width);
    const nextPredY = wrapCoord(player.y + player.vy * dt, arena.height);

    const errX = shortestToroidalDelta(nextPredX, tx, arena.width);
    const errY = shortestToroidalDelta(nextPredY, ty, arena.height);
    const posLerp = 1 - Math.exp(-11 * dt);

    player.x = wrapCoord(nextPredX + errX * posLerp, arena.width);
    player.y = wrapCoord(nextPredY + errY * posLerp, arena.height);

    const angleDiff = normalizeAngleDiff(tAngle - player.angle);
    const angleLerp = 1 - Math.exp(-18 * dt);
    player.angle = player.angle + angleDiff * angleLerp;

    // Emit thruster or warp exhaust particles for remote ships
    if (player.warping && this.particles.length < 440) {
      const rearX = wrapCoord(player.x - Math.cos(player.angle) * (spec.radius * 1.1), arena.width);
      const rearY = wrapCoord(player.y - Math.sin(player.angle) * (spec.radius * 1.1), arena.height);
      this.particles.push({
        x: rearX,
        y: rearY,
        vx: player.vx * 0.2,
        vy: player.vy * 0.2,
        color: Math.random() < 0.55 ? '#38BDF8' : '#A855F7',
        size: 8 + Math.random() * 6,
        alpha: 0.9,
        life: 0.24,
        maxLife: 0.24,
        isLine: true,
        angle: player.angle,
      });
    } else if (player.thrusting && Math.random() < 0.75 && this.particles.length < 440) {
      const rearX = wrapCoord(player.x - Math.cos(player.angle) * (spec.radius * 0.85), arena.width);
      const rearY = wrapCoord(player.y - Math.sin(player.angle) * (spec.radius * 0.85), arena.height);
      const spread = (Math.random() - 0.5) * 0.42;
      const ejectAngle = player.angle + Math.PI + spread;
      const ejectSpeed = 160 + Math.random() * 140;
      this.particles.push({
        x: rearX,
        y: rearY,
        vx: player.vx * 0.5 + Math.cos(ejectAngle) * ejectSpeed,
        vy: player.vy * 0.5 + Math.sin(ejectAngle) * ejectSpeed,
        color: Math.random() < 0.45 ? '#F59E0B' : player.color,
        size: 2.2,
        alpha: 0.85,
        life: 0.2,
        maxLife: 0.2,
      });
    }
  }

  public stepClientBulletsAndMissiles(
    bullets: BulletState[],
    players: Map<string, PlayerState>,
    asteroids: AsteroidState[],
    dt: number,
    planets: PlanetState[] = [],
    gravityStarEnabled: boolean = true
  ) {
    const arena = getRoomArenaConfig(this.roomId);
    let astMap: Map<string, AsteroidState> | null = null;
    const starHitRadius = arena.starRadius * 0.85;
    const starHitRadiusSq = starHitRadius * starHitRadius;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.isMissile) {
        let target: { id: string; x: number; y: number; vx: number; vy: number } | undefined =
          b.targetId ? players.get(b.targetId) : undefined;
        if (target && !(target as PlayerState).alive) {
          target = undefined;
        }
        if (!target && b.targetId) {
          if (!astMap) {
            astMap = new Map();
            for (let k = 0; k < asteroids.length; k++) {
              astMap.set(asteroids[k].id, asteroids[k]);
            }
          }
          target = astMap.get(b.targetId);
        }

        // Dynamic target acquisition if missile has no valid target yet
        if (!target) {
          let bestDistSq = Infinity;
          for (const p of players.values()) {
            if (!p.alive || p.id === b.ownerId) continue;
            const dx = shortestToroidalDelta(b.x, p.x, arena.width);
            const dy = shortestToroidalDelta(b.y, p.y, arena.height);
            const dSq = dx * dx + dy * dy;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              target = p;
            }
          }
          if (target) {
            b.targetId = target.id;
          }
        }

        if (target) {
          const dx = shortestToroidalDelta(b.x, target.x + target.vx * 0.12, arena.width);
          const dy = shortestToroidalDelta(b.y, target.y + target.vy * 0.12, arena.height);
          const desiredAngle = Math.atan2(dy, dx);
          const diff = normalizeAngleDiff(desiredAngle - b.angle);
          const maxTurn = (b.turnRate || 6.4) * dt;
          b.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

          const currentSpd = Math.hypot(b.vx, b.vy);
          const nextSpd = Math.min(2600, currentSpd + 920 * dt);
          b.vx = Math.cos(b.angle) * nextSpd;
          b.vy = Math.sin(b.angle) * nextSpd;
        }
      }

      b.x = wrapCoord(b.x + b.vx * dt, arena.width);
      b.y = wrapCoord(b.y + b.vy * dt, arena.height);

      if (gravityStarEnabled) {
        const sdx = b.x - arena.starX;
        const sdy = b.y - arena.starY;
        if (
          Math.abs(sdx) <= starHitRadius &&
          Math.abs(sdy) <= starHitRadius &&
          sdx * sdx + sdy * sdy < starHitRadiusSq
        ) {
          bullets.splice(i, 1);
          continue;
        }
      }

      let hitPlanet = false;
      const bOwner = players.get(b.ownerId);
      const justFiredFromLanded = b.maxTtl - b.ttl < 0.25;
      for (let pIdx = 0; pIdx < planets.length; pIdx++) {
        const planet = planets[pIdx];
        const effRadius =
          justFiredFromLanded && bOwner?.landedPlanetId === planet.id
            ? Math.max(20, planet.radius - 20)
            : planet.radius;
        const pdx = b.x - planet.x;
        if (Math.abs(pdx) > effRadius) continue;
        const pdy = b.y - planet.y;
        if (Math.abs(pdy) > effRadius) continue;
        if (pdx * pdx + pdy * pdy <= effRadius * effRadius) {
          hitPlanet = true;
          break;
        }
      }
      if (hitPlanet) {
        bullets.splice(i, 1);
      }
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    screenWidth: number,
    screenHeight: number,
    dt: number,
    nowSec: number,
    localPlayer: PlayerState | null,
    players: Map<string, PlayerState>,
    bullets: BulletState[],
    asteroids: AsteroidState[],
    planets: PlanetState[],
    gravityStarEnabled: boolean,
    stickVector: { x: number; y: number; magnitude: number; active: boolean },
    isTitleMode: boolean,
    cameraOverride?: {
      mode: 'freecam' | 'spectate';
      x: number;
      y: number;
      targetId?: string | null;
    } | null,
    localPlayer2?: PlayerState | null
  ) {
    const arena = getRoomArenaConfig(this.roomId);

    // Update camera shake & hit flashes
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 28);
    }
    for (const [id, t] of this.hitFlashes.entries()) {
      if (t - dt <= 0) this.hitFlashes.delete(id);
      else this.hitFlashes.set(id, t - dt);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x = wrapCoord(p.x + p.vx * dt, arena.width);
      p.y = wrapCoord(p.y + p.vy * dt, arena.height);
      p.alpha = Math.max(0, p.life / p.maxLife);
    }

    // Clear full browser viewport first
    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    let width = screenWidth;
    let height = screenHeight;
    let couchTransformApplied = false;

    if (arena.isCouch) {
      // Fixed-camera Couch Co-Op Server:
      // The camera is permanently fixed at the center of the 1920x1080 arena,
      // and any player/projectile crossing 0..1920 or 0..1080 immediately loops to the opposite side!
      this.camX = arena.starX;
      this.camY = arena.starY;

      const scale = Math.min(screenWidth / arena.width, screenHeight / arena.height);
      const offsetX = (screenWidth - arena.width * scale) * 0.5;
      const offsetY = (screenHeight - arena.height * scale) * 0.5;

      ctx.save();
      couchTransformApplied = true;
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      // Clip to the exact fixed screen boundaries (0..1920 x 0..1080)
      ctx.beginPath();
      ctx.rect(0, 0, arena.width, arena.height);
      ctx.clip();

      width = arena.width;
      height = arena.height;
    } else if (isTitleMode || !localPlayer) {
      // Slow orbital pan around the Gravity Star on Title Screen
      this.camX = arena.starX + Math.cos(nowSec * 0.22) * 240;
      this.camY = arena.starY + Math.sin(nowSec * 0.22) * 140;
    } else if (cameraOverride) {
      const spectatedPlayer =
        cameraOverride.mode === 'spectate' && cameraOverride.targetId
          ? players.get(cameraOverride.targetId) || null
          : null;

      if (spectatedPlayer) {
        const lookAheadX = Math.max(-140, Math.min(140, spectatedPlayer.vx * 0.08));
        const lookAheadY = Math.max(-100, Math.min(100, spectatedPlayer.vy * 0.08));
        const targetX = wrapCoord(spectatedPlayer.x + lookAheadX, arena.width);
        const targetY = wrapCoord(spectatedPlayer.y + lookAheadY, arena.height);

        const dx = shortestToroidalDelta(this.camX, targetX, arena.width);
        const dy = shortestToroidalDelta(this.camY, targetY, arena.height);
        const lerp = 1 - Math.exp(-14 * dt);
        this.camX = wrapCoord(this.camX + dx * lerp, arena.width);
        this.camY = wrapCoord(this.camY + dy * lerp, arena.height);
      } else {
        // Free-Cam detached flight
        this.camX = wrapCoord(cameraOverride.x, arena.width);
        this.camY = wrapCoord(cameraOverride.y, arena.height);
      }
    } else {
      // Snap toroidal camera smoothly to local player with slight velocity lookahead
      const lookAheadX = Math.max(-140, Math.min(140, localPlayer.vx * 0.08));
      const lookAheadY = Math.max(-100, Math.min(100, localPlayer.vy * 0.08));
      const targetX = wrapCoord(localPlayer.x + lookAheadX, arena.width);
      const targetY = wrapCoord(localPlayer.y + lookAheadY, arena.height);

      const dx = shortestToroidalDelta(this.camX, targetX, arena.width);
      const dy = shortestToroidalDelta(this.camY, targetY, arena.height);
      const lerp = 1 - Math.exp(-14 * dt);
      this.camX = wrapCoord(this.camX + dx * lerp, arena.width);
      this.camY = wrapCoord(this.camY + dy * lerp, arena.height);
    }

    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 2.2 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 2.2 : 0;
    const viewCenterX = width * 0.5 + shakeX;
    const viewCenterY = height * 0.5 + shakeY;

    const worldToScreen = (wx: number, wy: number) => {
      if (arena.isCouch) {
        return {
          sx: wx + shakeX,
          sy: wy + shakeY,
          dx: wx - arena.starX,
          dy: wy - arena.starY,
        };
      }
      const dx = shortestToroidalDelta(this.camX, wx, arena.width);
      const dy = shortestToroidalDelta(this.camY, wy, arena.height);
      return {
        sx: viewCenterX + dx,
        sy: viewCenterY + dy,
        dx,
        dy,
      };
    };

    // 2. Render Subtle Toroidal Vector Coordinate Grid
    const gridSpacing = arena.isCouch ? 120 : 200;
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offsetX = arena.isCouch
      ? 0
      : (((viewCenterX - this.camX) % gridSpacing) + gridSpacing) % gridSpacing;
    const offsetY = arena.isCouch
      ? 0
      : (((viewCenterY - this.camY) % gridSpacing) + gridSpacing) % gridSpacing;
    for (let x = offsetX; x <= width; x += gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offsetY; y <= height; y += gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 3. Render Multi-Layer Parallax Starfield (+ high-momentum velocity streaks!)
    const localSpeed = localPlayer ? Math.hypot(localPlayer.vx, localPlayer.vy) : 0;
    const streakFactor =
      !arena.isCouch && localPlayer && localSpeed > 450
        ? Math.min(28, (localSpeed - 450) * 0.015)
        : 0;
    const velUnitX = localPlayer && localSpeed > 1 ? localPlayer.vx / localSpeed : 0;
    const velUnitY = localPlayer && localSpeed > 1 ? localPlayer.vy / localSpeed : 0;

    for (const star of this.stars) {
      const dx = shortestToroidalDelta(this.camX * star.depth, star.x, ARENA_WIDTH);
      const dy = shortestToroidalDelta(this.camY * star.depth, star.y, ARENA_HEIGHT);
      const sx = (((viewCenterX + dx) % width) + width) % width;
      const sy = (((viewCenterY + dy) % height) + height) % height;

      if (streakFactor > 1.5) {
        ctx.strokeStyle = `rgba(226, 232, 240, ${star.alpha * 0.75})`;
        ctx.lineWidth = star.size * 0.85;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(
          sx - velUnitX * streakFactor * star.depth,
          sy - velUnitY * streakFactor * star.depth
        );
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(226, 232, 240, ${star.alpha})`;
        ctx.fillRect(sx, sy, star.size, star.size);
      }
    }

    // 4. Render Central Gravity Star
    const maxViewHalfDiag = Math.hypot(width, height) * 0.58;
    if (gravityStarEnabled) {
      const { sx, sy } = worldToScreen(arena.starX, arena.starY);
      const distToSunCenter = Math.hypot(sx - viewCenterX, sy - viewCenterY);
      const baseAngleToCam = Math.atan2(viewCenterY - sy, viewCenterX - sx);

      // Gravity well contour rings - scaled for COUCH-COOP vs SECTOR-01
      const ringRadii = arena.isCouch ? [220, 440, 720] : [1800, 3800, 6500];
      ctx.save();
      ctx.lineWidth = 1;
      for (let i = 0; i < ringRadii.length; i++) {
        const r = ringRadii[i];
        if (!arena.isCouch && Math.abs(distToSunCenter - r) > maxViewHalfDiag) continue;
        const span =
          arena.isCouch || distToSunCenter < r * 0.35
            ? Math.PI
            : Math.min(Math.PI, (maxViewHalfDiag / Math.max(r, 1)) * 1.25);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.14 - i * 0.035})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, baseAngleToCam - span, baseAngleToCam + span);
        ctx.stroke();
      }
      ctx.restore();

      const glowRadius = arena.starRadius * 2.6;
      if (
        sx > -glowRadius &&
        sx < width + glowRadius &&
        sy > -glowRadius &&
        sy < height + glowRadius
      ) {
        // Outer solar corona glow
        const grad = ctx.createRadialGradient(
          sx,
          sy,
          arena.starRadius * 0.2,
          sx,
          sy,
          glowRadius
        );
        grad.addColorStop(0, 'rgba(254, 243, 199, 0.98)');
        grad.addColorStop(0.38, 'rgba(245, 158, 11, 0.65)');
        grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Solar photosphere core disc
        ctx.fillStyle = '#FEF3C7';
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = arena.isCouch ? 2.2 : 3;
        ctx.beginPath();
        ctx.arc(sx, sy, arena.starRadius * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Classic PDP-1 oscillating star vector rays
        ctx.strokeStyle = '#FDE68A';
        ctx.lineWidth = arena.isCouch ? 1.8 : 2.2;
        const rayCount = 24;
        ctx.beginPath();
        for (let i = 0; i < rayCount; i++) {
          const a = (i / rayCount) * Math.PI * 2 + nowSec * 0.35;
          const len =
            arena.starRadius * (0.95 + 0.25 * Math.sin(nowSec * 5 + i * 1.7));
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        }
        ctx.stroke();
      }
    }

    // 4b. Render Planetary Orbit Tracks & Orbiting Planets around the Sun
    if (planets.length > 0) {
      const sunScreen = worldToScreen(arena.starX, arena.starY);
      const distToSunCenter = Math.hypot(sunScreen.sx - viewCenterX, sunScreen.sy - viewCenterY);
      const baseAngleToCam = Math.atan2(viewCenterY - sunScreen.sy, viewCenterX - sunScreen.sx);

      // Draw faint orbital path rings around the Sun (culled to visible viewport arc)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
      for (let i = 0; i < planets.length; i++) {
        const r = planets[i].orbitRadius;
        if (Math.abs(distToSunCenter - r) > maxViewHalfDiag) continue;
        const span =
          distToSunCenter < r * 0.35
            ? Math.PI
            : Math.min(Math.PI, (maxViewHalfDiag / Math.max(r, 1)) * 1.25);
        ctx.beginPath();
        ctx.arc(sunScreen.sx, sunScreen.sy, r, baseAngleToCam - span, baseAngleToCam + span);
        ctx.stroke();
      }
      ctx.restore();

      // Draw each orbiting planet
      for (let i = 0; i < planets.length; i++) {
        const planet = planets[i];
        const { sx, sy } = worldToScreen(planet.x, planet.y);
        if (
          sx < -planet.radius * 3 ||
          sx > width + planet.radius * 3 ||
          sy < -planet.radius * 3 ||
          sy > height + planet.radius * 3
        ) {
          continue;
        }

        ctx.save();
        ctx.translate(sx, sy);

        // Subtle atmosphere glow
        const atmGrad = ctx.createRadialGradient(
          0,
          0,
          planet.radius * 0.75,
          0,
          0,
          planet.radius * 1.45
        );
        atmGrad.addColorStop(0, planet.color + '44');
        atmGrad.addColorStop(1, 'rgba(6, 9, 19, 0)');
        ctx.fillStyle = atmGrad;
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius * 1.45, 0, Math.PI * 2);
        ctx.fill();

        // Back half of planetary rings (if ringed planet)
        if (planet.hasRings) {
          ctx.save();
          ctx.rotate(-0.38);
          ctx.strokeStyle = planet.accentColor + '88';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.ellipse(0, 0, planet.radius * 1.75, planet.radius * 0.42, 0, Math.PI, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Planet core sphere
        ctx.fillStyle = '#0B1120';
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius, 0, Math.PI * 2);
        ctx.fill();

        // Sun-lit hemisphere gradient (oriented toward the central Sun!)
        const angleToSun = Math.atan2(-Math.sin(planet.orbitAngle), -Math.cos(planet.orbitAngle));
        const litX = Math.cos(angleToSun) * (planet.radius * 0.45);
        const litY = Math.sin(angleToSun) * (planet.radius * 0.45);
        const bodyGrad = ctx.createRadialGradient(
          litX,
          litY,
          planet.radius * 0.1,
          0,
          0,
          planet.radius
        );
        bodyGrad.addColorStop(0, planet.accentColor);
        bodyGrad.addColorStop(0.55, planet.color);
        bodyGrad.addColorStop(1, '#090D16');

        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius, 0, Math.PI * 2);
        ctx.fill();

        // Vector latitude bands fitted inside planet sphere (avoids expensive GPU stencil clip)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1.2;
        for (let b = -1; b <= 1; b++) {
          const latY = b * planet.radius * 0.42;
          const chordRx = planet.radius * (b === 0 ? 0.98 : 0.89);
          ctx.beginPath();
          ctx.ellipse(
            0,
            latY,
            chordRx,
            planet.radius * 0.16,
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }

        // Crisp vector rim outline
        ctx.strokeStyle = planet.accentColor;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius, 0, Math.PI * 2);
        ctx.stroke();

        // Front half of planetary rings (if ringed planet)
        if (planet.hasRings) {
          ctx.save();
          ctx.rotate(-0.38);
          ctx.strokeStyle = planet.accentColor;
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.ellipse(0, 0, planet.radius * 1.75, planet.radius * 0.42, 0, 0, Math.PI);
          ctx.stroke();
          ctx.restore();
        }

        // Planet Name Tag
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#CBD5E1';
        ctx.textAlign = 'center';
        ctx.fillText(planet.name, 0, planet.radius + 16);

        ctx.restore();
      }
    }

    // 5. Render Asteroids
    for (const ast of asteroids) {
      const { sx, sy } = worldToScreen(ast.x, ast.y);
      if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) continue;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ast.angle);

      ctx.strokeStyle = '#64748B';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const vLen = ast.vertices.length;
      for (let i = 0; i < vLen; i++) {
        const a = (i / vLen) * Math.PI * 2;
        const r = ast.radius * ast.vertices[i];
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 6. Render Particles
    for (const p of this.particles) {
      const { sx, sy } = worldToScreen(p.x, p.y);
      if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) continue;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (p.isLine) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.translate(sx, sy);
        ctx.rotate(p.angle || 0);
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.5, 0);
        ctx.lineTo(p.size * 0.5, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 7. Render Bullets & Homing Seeker Missiles (Batched for 60fps with 360+ missiles!)
    const lockedTargetIds = new Set<string>();
    const smokeChance = Math.min(0.45, 16 / Math.max(1, bullets.length));
    const visibleMissiles: { sx: number; sy: number; cos: number; sin: number; targetId?: string }[] = [];
    const visibleLasers: { sx: number; sy: number; tailX: number; tailY: number; color: string }[] = [];

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (b.isMissile && b.targetId) {
        lockedTargetIds.add(b.targetId);
      }

      if (b.isMissile && Math.random() < smokeChance) {
        this.particles.push({
          x: wrapCoord(b.x - Math.cos(b.angle) * 10, arena.width),
          y: wrapCoord(b.y - Math.sin(b.angle) * 10, arena.height),
          vx: (Math.random() - 0.5) * 35,
          vy: (Math.random() - 0.5) * 35,
          color: Math.random() < 0.5 ? '#F59E0B' : '#F43F5E',
          size: 2.0,
          alpha: 0.75,
          life: 0.2,
          maxLife: 0.2,
        });
      }

      const { sx, sy } = worldToScreen(b.x, b.y);
      if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;

      const facingAngle =
        b.vx !== 0 || b.vy !== 0 ? Math.atan2(b.vy, b.vx) : b.angle;
      b.angle = facingAngle;
      const cos = Math.cos(facingAngle);
      const sin = Math.sin(facingAngle);

      if (b.isMissile) {
        visibleMissiles.push({ sx, sy, cos, sin, targetId: b.targetId });
      } else {
        visibleLasers.push({
          sx,
          sy,
          tailX: sx - cos * 18,
          tailY: sy - sin * 18,
          color: b.color,
        });
      }
    }

    // Batch-render Homing Seeker Missiles in 2 single Canvas path calls
    if (visibleMissiles.length > 0) {
      // Optional faint guidance lines (capped at 10 lines max to avoid overdraw)
      const guidanceStep = Math.max(1, Math.floor(visibleMissiles.length / 10));
      ctx.save();
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let drawnLines = 0;
      for (let i = 0; i < visibleMissiles.length && drawnLines < 10; i += guidanceStep) {
        const m = visibleMissiles[i];
        if (!m.targetId) continue;
        const targetPlayer = players.get(m.targetId);
        if (targetPlayer && targetPlayer.alive) {
          const tPos = worldToScreen(targetPlayer.x, targetPlayer.y);
          if (Math.abs(tPos.sx - m.sx) < 800 && Math.abs(tPos.sy - m.sy) < 800) {
            ctx.moveTo(m.sx, m.sy);
            ctx.lineTo(tPos.sx, tPos.sy);
            drawnLines++;
          }
        }
      }
      ctx.stroke();
      ctx.restore();

      // Batch 1: All Missile Exhaust Plumes
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      for (let i = 0; i < visibleMissiles.length; i++) {
        const { sx, sy, cos, sin } = visibleMissiles[i];
        ctx.moveTo(sx - 8 * cos + 2.5 * sin, sy - 8 * sin - 2.5 * cos);
        ctx.lineTo(sx - 17 * cos, sy - 17 * sin);
        ctx.lineTo(sx - 8 * cos - 2.5 * sin, sy - 8 * sin + 2.5 * cos);
      }
      ctx.fill();

      // Batch 2: All Missile Warhead Fuselages
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < visibleMissiles.length; i++) {
        const { sx, sy, cos, sin } = visibleMissiles[i];
        ctx.moveTo(sx + 10 * cos, sy + 10 * sin);
        ctx.lineTo(sx - 7 * cos + 4.5 * sin, sy - 7 * sin - 4.5 * cos);
        ctx.lineTo(sx - 5 * cos, sy - 5 * sin);
        ctx.lineTo(sx - 7 * cos - 4.5 * sin, sy - 7 * sin + 4.5 * cos);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    // Render Standard Lasers
    if (visibleLasers.length > 0) {
      ctx.save();
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      for (let i = 0; i < visibleLasers.length; i++) {
        const l = visibleLasers[i];
        ctx.strokeStyle = l.color;
        ctx.beginPath();
        ctx.moveTo(l.tailX, l.tailY);
        ctx.lineTo(l.sx, l.sy);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      for (let i = 0; i < visibleLasers.length; i++) {
        const l = visibleLasers[i];
        ctx.moveTo(l.sx + 2, l.sy);
        ctx.arc(l.sx, l.sy, 2, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }

    // 8. Render Ships & Off-Screen Edge Indicators
    const offscreenShips: {
      player: PlayerState;
      dx: number;
      dy: number;
      dist: number;
    }[] = [];
    const onScreenSquadShips: {
      player: PlayerState;
      sx: number;
      sy: number;
    }[] = [];

    for (const player of players.values()) {
      if (!player.alive) continue;

      const { sx, sy, dx, dy } = worldToScreen(player.x, player.y);
      const isLocalP1 = Boolean(localPlayer && player.id === localPlayer.id);
      const isLocalP2 = Boolean(localPlayer2 && player.id === localPlayer2.id);
      const isLocal = isLocalP1 || isLocalP2;
      const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

      // If this ship is playing music, draw its spatial audio hearing radius & soundwave ripples
      if (player.music?.isPlaying) {
        if (
          sx > -MUSIC_HEARING_RADIUS - 100 &&
          sx < width + MUSIC_HEARING_RADIUS + 100 &&
          sy > -MUSIC_HEARING_RADIUS - 100 &&
          sy < height + MUSIC_HEARING_RADIUS + 100
        ) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.setLineDash([8, 10]);
          ctx.strokeStyle = isLocal
            ? 'rgba(245, 158, 11, 0.22)'
            : 'rgba(56, 189, 248, 0.24)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(0, 0, MUSIC_HEARING_RADIUS, 0, Math.PI * 2);
          ctx.stroke();

          ctx.setLineDash([]);
          for (let w = 0; w < 2; w++) {
            const phase = (nowSec * 0.65 + w * 0.5) % 1;
            const waveR = spec.radius + 14 + phase * 85;
            const waveAlpha = (1 - phase) * 0.42;
            ctx.strokeStyle = `rgba(245, 158, 11, ${waveAlpha.toFixed(3)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(0, 0, waveR, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Draw Target-Lock Diamond Reticle if a Homing Missile is actively tracking this ship
      if (lockedTargetIds.has(player.id)) {
        const lockSize = spec.radius + 16 + Math.sin(nowSec * 18) * 3;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.strokeStyle = '#F43F5E';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -lockSize);
        ctx.lineTo(lockSize, 0);
        ctx.lineTo(0, lockSize);
        ctx.lineTo(-lockSize, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      const margin = 44;
      const isFocusedShip =
        cameraOverride?.mode === 'spectate' && cameraOverride.targetId === player.id;
      if (
        !arena.isCouch &&
        !isLocal &&
        !isFocusedShip &&
        (sx < margin || sx > width - margin || sy < margin || sy > height - margin)
      ) {
        offscreenShips.push({
          player,
          dx,
          dy,
          dist: Math.hypot(dx, dy),
        });
        continue;
      }

      // Highlight bracket around the ship currently being spectated
      if (isFocusedShip) {
        const bRadius = spec.radius + 26;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, bRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Draw Tactical Direct-Joystick Compass & Prograde Momentum Ring around Local Player(s)
      if (isLocal && !isTitleMode && !cameraOverride) {
        const compassRadius = spec.radius + 32;
        ctx.save();
        ctx.translate(sx, sy);

        // Subtle compass ring
        ctx.strokeStyle = isLocalP2
          ? 'rgba(16, 185, 129, 0.34)'
          : 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, compassRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Direct Joystick / Aim Heading Reticle on Compass Ring
        const aimX = Math.cos(player.angle) * compassRadius;
        const aimY = Math.sin(player.angle) * compassRadius;
        ctx.strokeStyle =
          isLocalP1 && stickVector.active ? '#F59E0B' : player.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(
          Math.cos(player.angle) * (spec.radius + 8),
          Math.sin(player.angle) * (spec.radius + 8)
        );
        ctx.lineTo(aimX, aimY);
        ctx.stroke();

        ctx.fillStyle =
          isLocalP1 && stickVector.active ? '#F59E0B' : player.color;
        ctx.beginPath();
        ctx.arc(aimX, aimY, 3.2, 0, Math.PI * 2);
        ctx.fill();

        // Prograde Velocity Vector Marker (shows exact direction of infinite momentum!)
        const spd = Math.hypot(player.vx, player.vy);
        if (spd > 15) {
          const velAngle = Math.atan2(player.vy, player.vx);
          const vxMark = Math.cos(velAngle) * (compassRadius + 6);
          const vyMark = Math.sin(velAngle) * (compassRadius + 6);

          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(vxMark, vyMark, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      if (player.squadId) {
        onScreenSquadShips.push({ player, sx, sy });
      }

      // If anchored/landed on a planet, draw a magnetic landing clamp ring around the ship
      if (player.landedPlanetId) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.72)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, spec.radius + 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Draw Ship Body (plus ghost duplicate across screen edge in COUCH-COOP if straddling the boundary!)
      const drawShipInstance = (drawX: number, drawY: number) => {
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(player.angle);

        // Invulnerability or Warp Field shield ring
        if (player.warping) {
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.7 + 0.25 * Math.sin(nowSec * 22)})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.ellipse(0, 0, spec.radius + 15, spec.radius + 9, 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = `rgba(168, 85, 247, ${0.6 + 0.3 * Math.cos(nowSec * 26)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, spec.radius + 11, 0, Math.PI * 2);
          ctx.stroke();
        } else if (player.invulnerableTimer > 0) {
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + 0.25 * Math.sin(nowSec * 16)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, spec.radius + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Thruster or Warp Drive flame cone
        if (player.warping) {
          const warpFlameLen = spec.radius * (2.6 + Math.random() * 1.1);
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath();
          ctx.moveTo(-spec.radius * 0.75, -spec.radius * 0.38);
          ctx.lineTo(-spec.radius * 0.75 - warpFlameLen, 0);
          ctx.lineTo(-spec.radius * 0.75, spec.radius * 0.38);
          ctx.closePath();
          ctx.fill();
        } else if (player.thrusting && !player.landedPlanetId) {
          const flameLen = spec.radius * (1.2 + Math.random() * 0.65);
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.moveTo(-spec.radius * 0.75, -spec.radius * 0.26);
          ctx.lineTo(-spec.radius * 0.75 - flameLen, 0);
          ctx.lineTo(-spec.radius * 0.75, spec.radius * 0.26);
          ctx.closePath();
          ctx.fill();
        }

        const isFlashing = (this.hitFlashes.get(player.id) || 0) > 0;
        const spriteImg = this.getShipSpriteImage(player.shipPng);

        if (spriteImg) {
          const spriteSize = spec.radius * 2.8;
          ctx.drawImage(
            spriteImg,
            -spriteSize * 0.5,
            -spriteSize * 0.5,
            spriteSize,
            spriteSize
          );
          if (isFlashing) {
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(0, 0, spec.radius * 1.15, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = isFlashing ? '#FFFFFF' : 'rgba(15, 23, 42, 0.92)';
          ctx.strokeStyle = isFlashing ? '#FFFFFF' : player.warping ? '#38BDF8' : player.color;
          ctx.lineWidth = isLocal ? 2.4 : 2.0;

          drawShipHullPath(ctx, player.hull, spec.radius);
          ctx.fill();
          ctx.stroke();

          // Forward nose sight dot
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(spec.radius * 0.85, 0, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      };

      drawShipInstance(sx, sy);

      // In COUCH-COOP, if a ship is crossing the screen edge, render its wrap-around twin on the opposite edge for seamless visual looping!
      if (arena.isCouch) {
        const edgeWrapMargin = spec.radius * 2.2;
        if (sx < edgeWrapMargin) drawShipInstance(sx + arena.width, sy);
        if (sx > arena.width - edgeWrapMargin) drawShipInstance(sx - arena.width, sy);
        if (sy < edgeWrapMargin) drawShipInstance(sx, sy + arena.height);
        if (sy > arena.height - edgeWrapMargin) drawShipInstance(sx, sy - arena.height);
      }

      // Draw Callsign, Squad Tag, Speed & Hull Integrity Bar below ship
      const spd = player.landedPlanetId ? 0 : Math.round(Math.hypot(player.vx, player.vy));
      const localTag =
        localPlayer2 && isLocalP1
          ? ' [P1]'
          : localPlayer2 && isLocalP2
          ? ' [P2]'
          : '';
      ctx.save();
      ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = player.warping ? '#38BDF8' : isLocal ? '#F8FAFC' : '#CBD5E1';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${player.name}${localTag}${player.squadId ? ` [${player.squadId}]` : ''}${player.spectating ? ' [CAM DETACHED]' : player.warping ? ' [WARP · INVINCIBLE]' : player.landedPlanetId ? ' [LANDED]' : ''}${spd > 100 ? ` · ${spd} u/s` : ''}`,
        sx,
        sy + spec.radius + 18
      );

      // Compact health bar
      const barW = 38;
      const barH = 3.5;
      const barX = sx - barW / 2;
      const barY = sy + spec.radius + 23;
      const hpRatio = Math.max(0, Math.min(1, player.hp / player.maxHp));

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpRatio > 0.5 ? player.color : hpRatio > 0.25 ? '#F59E0B' : '#F43F5E';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      if (player.music?.isPlaying && player.music.title) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FBBF24';
        ctx.textAlign = 'center';
        const shortTitle =
          player.music.title.length > 26
            ? player.music.title.slice(0, 24) + '…'
            : player.music.title;
        ctx.fillText(`♪ ${shortTitle}`, sx, barY + 14);
      }
      ctx.restore();
    }

    // 8a. Render Wingman Links between On-Screen Squad Ships
    if (onScreenSquadShips.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < onScreenSquadShips.length; i++) {
        const a = onScreenSquadShips[i];
        for (let j = i + 1; j < onScreenSquadShips.length; j++) {
          const b = onScreenSquadShips[j];
          if (a.player.squadId === b.player.squadId) {
            const dSq = (a.sx - b.sx) * (a.sx - b.sx) + (a.sy - b.sy) * (a.sy - b.sy);
            if (dSq < 620 * 620) {
              ctx.strokeStyle = a.player.color;
              ctx.beginPath();
              ctx.moveTo(a.sx, a.sy);
              ctx.lineTo(b.sx, b.sy);
              ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    }

    // 8b. Render Off-Screen Ship Indicators (only needed in SECTOR-01)
    if (!arena.isCouch && offscreenShips.length > 0) {
      offscreenShips.sort((a, b) => a.dist - b.dist);
      const margin = 44;
      const maxToDraw = Math.min(offscreenShips.length, 32);
      for (let i = 0; i < maxToDraw; i++) {
        const { player, dx, dy, dist } = offscreenShips[i];
        const edgeAngle = Math.atan2(dy, dx);
        const clampedX = Math.max(
          margin,
          Math.min(width - margin, viewCenterX + Math.cos(edgeAngle) * (width * 0.45))
        );
        const clampedY = Math.max(
          margin,
          Math.min(height - margin, viewCenterY + Math.sin(edgeAngle) * (height * 0.42))
        );

        ctx.save();
        ctx.translate(clampedX, clampedY);
        ctx.rotate(edgeAngle);
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-6, -5);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (i < 10) {
          ctx.save();
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillStyle = player.color;
          ctx.textAlign = 'center';
          ctx.fillText(`${player.name} · ${Math.round(dist)}m`, clampedX, clampedY + 17);
          ctx.restore();
        }
      }
    }

    // 8c. Render Live Spectator / Free-Cam Mouse Cursors (Visible to ALL Players!)
    for (const player of players.values()) {
      if (
        !player.alive ||
        !player.spectating ||
        typeof player.cursorX !== 'number' ||
        typeof player.cursorY !== 'number'
      ) {
        continue;
      }

      const prevTrail = this.lastCursorTrail.get(player.id);
      if (prevTrail) {
        const moveDist = Math.hypot(
          shortestToroidalDelta(prevTrail.x, player.cursorX, arena.width),
          shortestToroidalDelta(prevTrail.y, player.cursorY, arena.height)
        );
        if (moveDist > 6 && this.particles.length < 440) {
          this.particles.push({
            x: player.cursorX,
            y: player.cursorY,
            vx: (Math.random() - 0.5) * 24,
            vy: (Math.random() - 0.5) * 24,
            color: player.color,
            size: 2.2,
            alpha: 0.85,
            life: 0.28,
            maxLife: 0.28,
          });
          this.lastCursorTrail.set(player.id, { x: player.cursorX, y: player.cursorY });
        }
      } else {
        this.lastCursorTrail.set(player.id, { x: player.cursorX, y: player.cursorY });
      }

      const { sx, sy, dx, dy } = worldToScreen(player.cursorX, player.cursorY);
      const isSelfCursor = localPlayer && player.id === localPlayer.id;

      const margin = 48;
      if (
        !arena.isCouch &&
        !isSelfCursor &&
        (sx < margin || sx > width - margin || sy < margin || sy > height - margin)
      ) {
        const edgeAngle = Math.atan2(dy, dx);
        const clampedX = Math.max(
          margin,
          Math.min(width - margin, viewCenterX + Math.cos(edgeAngle) * (width * 0.44))
        );
        const clampedY = Math.max(
          margin,
          Math.min(height - margin, viewCenterY + Math.sin(edgeAngle) * (height * 0.41))
        );

        ctx.save();
        ctx.translate(clampedX, clampedY);
        ctx.strokeStyle = player.color;
        ctx.fillStyle = '#0B1120';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = player.color;
        ctx.textAlign = 'center';
        ctx.fillText(
          `[CURSOR] ${player.name} · ${Math.round(Math.hypot(dx, dy))}m`,
          0,
          20
        );
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.translate(sx, sy);

      const isCursorFlashing = (this.hitFlashes.get(player.id) || 0) > 0;

      const pulseRadius = 36 + Math.sin(nowSec * 7) * 5;
      ctx.save();
      ctx.rotate(nowSec * 1.6);
      ctx.strokeStyle = isCursorFlashing ? '#FFFFFF' : player.color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 14);
      ctx.stroke();

      ctx.fillStyle = isCursorFlashing ? '#FFFFFF' : '#060913';
      ctx.strokeStyle = isCursorFlashing ? '#FFFFFF' : player.color;
      ctx.lineWidth = 3.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 44);
      ctx.lineTo(11.6, 34.4);
      ctx.lineTo(21, 53);
      ctx.lineTo(29, 49);
      ctx.lineTo(19.6, 30.4);
      ctx.lineTo(34, 30.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
      ctx.fill();

      const hpPct = Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp)));
      const label = `${player.name} · ${Math.max(0, Math.ceil(player.hp))} HP`;
      ctx.font = '700 12px "JetBrains Mono", monospace';
      const textWidth = Math.max(84, ctx.measureText(label).width);
      const tagX = 36;
      const tagY = 32;
      const boxW = textWidth + 16;
      const boxH = 30;

      ctx.fillStyle = 'rgba(11, 17, 32, 0.94)';
      ctx.strokeStyle = isCursorFlashing ? '#FFFFFF' : player.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tagX + 8, tagY + 11);

      const barX = tagX + 8;
      const barY = tagY + 21;
      const barW = boxW - 16;
      const barH = 4.5;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? player.color : hpPct > 0.25 ? '#F59E0B' : '#F43F5E';
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      ctx.restore();
    }

    // 9. In COUCH-COOP, draw the glowing screen-edge loop boundary frame around the 1920x1080 arena;
    //    in SECTOR-01, draw the 10x Star System Orrery Minimap Radar (Bottom-Right Corner).
    if (arena.isCouch) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, arena.width - 3, arena.height - 3);

      // Subtle dashed wrap-portal tick lines along the 4 edges
      ctx.setLineDash([10, 14]);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(6, 6, arena.width - 12, arena.height - 12);
      ctx.restore();

      if (couchTransformApplied) {
        ctx.restore();
      }
    } else if (!isTitleMode) {
      const mapW = 196;
      const mapH = Math.round(mapW * (arena.height / arena.width)); // 126px
      const mapX = width - mapW - 20;
      const mapY = height - mapH - 52;

      ctx.save();
      ctx.fillStyle = 'rgba(11, 17, 32, 0.88)';
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(mapX, mapY, mapW, mapH, 8);
      ctx.fill();
      ctx.stroke();

      const scaleX = mapW / arena.width;
      const scaleY = mapH / arena.height;
      const sunMapX = mapX + arena.starX * scaleX;
      const sunMapY = mapY + arena.starY * scaleY;

      // Planetary orbit rings on minimap
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        ctx.beginPath();
        ctx.arc(sunMapX, sunMapY, p.orbitRadius * scaleX, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Central Sun on minimap
      if (gravityStarEnabled) {
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(sunMapX, sunMapY, Math.max(3.5, arena.starRadius * scaleX), 0, Math.PI * 2);
        ctx.fill();
      }

      // Planets on minimap
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        const px = mapX + p.x * scaleX;
        const py = mapY + p.y * scaleY;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.5, p.radius * scaleX), 0, Math.PI * 2);
        ctx.fill();
      }

      // Ships & Spectator Cursors on minimap
      for (const p of players.values()) {
        if (p.alive) {
          const px = mapX + p.x * scaleX;
          const py = mapY + p.y * scaleY;
          const isSelf =
            (localPlayer && p.id === localPlayer.id) ||
            (localPlayer2 && p.id === localPlayer2.id);
          ctx.fillStyle = isSelf ? '#FFFFFF' : p.color;
          ctx.beginPath();
          ctx.arc(px, py, isSelf ? 3.2 : 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
        if (
          p.spectating &&
          typeof p.cursorX === 'number' &&
          typeof p.cursorY === 'number'
        ) {
          const cx = mapX + p.cursorX * scaleX;
          const cy = mapY + p.cursorY * scaleY;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Label
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'left';
      ctx.fillText('10X STAR SYSTEM RADAR', mapX + 7, mapY + 12);
      ctx.restore();
    }
  }
}
