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
  spectating?: boolean;
  spectateTargetId?: string | null;
  cursorX?: number;
  cursorY?: number;
  music?: PlayerMusicState | null;
  deathSound?: string;
  shipPng?: string | null;
  warping?: boolean;
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
