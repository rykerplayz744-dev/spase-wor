export type ShipHullType = 'needle' | 'wedge' | 'interceptor' | 'disc';

export interface HullSpec {
  id: ShipHullType;
  name: string;
  codename: string;
  description: string;
  thrustAccel: number; // u/s^2 (infinite momentum - no cap!)
  fireCooldown: number; // seconds
  bulletSpeed: number; // base muzzle velocity added to ship velocity
  bulletDamage: number;
  maxHp: number;
  radius: number;
  spreadCount: number;
  spreadAngle: number;
}

export const HULL_SPECS: Record<ShipHullType, HullSpec> = {
  needle: {
    id: 'needle',
    name: 'Needle Mk-IV',
    codename: 'PDP-1 Classic',
    description: 'High-velocity precision lance hull with rapid acceleration and high-speed rail bolts.',
    thrustAccel: 540,
    fireCooldown: 0.18,
    bulletSpeed: 880,
    bulletDamage: 24,
    maxHp: 100,
    radius: 17,
    spreadCount: 1,
    spreadAngle: 0,
  },
  wedge: {
    id: 'wedge',
    name: 'Wedge Heavy',
    codename: 'Dreadnought',
    description: 'Armored delta hull firing heavy twin-linked plasma bolts with high hull integrity.',
    thrustAccel: 440,
    fireCooldown: 0.28,
    bulletSpeed: 760,
    bulletDamage: 38,
    maxHp: 135,
    radius: 20,
    spreadCount: 2,
    spreadAngle: 0.06,
  },
  interceptor: {
    id: 'interceptor',
    name: 'Viper Dart',
    codename: 'Hyper-Vector',
    description: 'Extreme thruster output designed to build infinite momentum rapidly and outrun fire.',
    thrustAccel: 680,
    fireCooldown: 0.13,
    bulletSpeed: 940,
    bulletDamage: 18,
    maxHp: 90,
    radius: 16,
    spreadCount: 1,
    spreadAngle: 0,
  },
  disc: {
    id: 'disc',
    name: 'Saucer Array',
    codename: 'Tri-Vector',
    description: 'Omnidirectional combat frame firing a three-round vector spread burst.',
    thrustAccel: 500,
    fireCooldown: 0.32,
    bulletSpeed: 780,
    bulletDamage: 20,
    maxHp: 115,
    radius: 19,
    spreadCount: 3,
    spreadAngle: 0.16,
  },
};

export const ARENA_WIDTH = 28000;
export const ARENA_HEIGHT = 18000;
export const GRAVITY_STAR_X = ARENA_WIDTH / 2;
export const GRAVITY_STAR_Y = ARENA_HEIGHT / 2;
export const GRAVITY_STAR_RADIUS = 440;
export const GRAVITY_STRENGTH = 420000000; // GM constant scaled for 10x central star gravitational slingshots

export const PLAYER_COLORS = [
  '#38BDF8', // Sky Cyan
  '#F59E0B', // Telemetry Amber
  '#10B981', // Emerald Vector
  '#F43F5E', // Coral Crimson
  '#A855F7', // Plasma Violet
  '#EAB308', // Solar Gold
  '#EC4899', // Magenta Flare
  '#2DD4BF', // Teal Ion
];

export interface PlayerCheats {
  homingMissiles: boolean;
  rapidFire: boolean;
  novaSpread: boolean;
  godMode: boolean;
  freeCam: boolean;
}

export const DEFAULT_PLAYER_CHEATS: PlayerCheats = {
  homingMissiles: false,
  rapidFire: false,
  novaSpread: false,
  godMode: false,
  freeCam: false,
};

export const MUSIC_HEARING_RADIUS = 1800;

export interface PlayerMusicState {
  filename: string;
  title: string;
  isPlaying: boolean;
  trackTime: number;
  updatedAt: number;
  startedAtServerMs?: number;
  volume: number;
  loopTrack: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  hull: ShipHullType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // Radians: exact direction the ship faces
  thrusting: boolean;
  shooting: boolean;
  hp: number;
  maxHp: number;
  score: number;
  kills: number;
  deaths: number;
  streak: number;
  peakSpeed: number; // Highest momentum achieved (u/s)
  alive: boolean;
  respawnTimer: number;
  invulnerableTimer: number;
  lastFireTime: number;
  inputSource: 'gamepad' | 'keyboard';
  cheats?: PlayerCheats;
  isDrone?: boolean;
  squadId?: string | null;
  aiTargetId?: string | null;
  spectating?: boolean;
  spectateTargetId?: string | null;
  cursorX?: number;
  cursorY?: number;
  music?: PlayerMusicState | null;
  deathSound?: string;
  shipPng?: string | null;
  warping?: boolean;
  landedPlanetId?: string | null;
  landedSurfaceAngle?: number;
  // Client-side interpolation targets to hide choppy relay updates
  netTargetX?: number;
  netTargetY?: number;
  netTargetVx?: number;
  netTargetVy?: number;
  netTargetAngle?: number;
  netTargetCursorX?: number;
  netTargetCursorY?: number;
  netUpdatedAt?: number;
}

export const SHIP_SMASH_SPEED_THRESHOLD = 1000;
export const PLANET_LANDING_SPEED_THRESHOLD = 500;
export const WARP_DRIVE_SPEED = 4800;

export interface BulletState {
  id: string;
  ownerId: string;
  ownerName: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  damage: number;
  ttl: number;
  maxTtl: number;
  isMissile?: boolean;
  targetId?: string;
  turnRate?: number;
}

export interface AsteroidState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  vAngle: number;
  hp: number;
  maxHp: number;
  vertices: number[]; // Normalized radial offsets
}

export interface PlanetState {
  id: string;
  name: string;
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number; // rad/s around the Sun
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  accentColor: string;
  gravityStrength: number;
  hasRings: boolean;
}

export const INITIAL_PLANETS: Omit<PlanetState, 'x' | 'y' | 'vx' | 'vy'>[] = [
  {
    id: 'planet_vulcanis',
    name: 'VULCANIS',
    orbitRadius: 2350,
    orbitAngle: 0.4,
    orbitSpeed: 0.12,
    radius: 220,
    color: '#F97316',
    accentColor: '#FDBA74',
    gravityStrength: 36000000,
    hasRings: false,
  },
  {
    id: 'planet_telluria',
    name: 'TELLURIA',
    orbitRadius: 4300,
    orbitAngle: 2.3,
    orbitSpeed: 0.075,
    radius: 320,
    color: '#0EA5E9',
    accentColor: '#34D399',
    gravityStrength: 58000000,
    hasRings: false,
  },
  {
    id: 'planet_kronos',
    name: 'KRONOS-VI',
    orbitRadius: 6500,
    orbitAngle: 4.2,
    orbitSpeed: 0.048,
    radius: 440,
    color: '#EAB308',
    accentColor: '#FDE047',
    gravityStrength: 92000000,
    hasRings: true,
  },
  {
    id: 'planet_neptuna',
    name: 'NEPTUNA',
    orbitRadius: 8500,
    orbitAngle: 5.5,
    orbitSpeed: -0.032,
    radius: 300,
    color: '#6366F1',
    accentColor: '#A5B4FC',
    gravityStrength: 52000000,
    hasRings: true,
  },
];

export interface KillFeedEntry {
  id: string;
  killerId: string;
  killerName: string;
  killerColor: string;
  victimId: string;
  victimName: string;
  victimColor: string;
  cause: 'laser' | 'missile' | 'star' | 'planet' | 'asteroid' | 'collision';
  speedAtKill: number;
  timestamp: number;
  deathSound?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  isServerWide: boolean;
  timestamp: number;
}

export interface RoomSummary {
  roomId: string;
  playerCount: number;
  gravityStarEnabled: boolean;
}

export type CheatActionType =
  | 'missile_swarm'
  | 'momentum_boost'
  | 'momentum_zero'
  | 'toggle_warp_speed'
  | 'spawn_drone'
  | 'spawn_drones_100'
  | 'clear_drones';

export type ClientToServerMessage =
  | {
      type: 'player:join';
      roomId: string;
      playerId?: string;
      name: string;
      hull: ShipHullType;
      color?: string;
      inputSource: 'gamepad' | 'keyboard';
      deathSound?: string;
      shipPng?: string | null;
    }
  | {
      type: 'player:input';
      playerId: string;
      angle: number;
      thrusting: boolean;
      shooting: boolean;
      pulseBrake?: boolean;
      warpRequested?: boolean;
      inputSource: 'gamepad' | 'keyboard';
      // Client-authoritative kinematics for zero-latency local ship feel, validated by server
      x?: number;
      y?: number;
      vx?: number;
      vy?: number;
      spectating?: boolean;
      spectateTargetId?: string | null;
      cursorX?: number;
      cursorY?: number;
      music?: PlayerMusicState | null;
      deathSound?: string;
      shipPng?: string | null;
      warping?: boolean;
      landedPlanetId?: string | null;
      landedSurfaceAngle?: number;
      cheats?: PlayerCheats;
    }
  | {
      type: 'player:env_hit';
      playerId: string;
      cause: 'asteroid' | 'planet';
      sourceId: string;
      sourceName: string;
      sourceColor: string;
      damage: number;
      fatal: boolean;
      impactSpeed: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
    }
  | {
      type: 'player:cheats';
      playerId: string;
      cheats: PlayerCheats;
    }
  | {
      type: 'player:cheat_action';
      playerId: string;
      action: CheatActionType;
    }
  | {
      type: 'player:rename';
      playerId: string;
      newName: string;
    }
  | {
      type: 'player:cheat_rename';
      requesterId: string;
      targetId: string | 'ALL_OTHERS';
      newName: string;
    }
  | {
      type: 'player:respawn';
      playerId: string;
      hull?: ShipHullType;
      name?: string;
    }
  | {
      type: 'player:leave';
      playerId: string;
    }
  | {
      type: 'room:toggle_star';
      enabled: boolean;
    }
  | {
      type: 'chat:send';
      id?: string;
      playerId: string;
      senderName: string;
      senderColor: string;
      text: string;
    }
  | {
      type: 'ping';
      clientTime: number;
    };

export interface SalvoSpawnPayload {
  idPrefix: string;
  ownerId: string;
  ownerName: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  noseDist: number;
  count: number;
  spreadAngle: number;
  novaSpread: boolean;
  baseMuzzle: number;
  damage: number;
  ttl: number;
  isMissile: boolean;
  targetIds: string[];
}

export function expandSalvoToBullets(salvo: SalvoSpawnPayload): BulletState[] {
  const result: BulletState[] = [];
  const {
    idPrefix,
    ownerId,
    ownerName,
    color,
    x,
    y,
    vx,
    vy,
    angle,
    noseDist,
    count,
    spreadAngle,
    novaSpread,
    baseMuzzle,
    damage,
    ttl,
    isMissile,
    targetIds,
  } = salvo;

  const spreadStep = novaSpread ? (Math.PI * 2) / count : spreadAngle;
  const startOffset = novaSpread ? 0 : count > 1 ? -((count - 1) * spreadAngle) / 2 : 0;
  const tLen = targetIds.length;

  for (let i = 0; i < count; i++) {
    const shotAngle = angle + startOffset + i * spreadStep;
    const dirX = Math.cos(shotAngle);
    const dirY = Math.sin(shotAngle);

    const forwardBoost = Math.max(0, vx * dirX + vy * dirY);
    const effectiveMuzzle = baseMuzzle + forwardBoost * 0.85;

    const bvx = dirX * effectiveMuzzle;
    const bvy = dirY * effectiveMuzzle;

    const bx = (((x + dirX * noseDist) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
    const by = (((y + dirY * noseDist) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;

    result.push({
      id: `${idPrefix}_${i}`,
      ownerId,
      ownerName,
      color: isMissile ? '#F43F5E' : color,
      x: bx,
      y: by,
      vx: bvx,
      vy: bvy,
      angle: shotAngle,
      damage,
      ttl,
      maxTtl: ttl,
      isMissile,
      targetId: isMissile && tLen > 0 ? targetIds[i % tLen] : undefined,
      turnRate: 6.4,
    });
  }

  return result;
}

export function parseChatInput(raw: string): { text: string; isServerWide: boolean } | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // Match "/server-wide " followed by the message text
  if (/^\/server-wide(?:\s+|$)/i.test(trimmed)) {
    const body = trimmed.replace(/^\/server-wide\s*/i, '').trim();
    if (!body) return null;
    return {
      text: body.slice(0, 220),
      isServerWide: true,
    };
  }

  return {
    text: trimmed.slice(0, 220),
    isServerWide: false,
  };
}

export type ServerToClientMessage =
  | {
      type: 'room:init';
      roomId: string;
      selfId: string;
      gravityStarEnabled: boolean;
      players: PlayerState[];
      bullets: BulletState[];
      asteroids: AsteroidState[];
      planets: PlanetState[];
      killFeed: KillFeedEntry[];
      chatMessages?: ChatMessage[];
      rooms: RoomSummary[];
    }
  | {
      type: 'state:snapshot';
      serverTime: number;
      gravityStarEnabled: boolean;
      players: PlayerState[];
      bullets?: BulletState[];
      asteroids: AsteroidState[];
      planets: PlanetState[];
      rooms: RoomSummary[];
    }
  | {
      type: 'salvo:spawn';
      salvo: SalvoSpawnPayload;
    }
  | {
      type: 'bullets:spawn_batch';
      bullets: BulletState[];
    }
  | {
      type: 'bullets:remove';
      bulletIds: string[];
    }
  | {
      type: 'player:joined';
      player: PlayerState;
    }
  | {
      type: 'player:left';
      playerId: string;
    }
  | {
      type: 'combat:hit';
      targetId: string;
      attackerId: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      damage: number;
      fatal: boolean;
      color: string;
      cause?: KillFeedEntry['cause'];
      deathSound?: string;
    }
  | {
      type: 'combat:kill';
      entry: KillFeedEntry;
    }
  | {
      type: 'chat:message';
      message: ChatMessage;
    }
  | {
      type: 'pong';
      clientTime: number;
      serverTime: number;
    };

function shortestDelta(from: number, to: number, size: number): number {
  let d = to - from;
  if (d > size * 0.5) d -= size;
  if (d < -size * 0.5) d += size;
  return d;
}

function normAngle(diff: number): number {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function hashIdToNumber(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function arePlayersTeammates(
  a?: PlayerState | null,
  b?: PlayerState | null
): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  if (a.squadId && b.squadId && a.squadId === b.squadId) return true;
  return false;
}

/**
 * Shared AI Dogfighting & Squad Teaming Brain for Target Drones (`isDrone: true`).
 * Eliminates the passive circular galaxy drift: AI ships actively hunt players and rival ships,
 * form 2–4 ship tactical teams (`squadId`) that fly as wingmen and focus-fire enemies,
 * avoid clumping/hazards, and lead-aim their weapons.
 */
export function stepAiDroneAutopilot(
  drone: PlayerState,
  players: Map<string, PlayerState>,
  planets: PlanetState[],
  gravityStarEnabled: boolean,
  dt: number,
  nowSec: number
): void {
  if (!drone.alive || !drone.isDrone) return;

  const seed = hashIdToNumber(drone.id);
  const canTeamUp = seed % 10 < 6; // ~60% of AI ships are open to forming/joining tactical squads
  const strafeSign = seed % 2 === 0 ? 1 : -1;
  const spec = HULL_SPECS[drone.hull] || HULL_SPECS.needle;

  // 1. Scan nearby ships for:
  //    (a) anti-clumping separation
  //    (b) squadmates / dynamic teaming
  //    (c) enemy target acquisition (human players prioritized, plus squad focus-fire)
  let sepX = 0;
  let sepY = 0;
  let nearestMate: PlayerState | null = null;
  let nearestMateDistSq = Infinity;
  let squadMateCount = 0;
  let bestEnemy: PlayerState | null = null;
  let bestEnemyScore = Infinity; // Lower score = higher priority

  // Check if our current locked target is still valid
  const currentTarget = drone.aiTargetId ? players.get(drone.aiTargetId) : undefined;
  const validLockedTarget =
    currentTarget &&
    currentTarget.alive &&
    !currentTarget.spectating &&
    currentTarget.id !== drone.id &&
    !arePlayersTeammates(drone, currentTarget)
      ? currentTarget
      : null;

  // Bound per-frame scan cost so even 100+ ships run at 60fps on Chromebooks without blocking UI clicks
  const totalPlayers = players.size;
  const stride = totalPlayers > 90 ? Math.ceil(totalPlayers / 45) : 1;
  const strideOffset = (seed + Math.floor(nowSec * 60)) % stride;
  let idx = 0;

  for (const other of players.values()) {
    idx++;
    if (!other.alive || other.id === drone.id || other.spectating) continue;

    const isSameSquad = Boolean(drone.squadId && other.squadId === drone.squadId);
    const isLocked = Boolean(validLockedTarget && other.id === validLockedTarget.id);
    if (
      stride > 1 &&
      other.isDrone &&
      !isSameSquad &&
      !isLocked &&
      idx % stride !== strideOffset
    ) {
      continue;
    }

    const dx = shortestDelta(drone.x, other.x, ARENA_WIDTH);
    const dy = shortestDelta(drone.y, other.y, ARENA_HEIGHT);
    const distSq = dx * dx + dy * dy;

    // Anti-clumping separation within 260 units so ships never stack in lines or spirals
    if (distSq < 260 * 260 && distSq > 1) {
      const dist = Math.sqrt(distSq);
      const push = (260 - dist) / 260;
      sepX -= (dx / dist) * push * 2.2;
      sepY -= (dy / dist) * push * 2.2;
    }

    // Dynamic Teaming: if both AI ships are team-friendly and within 620u, form or join a squad
    if (other.isDrone && canTeamUp && !drone.squadId && distSq < 620 * 620) {
      const otherSeed = hashIdToNumber(other.id);
      if (otherSeed % 10 < 6) {
        if (other.squadId) {
          drone.squadId = other.squadId;
          drone.color = other.color;
        } else {
          const newSquadId = `SQUAD-${((seed ^ otherSeed) % 89) + 10}`;
          drone.squadId = newSquadId;
          other.squadId = newSquadId;
          drone.color = other.color;
        }
      }
    }

    if (arePlayersTeammates(drone, other)) {
      squadMateCount++;
      if (distSq < nearestMateDistSq) {
        nearestMateDistSq = distSq;
        nearestMate = other;
      }
      continue;
    }

    // Evaluate enemy candidate
    // Only scan within 5,600 units unless we have no target at all
    if (distSq > 5600 * 5600 && bestEnemy !== null) continue;

    const dist = Math.sqrt(distSq);
    let priorityDist = dist;

    // Strongly prioritize attacking human players so the sector feels alive and dangerous!
    if (!other.isDrone) {
      priorityDist *= 0.42;
    }

    // Stickiness bonus for our currently locked target so AI doesn't jitter between targets
    if (isLocked) {
      priorityDist *= 0.72;
    }

    // Squad Focus-Fire bonus: if our nearest squadmate is targeting this enemy, gang up on them!
    if (nearestMate && nearestMate.aiTargetId === other.id) {
      priorityDist *= 0.55;
    }

    if (priorityDist < bestEnemyScore) {
      bestEnemyScore = priorityDist;
      bestEnemy = other;
    }
  }

  // Ensure our locked target is always considered even when striding
  if (!bestEnemy && validLockedTarget) {
    bestEnemy = validLockedTarget;
  }

  // If a squadmate has a target within reasonable distance and we don't have a close human target, assist our squadmate!
  if (nearestMate && nearestMate.aiTargetId) {
    const mateTarget = players.get(nearestMate.aiTargetId);
    if (
      mateTarget &&
      mateTarget.alive &&
      !mateTarget.spectating &&
      !arePlayersTeammates(drone, mateTarget)
    ) {
      const mdx = shortestDelta(drone.x, mateTarget.x, ARENA_WIDTH);
      const mdy = shortestDelta(drone.y, mateTarget.y, ARENA_HEIGHT);
      const mDist = Math.hypot(mdx, mdy);
      if (!bestEnemy || (bestEnemy.isDrone && mDist < 3200)) {
        bestEnemy = mateTarget;
      }
    }
  }

  // If our squad has no other alive members left, clear stale squadId so we can form a new team later
  if (drone.squadId && squadMateCount === 0 && stride === 1 && (seed + Math.floor(nowSec)) % 12 === 0) {
    drone.squadId = null;
  }

  drone.aiTargetId = bestEnemy ? bestEnemy.id : null;

  // 2. Compute desired steering vector
  let steerX = sepX;
  let steerY = sepY;
  let wantsThrust = false;
  let wantsShoot = false;

  if (bestEnemy) {
    const dx = shortestDelta(drone.x, bestEnemy.x, ARENA_WIDTH);
    const dy = shortestDelta(drone.y, bestEnemy.y, ARENA_HEIGHT);
    const dist = Math.max(1, Math.hypot(dx, dy));

    // Predictive lead intercept calculation using target velocity & relative motion
    const leadTime = Math.min(1.15, dist / Math.max(600, spec.bulletSpeed));
    const leadDx = dx + (bestEnemy.vx - drone.vx * 0.35) * leadTime;
    const leadDy = dy + (bestEnemy.vy - drone.vy * 0.35) * leadTime;
    const leadAngle = Math.atan2(leadDy, leadDx);

    if (dist < 310) {
      // Close-quarters dogfight weave/strafe so AI circles and blasts the target instead of parking on top of it
      const strafeAngle = leadAngle + strafeSign * (Math.PI * 0.38);
      steerX += Math.cos(strafeAngle) * 1.6;
      steerY += Math.sin(strafeAngle) * 1.6;
      wantsThrust = true;
    } else {
      // Direct intercept pursuit
      steerX += Math.cos(leadAngle) * 1.9;
      steerY += Math.sin(leadAngle) * 1.9;
      wantsThrust = dist > 380 || Math.hypot(drone.vx, drone.vy) < 380;
    }

    // Wingman Flanking Cohesion when teamed up
    if (nearestMate && nearestMateDistSq < 1800 * 1800 && nearestMateDistSq > 220 * 220) {
      const mdx = shortestDelta(drone.x, nearestMate.x, ARENA_WIDTH);
      const mdy = shortestDelta(drone.y, nearestMate.y, ARENA_HEIGHT);
      const mDist = Math.sqrt(nearestMateDistSq);
      steerX += (mdx / mDist) * 0.48;
      steerY += (mdy / mDist) * 0.48;
    }

    // Fire weapons when enemy is within 1,850 units and nose is lined up within ~24 degrees
    const aimError = Math.abs(normAngle(leadAngle - drone.angle));
    if (dist < 1850 && aimError < 0.42) {
      wantsShoot = true;
    }
  } else {
    // Roaming / Squad Patrol when no enemy is in range (never a circular galaxy spiral!)
    if (nearestMate && nearestMateDistSq > 240 * 240 && nearestMateDistSq < 2200 * 2200) {
      const mdx = shortestDelta(drone.x, nearestMate.x, ARENA_WIDTH);
      const mdy = shortestDelta(drone.y, nearestMate.y, ARENA_HEIGHT);
      const mDist = Math.sqrt(nearestMateDistSq);
      steerX += (mdx / mDist) * 1.2 + Math.cos(nearestMate.angle) * 0.7;
      steerY += (mdy / mDist) * 1.2 + Math.sin(nearestMate.angle) * 0.7;
      wantsThrust = true;
    } else {
      const wanderAngle =
        ((seed % 628) / 100) +
        Math.sin(nowSec * 0.55 + (seed % 37)) * 1.15 +
        Math.cos(nowSec * 0.27 + (seed % 19)) * 0.75;
      steerX += Math.cos(wanderAngle);
      steerY += Math.sin(wanderAngle);
      wantsThrust = Math.hypot(drone.vx, drone.vy) < 340;
    }
  }

  // 3. Hazard Avoidance (Central Gravity Star & Orbiting Planets)
  if (gravityStarEnabled) {
    const dxStar = shortestDelta(GRAVITY_STAR_X, drone.x, ARENA_WIDTH); // vector from Star to drone
    const dyStar = shortestDelta(GRAVITY_STAR_Y, drone.y, ARENA_HEIGHT);
    const distStar = Math.hypot(dxStar, dyStar);
    if (distStar < GRAVITY_STAR_RADIUS + 950 && distStar > 1) {
      const urgency = Math.min(4.0, (GRAVITY_STAR_RADIUS + 950 - distStar) / 220);
      steerX += (dxStar / distStar) * urgency * 2.8;
      steerY += (dyStar / distStar) * urgency * 2.8;
      wantsThrust = true;
    }
  }

  for (let i = 0; i < planets.length; i++) {
    const planet = planets[i];
    const dxP = shortestDelta(planet.x, drone.x, ARENA_WIDTH);
    const dyP = shortestDelta(planet.y, drone.y, ARENA_HEIGHT);
    const distP = Math.hypot(dxP, dyP);
    const safeRadius = planet.radius + 320;
    if (distP < safeRadius && distP > 1) {
      const urgency = (safeRadius - distP) / 140;
      steerX += (dxP / distP) * urgency * 2.4;
      steerY += (dyP / distP) * urgency * 2.4;
      wantsThrust = true;
    }
  }

  // 4. Smoothly rotate ship nose toward desired steering vector
  const desiredAngle =
    Math.abs(steerX) > 0.001 || Math.abs(steerY) > 0.001
      ? Math.atan2(steerY, steerX)
      : drone.angle;
  const angleDiff = normAngle(desiredAngle - drone.angle);
  const maxTurn = 6.2 * dt;
  drone.angle = normAngle(drone.angle + Math.max(-maxTurn, Math.min(maxTurn, angleDiff)));

  // Also thrust if our current velocity vector is misaligned with where we want to go
  const currentSpd = Math.hypot(drone.vx, drone.vy);
  if (currentSpd > 460) {
    // Gentle velocity vector damping when maneuvering at high speeds so AI ships turn sharply instead of drifting endlessly
    const damp = Math.max(0.92, 1 - 0.85 * dt);
    drone.vx *= damp;
    drone.vy *= damp;
  }

  drone.thrusting = wantsThrust || currentSpd < 220;
  drone.shooting = wantsShoot;
}

