import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  BulletState,
  GRAVITY_STAR_RADIUS,
  GRAVITY_STAR_X,
  GRAVITY_STAR_Y,
  GRAVITY_STRENGTH,
  HULL_SPECS,
  PlanetState,
  PlayerState,
  ShipHullType,
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

export class SpacewarRenderer {
  private stars: StarPoint[] = [];
  public particles: Particle[] = [];
  public hitFlashes = new Map<string, number>();
  public cameraShake = 0;
  public hitstopTimer = 0;
  private camX = GRAVITY_STAR_X;
  private camY = GRAVITY_STAR_Y;

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
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      p.orbitAngle = (p.orbitAngle + p.orbitSpeed * dt) % (Math.PI * 2);
      p.x = GRAVITY_STAR_X + Math.cos(p.orbitAngle) * p.orbitRadius;
      p.y = GRAVITY_STAR_Y + Math.sin(p.orbitAngle) * p.orbitRadius;
      p.vx = -Math.sin(p.orbitAngle) * p.orbitSpeed * p.orbitRadius;
      p.vy = Math.cos(p.orbitAngle) * p.orbitSpeed * p.orbitRadius;
    }
  }

  public stepLocalPlayerPhysics(
    player: PlayerState,
    dt: number,
    gravityStarEnabled: boolean,
    planets: PlanetState[] = []
  ) {
    if (!player.alive) return;
    const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

    // 1. Apply thrust in exact ship facing angle (NO DRAG, NO SPEED CAP -> INFINITE MOMENTUM)
    if (player.thrusting) {
      player.vx += Math.cos(player.angle) * spec.thrustAccel * dt;
      player.vy += Math.sin(player.angle) * spec.thrustAccel * dt;

      // Spawn thruster exhaust particles opposite to facing direction
      if (Math.random() < 0.85) {
        const rearX = wrapCoord(player.x - Math.cos(player.angle) * (spec.radius * 0.85), ARENA_WIDTH);
        const rearY = wrapCoord(player.y - Math.sin(player.angle) * (spec.radius * 0.85), ARENA_HEIGHT);
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

    // 2. Apply central Gravity Star pull (scaled 10x)
    if (gravityStarEnabled) {
      const dx = GRAVITY_STAR_X - player.x;
      const dy = GRAVITY_STAR_Y - player.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist < 9500 && dist > 100) {
        const pullAccel = Math.min(620, GRAVITY_STRENGTH / Math.max(280000, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }

    // 2b. Apply Orbiting Planets gravity slingshots & surface rebound
    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i];
      const dx = planet.x - player.x;
      const dy = planet.y - player.y;
      const distSq = dx * dx + dy * dy;
      const minSep = spec.radius + planet.radius;

      if (distSq < minSep * minSep && distSq > 0.001) {
        const dist = Math.sqrt(distSq);
        const nx = -dx / dist;
        const ny = -dy / dist;
        player.x = wrapCoord(planet.x + nx * (minSep + 3), ARENA_WIDTH);
        player.y = wrapCoord(planet.y + ny * (minSep + 3), ARENA_HEIGHT);

        const relVx = player.vx - planet.vx;
        const relVy = player.vy - planet.vy;
        const normalVel = relVx * nx + relVy * ny;
        if (normalVel < 0) {
          player.vx -= 1.85 * normalVel * nx;
          player.vy -= 1.85 * normalVel * ny;
        }
      } else if (distSq < (planet.radius * 5.5) ** 2 && distSq > 1000) {
        const dist = Math.sqrt(distSq);
        const pullAccel = Math.min(380, planet.gravityStrength / Math.max(180000, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }

    // 3. Toroidal position integration
    player.x = wrapCoord(player.x + player.vx * dt, ARENA_WIDTH);
    player.y = wrapCoord(player.y + player.vy * dt, ARENA_HEIGHT);

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > player.peakSpeed) {
      player.peakSpeed = Math.round(speed);
    }
  }

  public stepClientBulletsAndMissiles(
    bullets: BulletState[],
    players: Map<string, PlayerState>,
    asteroids: AsteroidState[],
    dt: number
  ) {
    // Build fast asteroid lookup map only if needed
    let astMap: Map<string, AsteroidState> | null = null;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.isMissile && b.targetId) {
        let target: { x: number; y: number; vx: number; vy: number } | undefined =
          players.get(b.targetId);
        if (target && !(target as PlayerState).alive) {
          target = undefined;
        }
        if (!target) {
          if (!astMap) {
            astMap = new Map();
            for (let k = 0; k < asteroids.length; k++) {
              astMap.set(asteroids[k].id, asteroids[k]);
            }
          }
          target = astMap.get(b.targetId);
        }

        if (target) {
          const dx = shortestToroidalDelta(b.x, target.x + target.vx * 0.12, ARENA_WIDTH);
          const dy = shortestToroidalDelta(b.y, target.y + target.vy * 0.12, ARENA_HEIGHT);
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

      b.x = wrapCoord(b.x + b.vx * dt, ARENA_WIDTH);
      b.y = wrapCoord(b.y + b.vy * dt, ARENA_HEIGHT);
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dt: number,
    nowSec: number,
    localPlayer: PlayerState | null,
    players: Map<string, PlayerState>,
    bullets: BulletState[],
    asteroids: AsteroidState[],
    planets: PlanetState[],
    gravityStarEnabled: boolean,
    stickVector: { x: number; y: number; magnitude: number; active: boolean },
    isTitleMode: boolean
  ) {
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
      p.x = wrapCoord(p.x + p.vx * dt, ARENA_WIDTH);
      p.y = wrapCoord(p.y + p.vy * dt, ARENA_HEIGHT);
      p.alpha = Math.max(0, p.life / p.maxLife);
    }

    // Smooth camera tracking
    if (isTitleMode || !localPlayer) {
      // Slow orbital pan around the Gravity Star on Title Screen
      this.camX = GRAVITY_STAR_X + Math.cos(nowSec * 0.22) * 240;
      this.camY = GRAVITY_STAR_Y + Math.sin(nowSec * 0.22) * 140;
    } else {
      // Snap toroidal camera smoothly to local player with slight velocity lookahead
      const lookAheadX = Math.max(-140, Math.min(140, localPlayer.vx * 0.08));
      const lookAheadY = Math.max(-100, Math.min(100, localPlayer.vy * 0.08));
      const targetX = wrapCoord(localPlayer.x + lookAheadX, ARENA_WIDTH);
      const targetY = wrapCoord(localPlayer.y + lookAheadY, ARENA_HEIGHT);

      const dx = shortestToroidalDelta(this.camX, targetX, ARENA_WIDTH);
      const dy = shortestToroidalDelta(this.camY, targetY, ARENA_HEIGHT);
      const lerp = 1 - Math.exp(-14 * dt);
      this.camX = wrapCoord(this.camX + dx * lerp, ARENA_WIDTH);
      this.camY = wrapCoord(this.camY + dy * lerp, ARENA_HEIGHT);
    }

    const shakeX = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 2.2 : 0;
    const shakeY = this.cameraShake > 0 ? (Math.random() - 0.5) * this.cameraShake * 2.2 : 0;
    const viewCenterX = width * 0.5 + shakeX;
    const viewCenterY = height * 0.5 + shakeY;

    const worldToScreen = (wx: number, wy: number) => {
      const dx = shortestToroidalDelta(this.camX, wx, ARENA_WIDTH);
      const dy = shortestToroidalDelta(this.camY, wy, ARENA_HEIGHT);
      return {
        sx: viewCenterX + dx,
        sy: viewCenterY + dy,
        dx,
        dy,
      };
    };

    // 1. Clear Deep Space Canvas (#060913)
    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, width, height);

    // 2. Render Subtle Toroidal Vector Coordinate Grid
    const gridSpacing = 200;
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offsetX = ((viewCenterX - this.camX) % gridSpacing + gridSpacing) % gridSpacing;
    const offsetY = ((viewCenterY - this.camY) % gridSpacing + gridSpacing) % gridSpacing;
    for (let x = offsetX; x < width; x += gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offsetY; y < height; y += gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 3. Render Multi-Layer Parallax Starfield (+ high-momentum velocity streaks!)
    const localSpeed = localPlayer ? Math.hypot(localPlayer.vx, localPlayer.vy) : 0;
    const streakFactor = localPlayer && localSpeed > 450 ? Math.min(28, (localSpeed - 450) * 0.015) : 0;
    const velUnitX = localPlayer && localSpeed > 1 ? localPlayer.vx / localSpeed : 0;
    const velUnitY = localPlayer && localSpeed > 1 ? localPlayer.vy / localSpeed : 0;

    for (const star of this.stars) {
      const dx = shortestToroidalDelta(this.camX * star.depth, star.x, ARENA_WIDTH);
      const dy = shortestToroidalDelta(this.camY * star.depth, star.y, ARENA_HEIGHT);
      const sx = ((viewCenterX + dx) % width + width) % width;
      const sy = ((viewCenterY + dy) % height + height) % height;

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

    // 4. Render Central Gravity Star ("The Heavy Star" - 10x Scale)
    if (gravityStarEnabled) {
      const { sx, sy } = worldToScreen(GRAVITY_STAR_X, GRAVITY_STAR_Y);
      // Gravity well contour rings (10x scale)
      const ringRadii = [1800, 3800, 6500];
      ctx.save();
      ctx.setLineDash([6, 12]);
      for (let i = 0; i < ringRadii.length; i++) {
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.14 - i * 0.035})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, ringRadii[i], 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      const glowRadius = GRAVITY_STAR_RADIUS * 2.6;
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
          GRAVITY_STAR_RADIUS * 0.2,
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
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, GRAVITY_STAR_RADIUS * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Classic PDP-1 oscillating star vector rays
        ctx.strokeStyle = '#FDE68A';
        ctx.lineWidth = 2.2;
        const rayCount = 24;
        ctx.beginPath();
        for (let i = 0; i < rayCount; i++) {
          const a = (i / rayCount) * Math.PI * 2 + nowSec * 0.35;
          const len =
            GRAVITY_STAR_RADIUS * (0.95 + 0.25 * Math.sin(nowSec * 5 + i * 1.7));
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        }
        ctx.stroke();
      }
    }

    // 4b. Render Planetary Orbit Tracks & Orbiting Planets around the Sun
    if (planets.length > 0) {
      const sunScreen = worldToScreen(GRAVITY_STAR_X, GRAVITY_STAR_Y);

      // Draw faint orbital path rings around the Sun
      ctx.save();
      ctx.setLineDash([5, 9]);
      ctx.lineWidth = 1;
      for (let i = 0; i < planets.length; i++) {
        const planet = planets[i];
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.beginPath();
        ctx.arc(sunScreen.sx, sunScreen.sy, planet.orbitRadius, 0, Math.PI * 2);
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

        // Vector latitude bands clipped to planet sphere
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1.2;
        for (let b = -1; b <= 1; b++) {
          ctx.beginPath();
          ctx.ellipse(
            0,
            b * planet.radius * 0.42,
            planet.radius * 1.05,
            planet.radius * 0.18,
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
        ctx.restore();

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
          x: wrapCoord(b.x - Math.cos(b.angle) * 10, ARENA_WIDTH),
          y: wrapCoord(b.y - Math.sin(b.angle) * 10, ARENA_HEIGHT),
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

      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);

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
        // Local (-8, -2.5), (-17, 0), (-8, 2.5)
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
        // Diamond/Dart warhead: (10, 0), (-7, -4.5), (-5, 0), (-7, 4.5)
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

    for (const player of players.values()) {
      if (!player.alive) continue;

      const { sx, sy, dx, dy } = worldToScreen(player.x, player.y);
      const isLocal = localPlayer && player.id === localPlayer.id;
      const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

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
      if (
        !isLocal &&
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

      // Draw Tactical Direct-Joystick Compass & Prograde Momentum Ring around Local Player
      if (isLocal && !isTitleMode) {
        const compassRadius = spec.radius + 32;
        ctx.save();
        ctx.translate(sx, sy);

        // Subtle compass ring
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, compassRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Direct Joystick / Aim Heading Reticle on Compass Ring
        const aimX = Math.cos(player.angle) * compassRadius;
        const aimY = Math.sin(player.angle) * compassRadius;
        ctx.strokeStyle = stickVector.active ? '#F59E0B' : player.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(player.angle) * (spec.radius + 8), Math.sin(player.angle) * (spec.radius + 8));
        ctx.lineTo(aimX, aimY);
        ctx.stroke();

        ctx.fillStyle = stickVector.active ? '#F59E0B' : player.color;
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

      // Draw Ship Body
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(player.angle);

      // Invulnerability shield ring on spawn
      if (player.invulnerableTimer > 0) {
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + 0.25 * Math.sin(nowSec * 16)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, spec.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Thruster flame cone when thrusting
      if (player.thrusting) {
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
      ctx.fillStyle = isFlashing ? '#FFFFFF' : 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = isFlashing ? '#FFFFFF' : player.color;
      ctx.lineWidth = isLocal ? 2.4 : 2.0;

      drawShipHullPath(ctx, player.hull, spec.radius);
      ctx.fill();
      ctx.stroke();

      // Forward nose sight dot
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(spec.radius * 0.85, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Draw Callsign, Speed & Hull Integrity Bar below ship
      const spd = Math.round(Math.hypot(player.vx, player.vy));
      ctx.save();
      ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = isLocal ? '#F8FAFC' : '#CBD5E1';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${player.name}${spd > 100 ? ` · ${spd} u/s` : ''}`,
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
      ctx.restore();
    }

    // 8b. Render Off-Screen Ship Indicators (sorted by proximity so 100 ships stay clean)
    if (offscreenShips.length > 0) {
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

    // 9. Render 10x Star System Orrery Minimap Radar (Bottom-Right Corner)
    if (!isTitleMode) {
      const mapW = 196;
      const mapH = Math.round(mapW * (ARENA_HEIGHT / ARENA_WIDTH)); // 126px
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

      const scaleX = mapW / ARENA_WIDTH;
      const scaleY = mapH / ARENA_HEIGHT;
      const sunMapX = mapX + GRAVITY_STAR_X * scaleX;
      const sunMapY = mapY + GRAVITY_STAR_Y * scaleY;

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
        ctx.arc(sunMapX, sunMapY, Math.max(3.5, GRAVITY_STAR_RADIUS * scaleX), 0, Math.PI * 2);
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

      // Ships on minimap
      for (const p of players.values()) {
        if (!p.alive) continue;
        const px = mapX + p.x * scaleX;
        const py = mapY + p.y * scaleY;
        const isSelf = localPlayer && p.id === localPlayer.id;
        ctx.fillStyle = isSelf ? '#FFFFFF' : p.color;
        ctx.beginPath();
        ctx.arc(px, py, isSelf ? 3.2 : 1.7, 0, Math.PI * 2);
        ctx.fill();
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
