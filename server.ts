import express from 'express';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  arePlayersTeammates,
  AsteroidState,
  BulletState,
  ChatMessage,
  ClientToServerMessage,
  DEFAULT_PLAYER_CHEATS,
  expandSalvoToBullets,
  GRAVITY_STAR_RADIUS,
  GRAVITY_STAR_X,
  GRAVITY_STAR_Y,
  GRAVITY_STRENGTH,
  HULL_SPECS,
  INITIAL_PLANETS,
  KillFeedEntry,
  parseChatInput,
  PLAYER_COLORS,
  PlanetState,
  PlayerState,
  RoomSummary,
  SalvoSpawnPayload,
  ServerToClientMessage,
  SHIP_SMASH_SPEED_THRESHOLD,
  ShipHullType,
  stepAiDroneAutopilot,
  WARP_DRIVE_SPEED,
} from './src/shared/types.ts';
import { createTargetDronesBatch } from './src/game/peerSync.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomState {
  id: string;
  gravityStarEnabled: boolean;
  players: Map<string, PlayerState>;
  bullets: Map<string, BulletState>;
  asteroids: Map<string, AsteroidState>;
  planets: PlanetState[];
  killFeed: KillFeedEntry[];
  chatMessages: ChatMessage[];
  clients: Set<WebSocket>;
  colorIndex: number;
}

const rooms = new Map<string, RoomState>();
const socketToRoom = new Map<WebSocket, string>();
const socketToPlayerIds = new Map<WebSocket, Set<string>>();
const playerLastSeen = new Map<string, number>();

let entitySeq = 1;
function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(entitySeq++).toString(36)}`;
}

function wrapCoord(val: number, max: number): number {
  return ((val % max) + max) % max;
}

function shortestToroidalDelta(from: number, to: number, size: number): number {
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

function createAsteroid(_room: RoomState): AsteroidState {
  let x = Math.random() * ARENA_WIDTH;
  let y = Math.random() * ARENA_HEIGHT;
  const distToStar = Math.hypot(x - GRAVITY_STAR_X, y - GRAVITY_STAR_Y);
  if (distToStar < 1400) {
    const pushAngle = Math.random() * Math.PI * 2;
    x = GRAVITY_STAR_X + Math.cos(pushAngle) * (1800 + Math.random() * 6000);
    y = GRAVITY_STAR_Y + Math.sin(pushAngle) * (1800 + Math.random() * 4500);
  }
  const radius = 24 + Math.random() * 34;
  const speed = 35 + Math.random() * 75;
  const moveAngle = Math.random() * Math.PI * 2;
  const vertCount = 10;
  const vertices: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    vertices.push(0.78 + Math.random() * 0.36);
  }
  const maxHp = Math.round(radius * 2.2);
  return {
    id: nextId('ast'),
    x: wrapCoord(x, ARENA_WIDTH),
    y: wrapCoord(y, ARENA_HEIGHT),
    vx: Math.cos(moveAngle) * speed,
    vy: Math.sin(moveAngle) * speed,
    radius,
    angle: Math.random() * Math.PI * 2,
    vAngle: (Math.random() - 0.5) * 1.4,
    hp: maxHp,
    maxHp,
    vertices,
  };
}

function getOrCreateRoom(_roomId?: string): RoomState {
  const cleanId = 'SECTOR-01';
  let room = rooms.get(cleanId);
  if (!room) {
    const planets: PlanetState[] = INITIAL_PLANETS.map((p) => ({
      ...p,
      x: GRAVITY_STAR_X + Math.cos(p.orbitAngle) * p.orbitRadius,
      y: GRAVITY_STAR_Y + Math.sin(p.orbitAngle) * p.orbitRadius,
      vx: -Math.sin(p.orbitAngle) * p.orbitSpeed * p.orbitRadius,
      vy: Math.cos(p.orbitAngle) * p.orbitSpeed * p.orbitRadius,
    }));
    room = {
      id: cleanId,
      gravityStarEnabled: true,
      players: new Map(),
      bullets: new Map(),
      asteroids: new Map(),
      planets,
      killFeed: [],
      chatMessages: [],
      clients: new Set(),
      colorIndex: 0,
    };
    for (let i = 0; i < 224; i++) {
      const ast = createAsteroid(room);
      room.asteroids.set(ast.id, ast);
    }
    rooms.set(cleanId, room);
  }
  return room;
}

function getSafeSpawnPoint(room: RoomState, excludeId?: string): { x: number; y: number } {
  // 1. If another human player is alive and safely outside the Sun's deep gravity well, spawn near them!
  for (const p of room.players.values()) {
    if (p.alive && !p.isDrone && p.id !== excludeId) {
      const distFromSun = Math.hypot(p.x - GRAVITY_STAR_X, p.y - GRAVITY_STAR_Y);
      if (distFromSun > GRAVITY_STAR_RADIUS + 1500) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 160 + Math.random() * 140;
          const x = wrapCoord(p.x + Math.cos(angle) * dist, ARENA_WIDTH);
          const y = wrapCoord(p.y + Math.sin(angle) * dist, ARENA_HEIGHT);
          if (Math.hypot(x - GRAVITY_STAR_X, y - GRAVITY_STAR_Y) > GRAVITY_STAR_RADIUS + 1400) {
            return { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
    }
  }

  // 2. Otherwise teleport to a safe orbit around the Sun (2,200 - 3,800 units out, never inside the Sun!)
  for (let attempt = 0; attempt < 24; attempt++) {
    const theta = Math.random() * Math.PI * 2;
    const orbitRadius = GRAVITY_STAR_RADIUS + 1800 + Math.random() * 1600;
    const x = wrapCoord(GRAVITY_STAR_X + Math.cos(theta) * orbitRadius, ARENA_WIDTH);
    const y = wrapCoord(GRAVITY_STAR_Y + Math.sin(theta) * orbitRadius, ARENA_HEIGHT);
    let safe = true;
    for (const planet of room.planets) {
      if (Math.hypot(planet.x - x, planet.y - y) < planet.radius + 160) {
        safe = false;
        break;
      }
    }
    if (safe) return { x: Math.round(x), y: Math.round(y) };
  }

  return {
    x: Math.round(wrapCoord(GRAVITY_STAR_X + 2900, ARENA_WIDTH)),
    y: Math.round(wrapCoord(GRAVITY_STAR_Y, ARENA_HEIGHT)),
  };
}

function getRandomWarpPoint(room: RoomState): { x: number; y: number } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const orbitRadius = 1500 + Math.random() * 6500;
    const theta = Math.random() * Math.PI * 2;
    const x = wrapCoord(GRAVITY_STAR_X + Math.cos(theta) * orbitRadius, ARENA_WIDTH);
    const y = wrapCoord(GRAVITY_STAR_Y + Math.sin(theta) * orbitRadius, ARENA_HEIGHT);

    let safe = true;
    for (const planet of room.planets) {
      if (Math.hypot(planet.x - x, planet.y - y) < planet.radius + 140) {
        safe = false;
        break;
      }
    }
    if (safe) return { x, y };
  }
  return {
    x: wrapCoord(GRAVITY_STAR_X + 3200, ARENA_WIDTH),
    y: wrapCoord(GRAVITY_STAR_Y, ARENA_HEIGHT),
  };
}

function getRoomSummaries(): RoomSummary[] {
  const list: RoomSummary[] = [];
  for (const room of rooms.values()) {
    if (room.players.size > 0 || room.id === 'SECTOR-01') {
      list.push({
        roomId: room.id,
        playerCount: room.players.size,
        gravityStarEnabled: room.gravityStarEnabled,
      });
    }
  }
  if (!list.some((r) => r.roomId === 'SECTOR-01')) {
    list.unshift({ roomId: 'SECTOR-01', playerCount: 0, gravityStarEnabled: true });
  }
  return list;
}

function sendMsg(ws: WebSocket, msg: ServerToClientMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastRoom(room: RoomState, msg: ServerToClientMessage, exclude?: WebSocket) {
  const payload = JSON.stringify(msg);
  for (const client of room.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function recordKill(
  room: RoomState,
  killer: PlayerState | null,
  victim: PlayerState,
  cause: KillFeedEntry['cause'],
  speedAtKill: number
) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths += 1;
  victim.streak = 0;
  victim.respawnTimer = 2.8;
  victim.thrusting = false;
  victim.shooting = false;

  if (killer && killer.id !== victim.id) {
    killer.kills += 1;
    killer.streak += 1;
    killer.score += 150 + Math.min(350, Math.round(speedAtKill * 0.15));
    killer.hp = Math.min(killer.maxHp, killer.hp + 25);
  }

  const entry: KillFeedEntry = {
    id: nextId('kill'),
    killerId: killer ? killer.id : 'hazard',
    killerName: killer
      ? killer.name
      : cause === 'star'
      ? 'GRAVITY STAR'
      : cause === 'planet'
      ? 'ORBITAL PLANET'
      : 'ASTEROID',
    killerColor: killer ? killer.color : '#F59E0B',
    victimId: victim.id,
    victimName: victim.name,
    victimColor: victim.color,
    cause,
    speedAtKill: Math.round(speedAtKill),
    timestamp: Date.now(),
    deathSound: victim.deathSound,
  };

  room.killFeed.unshift(entry);
  if (room.killFeed.length > 8) {
    room.killFeed.length = 8;
  }

  broadcastRoom(room, { type: 'combat:kill', entry });
}

function findNearestTargetForMissile(
  room: RoomState,
  ownerId: string,
  mx: number,
  my: number
): { id: string; x: number; y: number; vx: number; vy: number } | null {
  let bestTarget: { id: string; x: number; y: number; vx: number; vy: number } | null = null;
  let bestDistSq = Infinity;

  // Priority 1: Other alive player ships in the room (using squared distance, zero sqrt)
  for (const p of room.players.values()) {
    if (!p.alive || p.id === ownerId) continue;
    const dx = shortestToroidalDelta(mx, p.x, ARENA_WIDTH);
    const dy = shortestToroidalDelta(my, p.y, ARENA_HEIGHT);
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestTarget = { id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    }
  }

  if (bestTarget) return bestTarget;

  // Priority 2: Fallback to nearest asteroid if no other ship is currently alive
  for (const ast of room.asteroids.values()) {
    const dx = shortestToroidalDelta(mx, ast.x, ARENA_WIDTH);
    const dy = shortestToroidalDelta(my, ast.y, ARENA_HEIGHT);
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestTarget = { id: ast.id, x: ast.x, y: ast.y, vx: ast.vx, vy: ast.vy };
    }
  }

  return bestTarget;
}

function resolveMissileTargetO1(
  room: RoomState,
  bullet: BulletState
): { id: string; x: number; y: number; vx: number; vy: number } | null {
  // Fast O(1) lookup if missile already has a valid locked targetId
  if (bullet.targetId) {
    const p = room.players.get(bullet.targetId);
    if (p && p.alive && p.id !== bullet.ownerId) {
      return p;
    }
    const ast = room.asteroids.get(bullet.targetId);
    if (ast) {
      return ast;
    }
  }
  return findNearestTargetForMissile(room, bullet.ownerId, bullet.x, bullet.y);
}

function evictExcessBullets(room: RoomState, incomingCount: number, maxCap: number = 1800) {
  if (room.bullets.size + incomingCount <= maxCap) return;
  const excess = room.bullets.size + incomingCount - maxCap;
  let removed = 0;
  for (const oldKey of room.bullets.keys()) {
    room.bullets.delete(oldKey);
    removed++;
    if (removed >= excess) break;
  }
}

function spawnMissileSwarm(room: RoomState, player: PlayerState, count: number = 16) {
  const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;
  const noseDist = spec.radius + 12;
  evictExcessBullets(room, count, 1800);

  const availableTargets: string[] = [];
  for (const p of room.players.values()) {
    if (p.alive && p.id !== player.id) {
      availableTargets.push(p.id);
    }
  }
  if (availableTargets.length === 0) {
    const fallback = findNearestTargetForMissile(room, player.id, player.x, player.y);
    if (fallback) availableTargets.push(fallback.id);
  }

  const salvo: SalvoSpawnPayload = {
    idPrefix: nextId('swm'),
    ownerId: player.id,
    ownerName: player.name,
    color: '#F43F5E',
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    vx: Math.round(player.vx),
    vy: Math.round(player.vy),
    angle: Number((player.angle + (performance.now() * 0.011) % (Math.PI * 2)).toFixed(4)),
    noseDist,
    count,
    spreadAngle: (Math.PI * 2) / count,
    novaSpread: true,
    baseMuzzle: 760,
    damage: 42,
    ttl: 3.0,
    isMissile: true,
    targetIds: availableTargets,
  };

  const spawned = expandSalvoToBullets(salvo);
  for (let i = 0; i < spawned.length; i++) {
    room.bullets.set(spawned[i].id, spawned[i]);
  }

  broadcastRoom(room, { type: 'salvo:spawn', salvo });
}

function spawnPlayerBullets(room: RoomState, player: PlayerState, nowSec: number) {
  const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;
  const cheats = player.cheats || DEFAULT_PLAYER_CHEATS;

  // Zero cooldown (0s) when 360° Nova Salvo or Hyper-Rapid Fire is active!
  const baseCooldown = player.isDrone
    ? Math.max(spec.fireCooldown * 1.5, 0.36)
    : spec.fireCooldown;
  const effectiveCooldown =
    cheats.novaSpread || cheats.rapidFire ? 0 : baseCooldown;
  if (effectiveCooldown > 0 && nowSec - player.lastFireTime < effectiveCooldown) return;
  player.lastFireTime = nowSec;

  const count = cheats.novaSpread ? 360 : spec.spreadCount;

  evictExcessBullets(room, count, 1800);

  const noseDist = spec.radius + 10;
  const availableTargetIds: string[] = [];
  if (cheats.homingMissiles) {
    for (const p of room.players.values()) {
      if (p.alive && p.id !== player.id) {
        availableTargetIds.push(p.id);
      }
    }
    if (availableTargetIds.length === 0) {
      const fallback = findNearestTargetForMissile(room, player.id, player.x, player.y);
      if (fallback) availableTargetIds.push(fallback.id);
    }
  }

  const projectileTtl = cheats.homingMissiles
    ? cheats.novaSpread
      ? 4.0
      : 5.5
    : 2.6;

  // Slightly rotate consecutive 0-cooldown 360° salvos for a dense spiral omnidirectional barrage
  const salvoAngle = cheats.novaSpread
    ? player.angle + ((nowSec * 9.5) % ((Math.PI * 2) / count))
    : player.angle;

  const salvo: SalvoSpawnPayload = {
    idPrefix: nextId(cheats.homingMissiles ? 'msl' : 'blt'),
    ownerId: player.id,
    ownerName: player.name,
    color: cheats.homingMissiles ? '#F43F5E' : player.color,
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    vx: Math.round(player.vx),
    vy: Math.round(player.vy),
    angle: Number(salvoAngle.toFixed(4)),
    noseDist,
    count,
    spreadAngle: spec.spreadAngle,
    novaSpread: Boolean(cheats.novaSpread),
    baseMuzzle: cheats.homingMissiles ? 860 : spec.bulletSpeed,
    damage: cheats.homingMissiles ? (cheats.novaSpread ? 26 : 38) : spec.bulletDamage,
    ttl: projectileTtl,
    isMissile: Boolean(cheats.homingMissiles),
    targetIds: availableTargetIds,
  };

  const spawned = expandSalvoToBullets(salvo);
  for (let i = 0; i < spawned.length; i++) {
    room.bullets.set(spawned[i].id, spawned[i]);
  }

  broadcastRoom(room, { type: 'salvo:spawn', salvo });
}

function stepRoomSimulation(room: RoomState, dt: number, nowSec: number) {
  // Step orbiting planets around the central Sun
  for (let i = 0; i < room.planets.length; i++) {
    const planet = room.planets[i];
    planet.orbitAngle = (planet.orbitAngle + planet.orbitSpeed * dt) % (Math.PI * 2);
    planet.x = GRAVITY_STAR_X + Math.cos(planet.orbitAngle) * planet.orbitRadius;
    planet.y = GRAVITY_STAR_Y + Math.sin(planet.orbitAngle) * planet.orbitRadius;
    planet.vx = -Math.sin(planet.orbitAngle) * planet.orbitSpeed * planet.orbitRadius;
    planet.vy = Math.cos(planet.orbitAngle) * planet.orbitSpeed * planet.orbitRadius;
  }

  if (room.asteroids.size < 224) {
    for (let s = 0; s < 8 && room.asteroids.size < 224; s++) {
      const ast = createAsteroid(room);
      room.asteroids.set(ast.id, ast);
    }
  }

  for (const ast of room.asteroids.values()) {
    ast.x = wrapCoord(ast.x + ast.vx * dt, ARENA_WIDTH);
    ast.y = wrapCoord(ast.y + ast.vy * dt, ARENA_HEIGHT);
    ast.angle += ast.vAngle * dt;
  }

  const nowMs = Date.now();

  // Update players (including any spawned target drones)
  for (const player of room.players.values()) {
    // Evict stale ghost human connections (> 6 seconds without any message/ping)
    if (!player.isDrone) {
      const lastSeen = playerLastSeen.get(player.id) ?? nowMs;
      if (nowMs - lastSeen > 6000) {
        room.players.delete(player.id);
        playerLastSeen.delete(player.id);
        broadcastRoom(room, { type: 'player:left', playerId: player.id });
        continue;
      }
    }

    if (!player.alive) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) {
        const pt = getSafeSpawnPoint(room);
        const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;
        player.x = pt.x;
        player.y = pt.y;
        player.vx = 0;
        player.vy = 0;
        player.hp = spec.maxHp;
        player.maxHp = spec.maxHp;
        player.alive = true;
        player.invulnerableTimer = 2.0;
      }
      continue;
    }

    if (player.isDrone) {
      stepAiDroneAutopilot(
        player,
        room.players,
        room.planets,
        room.gravityStarEnabled,
        dt,
        nowSec
      );
    }

    if (player.music && player.music.isPlaying && typeof player.music.startedAtServerMs === 'number') {
      player.music.trackTime = Math.max(
        0,
        Number(((nowMs - player.music.startedAtServerMs) / 1000).toFixed(3))
      );
      player.music.updatedAt = nowMs;
    }

    if (player.cheats?.godMode || player.warping) {
      if (player.cheats?.godMode) {
        player.hp = player.maxHp;
      }
      player.invulnerableTimer = Math.max(player.invulnerableTimer, 0.25);
    } else if (player.invulnerableTimer > 0) {
      player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);
    }

    // When a player disconnects from their ship in Free-Cam / Spectate mode, keep their ship safely parked where they left it
    if (player.spectating) {
      player.thrusting = false;
      player.shooting = false;
      player.warping = false;
      player.vx = 0;
      player.vy = 0;
      continue;
    }

    const spec = HULL_SPECS[player.hull] || HULL_SPECS.needle;

    if (player.warping) {
      const currentSpd = Math.hypot(player.vx, player.vy);
      const warpSpd = Math.max(WARP_DRIVE_SPEED, currentSpd);
      player.vx = Math.cos(player.angle) * warpSpd;
      player.vy = Math.sin(player.angle) * warpSpd;
    } else if (player.thrusting) {
      player.vx += Math.cos(player.angle) * spec.thrustAccel * dt;
      player.vy += Math.sin(player.angle) * spec.thrustAccel * dt;
    }

    if (room.gravityStarEnabled) {
      const dx = GRAVITY_STAR_X - player.x;
      const dy = GRAVITY_STAR_Y - player.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist < GRAVITY_STAR_RADIUS + spec.radius - 4) {
        const safePt = getSafeSpawnPoint(room, player.id);
        if (player.invulnerableTimer <= 0 && !player.cheats?.godMode && !player.warping) {
          const speed = Math.hypot(player.vx, player.vy);
          broadcastRoom(room, {
            type: 'combat:hit',
            targetId: player.id,
            attackerId: 'star',
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            damage: player.hp,
            fatal: true,
            color: '#F59E0B',
            cause: 'star',
            deathSound: player.deathSound,
          });
          recordKill(room, null, player, 'star', speed);
          // Immediately respawn player at safe orbit around the Sun
          player.alive = true;
          player.hp = player.maxHp;
          player.respawnTimer = 0;
          player.invulnerableTimer = 2.0;
          player.x = safePt.x;
          player.y = safePt.y;
          player.vx = 0;
          player.vy = 0;
          continue;
        } else {
          // If invulnerable, warping, or in God Mode, teleport out around the Sun so they never get stuck inside it
          player.x = safePt.x;
          player.y = safePt.y;
          if (!player.warping) {
            player.vx = 0;
            player.vy = 0;
          }
          player.invulnerableTimer = 2.0;
        }
      } else if (!player.warping && dist < 9500 && dist > 100) {
        const pullAccel = Math.min(620, GRAVITY_STRENGTH / Math.max(280000, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }

    player.x = wrapCoord(player.x + player.vx * dt, ARENA_WIDTH);
    player.y = wrapCoord(player.y + player.vy * dt, ARENA_HEIGHT);

    const currentSpeed = Math.hypot(player.vx, player.vy);
    if (currentSpeed > player.peakSpeed) {
      player.peakSpeed = Math.round(currentSpeed);
    }

    if (player.shooting) {
      spawnPlayerBullets(room, player, nowSec);
    }

    for (const ast of room.asteroids.values()) {
      const dx = player.x - ast.x;
      const dy = player.y - ast.y;
      const minSep = spec.radius + ast.radius * 0.85;
      if (Math.abs(dx) > minSep || Math.abs(dy) > minSep) continue;
      const dist = Math.hypot(dx, dy);
      if (dist < minSep && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        player.x = wrapCoord(ast.x + nx * (minSep + 2), ARENA_WIDTH);
        player.y = wrapCoord(ast.y + ny * (minSep + 2), ARENA_HEIGHT);

        const relVx = player.vx - ast.vx;
        const relVy = player.vy - ast.vy;
        const normalVel = relVx * nx + relVy * ny;
        if (normalVel < 0) {
          player.vx -= 1.85 * normalVel * nx;
          player.vy -= 1.85 * normalVel * ny;
        }

        if (player.invulnerableTimer <= 0 && !player.cheats?.godMode && !player.warping) {
          const impactDmg = Math.min(45, Math.max(14, Math.round(currentSpeed * 0.025)));
          player.hp -= impactDmg;
          player.invulnerableTimer = 0.25;
          const fatal = player.hp <= 0;
          broadcastRoom(room, {
            type: 'combat:hit',
            targetId: player.id,
            attackerId: ast.id,
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            damage: impactDmg,
            fatal,
            color: '#94A3B8',
          });
          if (fatal) {
            recordKill(room, null, player, 'asteroid', currentSpeed);
            break;
          }
        }
      }
    }

    if (!player.alive) continue;

    // Planetary gravity slingshots & surface collisions
    for (let i = 0; i < room.planets.length; i++) {
      const planet = room.planets[i];
      const dx = planet.x - player.x;
      const dy = planet.y - player.y;
      const distSq = dx * dx + dy * dy;
      const minSep = spec.radius + planet.radius;

      if (distSq < minSep * minSep && distSq > 0.001) {
        const dist = Math.sqrt(distSq);
        const nx = -dx / dist; // Outward normal from planet center to ship
        const ny = -dy / dist;
        player.x = wrapCoord(planet.x + nx * (minSep + 3), ARENA_WIDTH);
        player.y = wrapCoord(planet.y + ny * (minSep + 3), ARENA_HEIGHT);

        const relVx = player.vx - planet.vx;
        const relVy = player.vy - planet.vy;
        const normalVel = relVx * nx + relVy * ny;
        if (normalVel < 0 && !player.warping) {
          player.vx -= 1.85 * normalVel * nx;
          player.vy -= 1.85 * normalVel * ny;
        }

        if (player.invulnerableTimer <= 0 && !player.cheats?.godMode && !player.warping) {
          const impactDmg = Math.min(55, Math.max(18, Math.round(currentSpeed * 0.03)));
          player.hp -= impactDmg;
          player.invulnerableTimer = 0.3;
          const fatal = player.hp <= 0;
          broadcastRoom(room, {
            type: 'combat:hit',
            targetId: player.id,
            attackerId: planet.id,
            x: Math.round(player.x),
            y: Math.round(player.y),
            vx: Math.round(player.vx),
            vy: Math.round(player.vy),
            damage: impactDmg,
            fatal,
            color: planet.color,
          });
          if (fatal) {
            recordKill(room, null, player, 'planet', currentSpeed);
            break;
          }
        }
      } else if (!player.warping && distSq < (planet.radius * 5.5) ** 2 && distSq > 1000) {
        const dist = Math.sqrt(distSq);
        const pullAccel = Math.min(380, planet.gravityStrength / Math.max(180000, distSq));
        player.vx += (dx / dist) * pullAccel * dt;
        player.vy += (dy / dist) * pullAccel * dt;
      }
    }
  }

  // Ship-to-Ship Collision & High-Force (1,000+ u/s) Smash Check
  const activeShipList = Array.from(room.players.values()).filter(
    (p) => p.alive && !p.spectating
  );
  for (let i = 0; i < activeShipList.length; i++) {
    const p1 = activeShipList[i];
    if (!p1.alive) continue;
    const spec1 = HULL_SPECS[p1.hull] || HULL_SPECS.needle;

    for (let j = i + 1; j < activeShipList.length; j++) {
      const p2 = activeShipList[j];
      if (!p2.alive) continue;
      const spec2 = HULL_SPECS[p2.hull] || HULL_SPECS.needle;

      const minSep = spec1.radius + spec2.radius;
      const dx = shortestToroidalDelta(p2.x, p1.x, ARENA_WIDTH);
      if (Math.abs(dx) > minSep) continue;
      const dy = shortestToroidalDelta(p2.y, p1.y, ARENA_HEIGHT);
      if (Math.abs(dy) > minSep) continue;

      const distSq = dx * dx + dy * dy;
      if (distSq <= minSep * minSep && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        const relVx = p1.vx - p2.vx;
        const relVy = p1.vy - p2.vy;
        const relSpeed = Math.hypot(relVx, relVy);
        const spd1 = Math.hypot(p1.vx, p1.vy);
        const spd2 = Math.hypot(p2.vx, p2.vy);
        const smashForce = Math.max(relSpeed, spd1, spd2);

        if (smashForce >= SHIP_SMASH_SPEED_THRESHOLD) {
          // High-force (1,000+ u/s) smash: ships are destroyed unless God Mode or Warp Speed invincibility is on
          const p1Fatal = !p1.cheats?.godMode && !p1.warping;
          const p2Fatal = !p2.cheats?.godMode && !p2.warping;

          broadcastRoom(room, {
            type: 'combat:hit',
            targetId: p1.id,
            attackerId: p2.id,
            x: Math.round(p1.x),
            y: Math.round(p1.y),
            vx: Math.round(p1.vx),
            vy: Math.round(p1.vy),
            damage: p1Fatal ? p1.hp : 0,
            fatal: p1Fatal,
            color: '#F43F5E',
            cause: 'collision',
            deathSound: p1.deathSound,
          });
          broadcastRoom(room, {
            type: 'combat:hit',
            targetId: p2.id,
            attackerId: p1.id,
            x: Math.round(p2.x),
            y: Math.round(p2.y),
            vx: Math.round(p2.vx),
            vy: Math.round(p2.vy),
            damage: p2Fatal ? p2.hp : 0,
            fatal: p2Fatal,
            color: '#F43F5E',
            cause: 'collision',
            deathSound: p2.deathSound,
          });

          if (p1Fatal) {
            recordKill(room, p2, p1, 'collision', smashForce);
          }
          if (p2Fatal) {
            recordKill(room, p1, p2, 'collision', smashForce);
          }
          break;
        } else {
          // Sub-1000 u/s bump: separate ships and exchange elastic normal impulse
          const overlap = (minSep - dist) * 0.5 + 1.5;
          p1.x = wrapCoord(p1.x + nx * overlap, ARENA_WIDTH);
          p1.y = wrapCoord(p1.y + ny * overlap, ARENA_HEIGHT);
          p2.x = wrapCoord(p2.x - nx * overlap, ARENA_WIDTH);
          p2.y = wrapCoord(p2.y - ny * overlap, ARENA_HEIGHT);

          const normalVel = relVx * nx + relVy * ny;
          if (normalVel < 0) {
            p1.vx -= normalVel * nx;
            p1.vy -= normalVel * ny;
            p2.vx += normalVel * nx;
            p2.vy += normalVel * ny;
          }
        }
      }
    }
  }

  // Pre-build flat arrays for fast bullet collision loops (avoids map iterator allocation per bullet)
  const alivePlayers: { player: PlayerState; hitRadius: number; hitRadiusSq: number; missileRadius: number; missileRadiusSq: number }[] = [];
  for (const p of room.players.values()) {
    if (p.alive) {
      const spec = HULL_SPECS[p.hull] || HULL_SPECS.needle;
      const rLaser = spec.radius + 7;
      const rMissile = spec.radius + 13;
      alivePlayers.push({
        player: p,
        hitRadius: rLaser,
        hitRadiusSq: rLaser * rLaser,
        missileRadius: rMissile,
        missileRadiusSq: rMissile * rMissile,
      });
    }
  }
  const asteroidsList = Array.from(room.asteroids.values());
  const starHitRadius = GRAVITY_STAR_RADIUS * 0.85;
  const starHitRadiusSq = starHitRadius * starHitRadius;
  const removedBulletIds: string[] = [];

  // Update bullets & Homing Seeker Missiles
  for (const [bulletId, bullet] of room.bullets.entries()) {
    bullet.ttl -= dt;
    if (bullet.ttl <= 0) {
      room.bullets.delete(bulletId);
      continue;
    }

    // Fast O(1) Homing Missile Guidance
    if (bullet.isMissile) {
      const target = resolveMissileTargetO1(room, bullet);
      if (target) {
        bullet.targetId = target.id;
        const dx = shortestToroidalDelta(bullet.x, target.x + target.vx * 0.12, ARENA_WIDTH);
        const dy = shortestToroidalDelta(bullet.y, target.y + target.vy * 0.12, ARENA_HEIGHT);
        const desiredAngle = Math.atan2(dy, dx);
        const diff = normalizeAngleDiff(desiredAngle - bullet.angle);
        const maxTurn = (bullet.turnRate || 6.4) * dt;
        bullet.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

        const currentSpd = Math.hypot(bullet.vx, bullet.vy);
        const nextSpd = Math.min(2600, currentSpd + 920 * dt);
        bullet.vx = Math.cos(bullet.angle) * nextSpd;
        bullet.vy = Math.sin(bullet.angle) * nextSpd;
      } else {
        bullet.targetId = undefined;
      }
    }

    bullet.x = wrapCoord(bullet.x + bullet.vx * dt, ARENA_WIDTH);
    bullet.y = wrapCoord(bullet.y + bullet.vy * dt, ARENA_HEIGHT);

    if (room.gravityStarEnabled) {
      const sdx = bullet.x - GRAVITY_STAR_X;
      const sdy = bullet.y - GRAVITY_STAR_Y;
      if (
        Math.abs(sdx) <= starHitRadius &&
        Math.abs(sdy) <= starHitRadius &&
        sdx * sdx + sdy * sdy < starHitRadiusSq
      ) {
        room.bullets.delete(bulletId);
        removedBulletIds.push(bulletId);
        continue;
      }
    }

    // Check collision against orbiting planets
    let hitPlanet = false;
    for (let i = 0; i < room.planets.length; i++) {
      const planet = room.planets[i];
      const pdx = bullet.x - planet.x;
      if (Math.abs(pdx) > planet.radius) continue;
      const pdy = bullet.y - planet.y;
      if (Math.abs(pdy) > planet.radius) continue;
      if (pdx * pdx + pdy * pdy <= planet.radius * planet.radius) {
        hitPlanet = true;
        break;
      }
    }
    if (hitPlanet) {
      room.bullets.delete(bulletId);
      removedBulletIds.push(bulletId);
      continue;
    }

    let hitSomething = false;

    const bulletOwner = room.players.get(bullet.ownerId) || null;

    for (let i = 0; i < alivePlayers.length; i++) {
      const entry = alivePlayers[i];
      const target = entry.player;
      if (
        !target.alive ||
        target.id === bullet.ownerId ||
        arePlayersTeammates(bulletOwner, target)
      ) {
        continue;
      }

      const r = bullet.isMissile ? entry.missileRadius : entry.hitRadius;
      const rSq = bullet.isMissile ? entry.missileRadiusSq : entry.hitRadiusSq;
      const dx = shortestToroidalDelta(bullet.x, target.x, ARENA_WIDTH);
      const dy = shortestToroidalDelta(bullet.y, target.y, ARENA_HEIGHT);
      const hitShip =
        Math.abs(dx) <= r && Math.abs(dy) <= r && dx * dx + dy * dy <= rSq;

      let hitCursor = false;
      if (
        !hitShip &&
        target.spectating &&
        typeof target.cursorX === 'number' &&
        typeof target.cursorY === 'number'
      ) {
        const cursorR = bullet.isMissile ? 40 : 34;
        const cdx = shortestToroidalDelta(bullet.x, target.cursorX, ARENA_WIDTH);
        const cdy = shortestToroidalDelta(bullet.y, target.cursorY, ARENA_HEIGHT);
        hitCursor =
          Math.abs(cdx) <= cursorR &&
          Math.abs(cdy) <= cursorR &&
          cdx * cdx + cdy * cdy <= cursorR * cursorR;
      }

      if (hitShip || hitCursor) {
        hitSomething = true;
        if (
          (target.invulnerableTimer <= 0 || target.spectating) &&
          !target.cheats?.godMode &&
          !target.warping
        ) {
          target.hp -= bullet.damage;
        }
        if (!target.spectating && !target.warping) {
          const knockback = bullet.isMissile ? 95 : 65;
          target.vx += Math.cos(bullet.angle) * knockback;
          target.vy += Math.sin(bullet.angle) * knockback;
        }

        const attacker = room.players.get(bullet.ownerId) || null;
        const fatal = target.hp <= 0 && !target.cheats?.godMode && !target.warping;

        broadcastRoom(room, {
          type: 'combat:hit',
          targetId: target.id,
          attackerId: bullet.ownerId,
          x: Math.round(bullet.x),
          y: Math.round(bullet.y),
          vx: Math.round(target.vx),
          vy: Math.round(target.vy),
          damage: bullet.damage,
          fatal,
          color: bullet.color,
        });

        if (fatal) {
          const attackerSpeed = attacker ? Math.hypot(attacker.vx, attacker.vy) : 0;
          recordKill(
            room,
            attacker,
            target,
            bullet.isMissile ? 'missile' : 'laser',
            attackerSpeed
          );
        }
        break;
      }
    }

    if (hitSomething) {
      room.bullets.delete(bulletId);
      removedBulletIds.push(bulletId);
      continue;
    }

    for (let i = 0; i < asteroidsList.length; i++) {
      const ast = asteroidsList[i];
      if (ast.hp <= 0) continue;
      const r = ast.radius + (bullet.isMissile ? 6 : 0);
      const dx = shortestToroidalDelta(bullet.x, ast.x, ARENA_WIDTH);
      if (Math.abs(dx) > r) continue;
      const dy = shortestToroidalDelta(bullet.y, ast.y, ARENA_HEIGHT);
      if (Math.abs(dy) > r) continue;

      if (dx * dx + dy * dy <= r * r) {
        hitSomething = true;
        ast.hp -= bullet.damage;
        ast.vx += Math.cos(bullet.angle) * 24;
        ast.vy += Math.sin(bullet.angle) * 24;
        if (ast.hp <= 0) {
          room.asteroids.delete(ast.id);
          const attacker = room.players.get(bullet.ownerId);
          if (attacker) {
            attacker.score += 25;
          }
        }
        break;
      }
    }

    if (hitSomething) {
      room.bullets.delete(bulletId);
      removedBulletIds.push(bulletId);
    }
  }

  if (removedBulletIds.length > 0) {
    broadcastRoom(room, { type: 'bullets:remove', bulletIds: removedBulletIds });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  const httpServer = createHttpServer(app);
  const PORT = 3000;

  const musicDir = path.join(__dirname, 'src', 'components', 'music');
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }
  app.use('/music-box', express.static(musicDir));

  const deathSoundsDir = path.join(__dirname, 'src', 'components', 'deathsounds');
  if (!fs.existsSync(deathSoundsDir)) {
    fs.mkdirSync(deathSoundsDir, { recursive: true });
  }
  app.use('/death-sounds', express.static(deathSoundsDir));

  const shipsDir = path.join(__dirname, 'src', 'components', 'ships');
  if (!fs.existsSync(shipsDir)) {
    fs.mkdirSync(shipsDir, { recursive: true });
  }
  app.use('/ship-pngs', express.static(shipsDir));

  getOrCreateRoom('SECTOR-01');

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      rooms: getRoomSummaries(),
    });
  });

  app.get('/api/deathsounds', (_req, res) => {
    try {
      if (!fs.existsSync(deathSoundsDir)) {
        fs.mkdirSync(deathSoundsDir, { recursive: true });
      }
      const entries = fs.readdirSync(deathSoundsDir);
      const files = entries
        .filter((f) => f.toLowerCase().endsWith('.ogg'))
        .sort((a, b) => a.localeCompare(b))
        .map((filename) => {
          const stat = fs.statSync(path.join(deathSoundsDir, filename));
          return {
            filename,
            title: filename.replace(/\.ogg$/i, '').replace(/[_-]+/g, ' '),
            url: `/death-sounds/${encodeURIComponent(filename)}`,
            sizeBytes: stat.size,
          };
        });
      res.json({
        folder: 'src/components/deathsounds',
        files,
      });
    } catch (err) {
      console.error('Failed to scan src/components/deathsounds:', err);
      res.json({ folder: 'src/components/deathsounds', files: [] });
    }
  });

  app.get('/api/ship-pngs', (_req, res) => {
    try {
      if (!fs.existsSync(shipsDir)) {
        fs.mkdirSync(shipsDir, { recursive: true });
      }
      const entries = fs.readdirSync(shipsDir);
      const files = entries
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .sort((a, b) => a.localeCompare(b))
        .map((filename) => {
          const stat = fs.statSync(path.join(shipsDir, filename));
          return {
            filename,
            title: filename.replace(/\.png$/i, '').replace(/[_-]+/g, ' '),
            url: `/ship-pngs/${encodeURIComponent(filename)}`,
            sizeBytes: stat.size,
          };
        });
      res.json({
        folder: 'src/components/ships',
        files,
      });
    } catch (err) {
      console.error('Failed to scan src/components/ships:', err);
      res.json({ folder: 'src/components/ships', files: [] });
    }
  });

  app.get('/api/music', (_req, res) => {
    try {
      if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
      }
      const entries = fs.readdirSync(musicDir);
      const files = entries
        .filter((f) => f.toLowerCase().endsWith('.ogg'))
        .sort((a, b) => a.localeCompare(b))
        .map((filename) => {
          const stat = fs.statSync(path.join(musicDir, filename));
          return {
            filename,
            title: filename.replace(/\.ogg$/i, '').replace(/[_-]+/g, ' '),
            url: `/music-box/${encodeURIComponent(filename)}`,
            sizeBytes: stat.size,
          };
        });
      res.json({
        folder: 'src/components/music',
        files,
      });
    } catch (err) {
      console.error('Failed to scan src/components/music:', err);
      res.json({ folder: 'src/components/music', files: [] });
    }
  });

  app.post('/api/music/upload', (req, res) => {
    try {
      const { filename, base64Data } = req.body as {
        filename?: string;
        base64Data?: string;
      };
      if (!filename || !base64Data) {
        res.status(400).json({ error: 'Missing filename or base64Data' });
        return;
      }
      const safeName = path
        .basename(filename)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/(\.ogg)?$/i, '.ogg');
      const targetPath = path.join(musicDir, safeName);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(targetPath, buffer);
      res.json({
        ok: true,
        file: {
          filename: safeName,
          title: safeName.replace(/\.ogg$/i, '').replace(/[_-]+/g, ' '),
          url: `/music-box/${encodeURIComponent(safeName)}`,
          sizeBytes: buffer.length,
        },
      });
    } catch (err) {
      console.error('Failed to upload .ogg to src/components/music:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    socketToPlayerIds.set(ws, new Set());

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as ClientToServerMessage;

        if (msg.type === 'ping') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (ownedIds) {
            const nowMs = Date.now();
            for (const pid of ownedIds) {
              playerLastSeen.set(pid, nowMs);
            }
          }
          sendMsg(ws, {
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          });
          return;
        }

        if (msg.type === 'player:join') {
          const prevRoomId = socketToRoom.get(ws);
          const ownedIds = socketToPlayerIds.get(ws)!;
          const playerId = msg.playerId || nextId('plr');
          const cleanJoinName = (msg.name || 'PILOT').trim().slice(0, 16) || 'PILOT';
          const nowMs = Date.now();
          playerLastSeen.set(playerId, nowMs);

          // Transfer ownership if an older socket previously owned this playerId
          for (const [otherWs, otherSet] of socketToPlayerIds.entries()) {
            if (otherWs !== ws && otherSet.has(playerId)) {
              otherSet.delete(playerId);
            }
          }

          if (prevRoomId && prevRoomId !== msg.roomId) {
            const oldRoom = rooms.get(prevRoomId);
            if (oldRoom) {
              oldRoom.clients.delete(ws);
              for (const pid of ownedIds) {
                oldRoom.players.delete(pid);
                broadcastRoom(oldRoom, { type: 'player:left', playerId: pid });
              }
              ownedIds.clear();
            }
          }

          const room = getOrCreateRoom(msg.roomId);
          socketToRoom.set(ws, room.id);
          room.clients.add(ws);
          ownedIds.add(playerId);

          // Clean up any stale ghost duplicate with the same name from a recent page reload
          for (const [existingId, existingPlayer] of room.players.entries()) {
            if (
              existingId !== playerId &&
              !existingPlayer.isDrone &&
              existingPlayer.name === cleanJoinName
            ) {
              const lastSeen = playerLastSeen.get(existingId) ?? 0;
              if (nowMs - lastSeen > 1200) {
                room.players.delete(existingId);
                playerLastSeen.delete(existingId);
                for (const set of socketToPlayerIds.values()) {
                  set.delete(existingId);
                }
                broadcastRoom(room, { type: 'player:left', playerId: existingId });
              }
            }
          }

          let player = room.players.get(playerId);
          const hull: ShipHullType = HULL_SPECS[msg.hull] ? msg.hull : 'needle';
          const spec = HULL_SPECS[hull];
          const spawn = getSafeSpawnPoint(room, playerId);
          const color =
            msg.color && PLAYER_COLORS.includes(msg.color)
              ? msg.color
              : PLAYER_COLORS[room.colorIndex++ % PLAYER_COLORS.length];

          if (!player) {
            player = {
              id: playerId,
              name: cleanJoinName,
              color,
              hull,
              x: spawn.x,
              y: spawn.y,
              vx: 0,
              vy: 0,
              angle: -Math.PI / 2,
              thrusting: false,
              shooting: false,
              hp: spec.maxHp,
              maxHp: spec.maxHp,
              score: 0,
              kills: 0,
              deaths: 0,
              streak: 0,
              peakSpeed: 0,
              alive: true,
              respawnTimer: 0,
              invulnerableTimer: 2.0,
              lastFireTime: 0,
              inputSource: msg.inputSource || 'keyboard',
              cheats: { ...DEFAULT_PLAYER_CHEATS },
              deathSound: msg.deathSound,
              shipPng: msg.shipPng ?? null,
            };
            room.players.set(playerId, player);
          } else {
            player.name = cleanJoinName;
            player.hull = hull;
            player.inputSource = msg.inputSource || player.inputSource;
            if (msg.deathSound) {
              player.deathSound = msg.deathSound;
            }
            if (msg.shipPng !== undefined) {
              player.shipPng = msg.shipPng;
            }
          }

          sendMsg(ws, {
            type: 'room:init',
            roomId: room.id,
            selfId: playerId,
            gravityStarEnabled: room.gravityStarEnabled,
            players: Array.from(room.players.values()),
            bullets: Array.from(room.bullets.values()),
            asteroids: Array.from(room.asteroids.values()),
            planets: room.planets,
            killFeed: room.killFeed,
            chatMessages: room.chatMessages,
            rooms: getRoomSummaries(),
          });

          broadcastRoom(room, { type: 'player:joined', player }, ws);
          return;
        }

        let roomId = socketToRoom.get(ws);
        if (!roomId) {
          roomId = 'SECTOR-01';
          const defaultRoom = getOrCreateRoom(roomId);
          socketToRoom.set(ws, defaultRoom.id);
          defaultRoom.clients.add(ws);
        }
        const room = getOrCreateRoom(roomId);

        if (msg.type === 'player:input') {
          let ownedIds = socketToPlayerIds.get(ws);
          if (!ownedIds) {
            ownedIds = new Set();
            socketToPlayerIds.set(ws, ownedIds);
          }
          const player = room.players.get(msg.playerId);
          if (!player) return;

          // Ensure ownership is attached to the active socket sending input for this playerId
          if (!ownedIds.has(msg.playerId)) {
            for (const [otherWs, otherSet] of socketToPlayerIds.entries()) {
              if (otherWs !== ws && otherSet.has(msg.playerId)) {
                otherSet.delete(msg.playerId);
              }
            }
            ownedIds.add(msg.playerId);
          }
          playerLastSeen.set(msg.playerId, Date.now());

          if (Number.isFinite(msg.angle)) {
            player.angle = msg.angle;
          }
          player.spectating = Boolean(msg.spectating);
          player.spectateTargetId = msg.spectateTargetId ?? null;
          if (
            typeof msg.cursorX === 'number' &&
            typeof msg.cursorY === 'number' &&
            Number.isFinite(msg.cursorX) &&
            Number.isFinite(msg.cursorY)
          ) {
            player.cursorX = wrapCoord(msg.cursorX, ARENA_WIDTH);
            player.cursorY = wrapCoord(msg.cursorY, ARENA_HEIGHT);
          }

          if (msg.music !== undefined) {
            if (msg.music && msg.music.isPlaying) {
              const nowEpoch = Date.now();
              const prevMusic = player.music;
              const reportedTrackTime = Math.max(0, Number(msg.music.trackTime) || 0);
              const clientComputedStart = nowEpoch - Math.round(reportedTrackTime * 1000);
              const isSameTrack =
                prevMusic &&
                prevMusic.isPlaying &&
                prevMusic.filename === msg.music.filename;
              const prevStart = prevMusic?.startedAtServerMs;
              const didSeekOrRestart =
                !isSameTrack ||
                typeof prevStart !== 'number' ||
                Math.abs(clientComputedStart - prevStart) > 650;

              const authoritativeStartMs = didSeekOrRestart ? clientComputedStart : prevStart!;
              const authoritativeTrackTime = Math.max(
                0,
                Number(((nowEpoch - authoritativeStartMs) / 1000).toFixed(3))
              );

              player.music = {
                ...msg.music,
                trackTime: authoritativeTrackTime,
                updatedAt: nowEpoch,
                startedAtServerMs: authoritativeStartMs,
              };
            } else {
              player.music = null;
            }
          }
          if (msg.deathSound) {
            player.deathSound = msg.deathSound;
          }
          if (msg.shipPng !== undefined) {
            player.shipPng = msg.shipPng;
          }

          const wasWarping = Boolean(player.warping);
          player.warping = player.spectating ? false : Boolean(msg.warping);
          player.thrusting = player.spectating ? false : Boolean(msg.thrusting);
          player.shooting = player.spectating ? false : Boolean(msg.shooting);
          player.inputSource = msg.inputSource;

          if (
            player.alive &&
            typeof msg.x === 'number' &&
            typeof msg.y === 'number' &&
            typeof msg.vx === 'number' &&
            typeof msg.vy === 'number' &&
            Number.isFinite(msg.x) &&
            Number.isFinite(msg.y) &&
            Number.isFinite(msg.vx) &&
            Number.isFinite(msg.vy)
          ) {
            const clientDistToSun = Math.hypot(msg.x - GRAVITY_STAR_X, msg.y - GRAVITY_STAR_Y);
            if (!room.gravityStarEnabled || clientDistToSun >= GRAVITY_STAR_RADIUS) {
              player.x = wrapCoord(msg.x, ARENA_WIDTH);
              player.y = wrapCoord(msg.y, ARENA_HEIGHT);
              player.vx = msg.vx;
              player.vy = msg.vy;
              const spd = Math.hypot(player.vx, player.vy);
              if (spd > player.peakSpeed) {
                player.peakSpeed = Math.round(spd);
              }
            }
          }

          if (wasWarping && !player.warping) {
            player.vx = 0;
            player.vy = 0;
          }
          return;
        }

        if (msg.type === 'player:cheats') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (!ownedIds || !ownedIds.has(msg.playerId)) return;
          const player = room.players.get(msg.playerId);
          if (!player) return;

          player.cheats = {
            homingMissiles: Boolean(msg.cheats.homingMissiles),
            rapidFire: Boolean(msg.cheats.rapidFire),
            novaSpread: Boolean(msg.cheats.novaSpread),
            godMode: Boolean(msg.cheats.godMode),
            freeCam: Boolean(msg.cheats.freeCam),
          };
          player.spectating = Boolean(msg.cheats.freeCam);
          if (player.spectating) {
            player.warping = false;
          }
          return;
        }

        if (msg.type === 'player:cheat_action') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (!ownedIds || !ownedIds.has(msg.playerId)) return;
          const player = room.players.get(msg.playerId);
          if (!player) return;

          if (msg.action === 'missile_swarm' && player.alive) {
            spawnMissileSwarm(room, player, 8);
          } else if (msg.action === 'toggle_warp_speed' && player.alive && !player.spectating) {
            player.warping = !player.warping;
            if (player.warping) {
              player.invulnerableTimer = Math.max(player.invulnerableTimer, 0.5);
              player.vx = Math.cos(player.angle) * WARP_DRIVE_SPEED;
              player.vy = Math.sin(player.angle) * WARP_DRIVE_SPEED;
              if (WARP_DRIVE_SPEED > player.peakSpeed) {
                player.peakSpeed = WARP_DRIVE_SPEED;
              }
            } else {
              player.vx = 0;
              player.vy = 0;
            }
          } else if (msg.action === 'momentum_boost' && player.alive) {
            player.vx += Math.cos(player.angle) * 2500;
            player.vy += Math.sin(player.angle) * 2500;
            const spd = Math.hypot(player.vx, player.vy);
            if (spd > player.peakSpeed) player.peakSpeed = Math.round(spd);
          } else if (msg.action === 'momentum_zero' && player.alive) {
            player.warping = false;
            player.vx = 0;
            player.vy = 0;
          } else if (msg.action === 'spawn_drone' || msg.action === 'spawn_drones_100') {
            const countToSpawn = msg.action === 'spawn_drones_100' ? 100 : 1;
            let currentDrones = 0;
            for (const p of room.players.values()) {
              if (p.isDrone) currentDrones++;
            }
            const excess = currentDrones + countToSpawn - 105;
            if (excess > 0) {
              let removed = 0;
              for (const [pid, p] of room.players.entries()) {
                if (p.isDrone) {
                  room.players.delete(pid);
                  removed++;
                  if (removed >= excess) break;
                }
              }
            }
            const spawnedDrones = createTargetDronesBatch(room.players, countToSpawn, player);
            for (const drone of spawnedDrones) {
              room.players.set(drone.id, drone);
              if (countToSpawn === 1) {
                broadcastRoom(room, { type: 'player:joined', player: drone });
              }
            }
          } else if (msg.action === 'clear_drones') {
            for (const [pid, p] of room.players.entries()) {
              if (p.isDrone) {
                room.players.delete(pid);
                broadcastRoom(room, { type: 'player:left', playerId: pid });
              }
            }
          }
          return;
        }

        if (msg.type === 'player:rename') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (!ownedIds || !ownedIds.has(msg.playerId)) return;
          const player = room.players.get(msg.playerId);
          if (!player) return;
          const clean = (msg.newName || '').trim().slice(0, 16);
          if (clean) {
            player.name = clean;
          }
          return;
        }

        if (msg.type === 'player:cheat_rename') {
          const clean = (msg.newName || '').trim().slice(0, 16);
          if (!clean) return;

          if (msg.targetId === 'ALL_OTHERS') {
            for (const p of room.players.values()) {
              if (p.id !== msg.requesterId) {
                p.name = clean;
              }
            }
          } else {
            const target = room.players.get(msg.targetId);
            if (target) {
              target.name = clean;
            }
          }
          return;
        }

        if (msg.type === 'player:respawn') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (!ownedIds || !ownedIds.has(msg.playerId)) return;
          const player = room.players.get(msg.playerId);
          if (!player) return;

          if (msg.hull && HULL_SPECS[msg.hull]) {
            player.hull = msg.hull;
          }
          if (msg.name) {
            player.name = msg.name.trim().slice(0, 16) || player.name;
          }
          const spec = HULL_SPECS[player.hull];
          const pt = getSafeSpawnPoint(room);
          player.x = pt.x;
          player.y = pt.y;
          player.vx = 0;
          player.vy = 0;
          player.hp = spec.maxHp;
          player.maxHp = spec.maxHp;
          player.alive = true;
          player.respawnTimer = 0;
          player.invulnerableTimer = 2.0;
          return;
        }

        if (msg.type === 'player:leave') {
          const ownedIds = socketToPlayerIds.get(ws);
          if (ownedIds && ownedIds.has(msg.playerId)) {
            ownedIds.delete(msg.playerId);
            room.players.delete(msg.playerId);
            broadcastRoom(room, { type: 'player:left', playerId: msg.playerId });
          }
          return;
        }

        if (msg.type === 'room:toggle_star') {
          room.gravityStarEnabled = Boolean(msg.enabled);
          return;
        }

        if (msg.type === 'chat:send') {
          const parsed = parseChatInput(msg.text);
          if (!parsed) return;

          const player = room.players.get(msg.playerId);
          const senderName =
            (player?.name || msg.senderName || 'PILOT').trim().slice(0, 16) || 'PILOT';
          const senderColor =
            player?.color && PLAYER_COLORS.includes(player.color)
              ? player.color
              : msg.senderColor && PLAYER_COLORS.includes(msg.senderColor)
              ? msg.senderColor
              : '#38BDF8';

          const msgId =
            msg.id && typeof msg.id === 'string' && msg.id.length <= 64
              ? msg.id
              : nextId('chat');

          if (room.chatMessages.some((m) => m.id === msgId)) {
            return;
          }

          const chatEntry: ChatMessage = {
            id: msgId,
            senderId: msg.playerId,
            senderName,
            senderColor,
            text: parsed.text,
            isServerWide: parsed.isServerWide,
            timestamp: Date.now(),
          };

          room.chatMessages.push(chatEntry);
          if (room.chatMessages.length > 60) {
            room.chatMessages.splice(0, room.chatMessages.length - 60);
          }

          broadcastRoom(room, { type: 'chat:message', message: chatEntry });
          return;
        }
      } catch (err) {
        console.error('WS message error:', err);
      }
    });

    ws.on('close', () => {
      const roomId = socketToRoom.get(ws);
      const ownedIds = socketToPlayerIds.get(ws);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.clients.delete(ws);
          if (ownedIds) {
            for (const pid of ownedIds) {
              room.players.delete(pid);
              broadcastRoom(room, { type: 'player:left', playerId: pid });
            }
          }
        }
      }
      socketToRoom.delete(ws);
      socketToPlayerIds.delete(ws);
    });
  });

  let lastTick = performance.now();
  let tickCount = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;
    const nowSec = now / 1000;
    tickCount++;

    const summaries = tickCount % 30 === 0 ? getRoomSummaries() : [];

    for (const room of rooms.values()) {
      if (room.clients.size === 0 && room.players.size === 0) continue;
      stepRoomSimulation(room, dt, nowSec);

      if (tickCount % 2 === 0 && room.clients.size > 0) {
        const includeFullBullets = room.bullets.size <= 40;
        broadcastRoom(room, {
          type: 'state:snapshot',
          serverTime: Date.now(),
          gravityStarEnabled: room.gravityStarEnabled,
          players: Array.from(room.players.values()),
          bullets: includeFullBullets ? Array.from(room.bullets.values()) : undefined,
          asteroids: Array.from(room.asteroids.values()),
          planets: room.planets,
          rooms: summaries,
        });
      }
    }
  }, 1000 / 60);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Vector Spacewar server running on http://localhost:${PORT}`);
  });
}

startServer();
