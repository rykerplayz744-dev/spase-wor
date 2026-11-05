import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  ChatMessage,
  CheatActionType,
  getRoomArenaConfig,
  GRAVITY_STAR_X,
  GRAVITY_STAR_Y,
  HULL_SPECS,
  KillFeedEntry,
  PLAYER_COLORS,
  PlanetState,
  PlayerState,
  SalvoSpawnPayload,
  ShipHullType,
} from '../shared/types.ts';

const HULL_LIST: ShipHullType[] = ['needle', 'wedge', 'interceptor', 'disc'];

export interface DroneBatchSpec {
  seed: number;
  count: number;
  startNum: number;
  refX?: number;
  refY?: number;
  roomId?: string;
}

export type PeerSyncPacket =
  | {
      type: 'peer:hello';
      senderId: string;
      roomId?: string;
      player?: PlayerState;
      player2?: PlayerState;
    }
  | {
      type: 'peer:welcome';
      senderId: string;
      roomId?: string;
      players: PlayerState[];
      asteroids: AsteroidState[];
      planets: PlanetState[];
      killFeed: KillFeedEntry[];
      gravityStarEnabled: boolean;
    }
  | {
      type: 'peer:player_state';
      senderId: string;
      roomId?: string;
      player: PlayerState;
      player2?: PlayerState;
      drones?: PlayerState[];
      asteroids?: AsteroidState[];
    }
  | {
      type: 'peer:player_leave';
      senderId: string;
      roomId?: string;
      playerId: string;
    }
  | {
      type: 'peer:salvo';
      senderId: string;
      roomId?: string;
      salvo: SalvoSpawnPayload;
    }
  | {
      type: 'peer:cheat_action';
      senderId: string;
      roomId?: string;
      playerId: string;
      action: CheatActionType;
      droneBatch?: DroneBatchSpec;
      spawnedDrones?: PlayerState[];
    }
  | {
      type: 'peer:rename';
      senderId: string;
      roomId?: string;
      playerId: string;
      newName: string;
    }
  | {
      type: 'peer:cheat_rename';
      senderId: string;
      roomId?: string;
      requesterId: string;
      targetId: string | 'ALL_OTHERS';
      newName: string;
    }
  | {
      type: 'peer:combat_hit';
      senderId: string;
      roomId?: string;
      hitId?: string;
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
      killEntry?: KillFeedEntry;
    }
  | {
      type: 'peer:chat';
      senderId: string;
      roomId?: string;
      message: ChatMessage;
    }
  | {
      type: 'peer:focus';
      senderId: string;
      roomId?: string;
      focused: boolean;
    };

export function getSafeSunOrbitPoint(roomId: string = 'SECTOR-01'): { x: number; y: number } {
  const arena = getRoomArenaConfig(roomId);
  const theta = Math.random() * Math.PI * 2;
  const orbitRadius = arena.fixedCamera
    ? 230 + Math.random() * 210
    : 2200 + Math.random() * 1600;
  const x =
    (((arena.starX + Math.cos(theta) * orbitRadius) % arena.width) + arena.width) % arena.width;
  const y =
    (((arena.starY + Math.sin(theta) * orbitRadius) % arena.height) + arena.height) % arena.height;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Computes a co-located spawn point in SECTOR-01 or COUCH-COOP so players
 * spawn safely near existing human players or in a safe orbit around the Sun.
 */
export function getColocatedSpawnPoint(
  players: Iterable<PlayerState>,
  excludeId?: string,
  roomId: string = 'SECTOR-01'
): { x: number; y: number } {
  const arena = getRoomArenaConfig(roomId);
  if (arena.fixedCamera) {
    return getSafeSunOrbitPoint(roomId);
  }

  for (const p of players) {
    if (p.alive && !p.isDrone && p.id !== excludeId) {
      const distFromSun = Math.hypot(p.x - arena.starX, p.y - arena.starY);
      if (distFromSun > 1950) {
        const angleOffset = Math.random() * Math.PI * 2;
        const dist = 160 + Math.random() * 140;
        const x =
          (((p.x + Math.cos(angleOffset) * dist) % arena.width) + arena.width) % arena.width;
        const y =
          (((p.y + Math.sin(angleOffset) * dist) % arena.height) + arena.height) % arena.height;
        if (Math.hypot(x - arena.starX, y - arena.starY) > 1800) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
  }

  return getSafeSunOrbitPoint(roomId);
}

export function createInitialClientAsteroids(
  count?: number,
  randomize: boolean = false,
  roomId: string = 'SECTOR-01'
): AsteroidState[] {
  const arena = getRoomArenaConfig(roomId);
  const targetCount = count ?? (arena.fixedCamera ? arena.maxAsteroids : 192);
  const list: AsteroidState[] = [];
  for (let i = 0; i < targetCount; i++) {
    const theta = randomize
      ? Math.random() * Math.PI * 2
      : (i / Math.max(1, targetCount)) * Math.PI * 2 + (i % 5) * 0.37;
    const dist = arena.fixedCamera
      ? randomize
        ? 180 + Math.random() * 520
        : 180 + ((i * 97) % 520)
      : randomize
      ? 1800 + Math.random() * 6400
      : 1800 + ((i * 571) % 6400);
    const x = (((arena.starX + Math.cos(theta) * dist) % arena.width) + arena.width) % arena.width;
    const y =
      (((arena.starY + Math.sin(theta) * dist) % arena.height) + arena.height) % arena.height;
    const radius = arena.fixedCamera
      ? randomize
        ? Math.round(18 + Math.random() * 18)
        : 18 + ((i * 7) % 18)
      : randomize
      ? Math.round(24 + Math.random() * 34)
      : 24 + ((i * 19) % 34);
    const speed = randomize ? 35 + Math.random() * 75 : 40 + ((i * 23) % 65);
    const moveAngle = randomize ? Math.random() * Math.PI * 2 : theta + Math.PI * 0.5;
    const vertices: number[] = [];
    for (let v = 0; v < 10; v++) {
      vertices.push(0.8 + (((i + v) * 13) % 35) * 0.01);
    }
    const maxHp = Math.round(radius * 2.2);
    list.push({
      id: `ast_init_${i}`,
      x: Math.round(x),
      y: Math.round(y),
      vx: Math.cos(moveAngle) * speed,
      vy: Math.sin(moveAngle) * speed,
      radius,
      angle: (i * 0.7) % (Math.PI * 2),
      vAngle: (i % 2 === 0 ? 1 : -1) * 0.45,
      hp: maxHp,
      maxHp,
      vertices,
    });
  }
  return list;
}

const SQUAD_CALLSIGNS = [
  'ALPHA',
  'BRAVO',
  'DELTA',
  'OMEGA',
  'VANGUARD',
  'NOVA',
  'SHADOW',
  'CRIMSON',
  'TITAN',
  'APEX',
  'VIPER',
  'PHANTOM',
];

function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSafeSectorCoords(rng: () => number, roomId: string = 'SECTOR-01'): { x: number; y: number } {
  const arena = getRoomArenaConfig(roomId);
  const minSunClearance = arena.fixedCamera ? arena.starRadius + 130 : 1750;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = rng() * arena.width;
    const y = rng() * arena.height;
    if (Math.hypot(x - arena.starX, y - arena.starY) > minSunClearance) {
      return { x: Math.round(x), y: Math.round(y) };
    }
  }
  const theta = rng() * Math.PI * 2;
  const orbitRadius = arena.fixedCamera ? 220 + rng() * 220 : 2200 + rng() * 1600;
  return {
    x: Math.round((((arena.starX + Math.cos(theta) * orbitRadius) % arena.width) + arena.width) % arena.width),
    y: Math.round((((arena.starY + Math.sin(theta) * orbitRadius) % arena.height) + arena.height) % arena.height),
  };
}

export function createTargetDronesFromBatchSpec(
  spec: DroneBatchSpec,
  roomIdOverride?: string
): PlayerState[] {
  const roomId = roomIdOverride || spec.roomId || 'SECTOR-01';
  const arena = getRoomArenaConfig(roomId);
  const rng = createSeededRng(spec.seed);
  const spawned: PlayerState[] = [];
  let droneNum = spec.startNum;
  const hasRef = typeof spec.refX === 'number' && typeof spec.refY === 'number';
  const refX = spec.refX ?? arena.starX;
  const refY = spec.refY ?? arena.starY;

  let currentSquadId: string | null = null;
  let currentSquadColor: string = PLAYER_COLORS[0];
  let currentSquadAnchor = seededSafeSectorCoords(rng, roomId);
  let currentSquadHeading = rng() * Math.PI * 2;
  let squadRemaining = 0;
  let squadIndex = Math.floor(rng() * SQUAD_CALLSIGNS.length);

  for (let i = 0; i < spec.count; i++) {
    droneNum++;
    const droneId = `drn_${spec.seed.toString(36)}_${i}`;
    const hull = HULL_LIST[(spec.startNum + i) % HULL_LIST.length];
    const hullSpec = HULL_SPECS[hull];

    let spawnX: number;
    let spawnY: number;
    let initAngle: number;
    let initSpeed: number;
    let squadId: string | null = null;
    let color = PLAYER_COLORS[(spec.startNum + i) % PLAYER_COLORS.length];

    if (arena.fixedCamera) {
      const pt = seededSafeSectorCoords(rng, roomId);
      spawnX = pt.x;
      spawnY = pt.y;
      initAngle = rng() * Math.PI * 2;
      initSpeed = 190 + rng() * 140;
    } else if (spec.count === 1 && hasRef) {
      const theta = rng() * Math.PI * 2;
      const dist = 360 + rng() * 320;
      spawnX = (((refX + Math.cos(theta) * dist) % arena.width) + arena.width) % arena.width;
      spawnY = (((refY + Math.sin(theta) * dist) % arena.height) + arena.height) % arena.height;
      initAngle = Math.atan2(refY - spawnY, refX - spawnX);
      initSpeed = 240 + rng() * 140;
    } else if (squadRemaining > 0 && currentSquadId) {
      squadId = currentSquadId;
      color = currentSquadColor;
      const wingAngle = rng() * Math.PI * 2;
      const wingDist = 150 + rng() * 190;
      spawnX = (((currentSquadAnchor.x + Math.cos(wingAngle) * wingAngleDist(wingDist)) % arena.width) + arena.width) % arena.width;
      spawnY = (((currentSquadAnchor.y + Math.sin(wingAngle) * wingAngleDist(wingDist)) % arena.height) + arena.height) % arena.height;
      initAngle = currentSquadHeading + (rng() - 0.5) * 0.35;
      initSpeed = 250 + rng() * 130;
      squadRemaining--;
    } else if (rng() < 0.52 && spec.count - i >= 2) {
      const callsign = SQUAD_CALLSIGNS[squadIndex % SQUAD_CALLSIGNS.length];
      squadIndex++;
      currentSquadId = `${callsign}-${Math.floor(10 + rng() * 89)}`;
      currentSquadColor = PLAYER_COLORS[squadIndex % PLAYER_COLORS.length];
      currentSquadAnchor =
        i < 6 && hasRef
          ? {
              x: (((refX + (rng() - 0.5) * 2600) % arena.width) + arena.width) % arena.width,
              y: (((refY + (rng() - 0.5) * 2200) % arena.height) + arena.height) % arena.height,
            }
          : seededSafeSectorCoords(rng, roomId);
      currentSquadHeading = rng() * Math.PI * 2;
      squadRemaining = rng() < 0.45 ? 2 : 1;
      squadId = currentSquadId;
      color = currentSquadColor;
      spawnX = currentSquadAnchor.x;
      spawnY = currentSquadAnchor.y;
      initAngle = currentSquadHeading;
      initSpeed = 260 + rng() * 130;
    } else {
      const pt =
        i < 8 && hasRef
          ? {
              x: (((refX + (rng() - 0.5) * 3200) % arena.width) + arena.width) % arena.width,
              y: (((refY + (rng() - 0.5) * 2600) % arena.height) + arena.height) % arena.height,
            }
          : seededSafeSectorCoords(rng, roomId);
      spawnX = pt.x;
      spawnY = pt.y;
      initAngle = rng() * Math.PI * 2;
      initSpeed = 240 + rng() * 180;
    }

    spawned.push({
      id: droneId,
      name: `TARGET-${droneNum}`,
      color,
      hull,
      x: Math.round(spawnX),
      y: Math.round(spawnY),
      vx: Math.round(Math.cos(initAngle) * initSpeed),
      vy: Math.round(Math.sin(initAngle) * initSpeed),
      angle: Number(initAngle.toFixed(3)),
      thrusting: true,
      shooting: false,
      hp: hullSpec.maxHp,
      maxHp: hullSpec.maxHp,
      score: 0,
      kills: 0,
      deaths: 0,
      streak: 0,
      peakSpeed: Math.round(initSpeed),
      alive: true,
      respawnTimer: 0,
      invulnerableTimer: 0.4,
      lastFireTime: 0,
      inputSource: 'keyboard',
      isDrone: true,
      squadId,
    });
  }

  return spawned;
}

export function createDroneBatchSpec(
  existingPlayers: Map<string, PlayerState>,
  countToSpawn: number,
  referencePlayer?: PlayerState | null,
  roomId: string = 'SECTOR-01'
): DroneBatchSpec {
  let startNum = 0;
  for (const p of existingPlayers.values()) {
    if (p.isDrone) startNum++;
  }
  const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  return {
    seed,
    count: countToSpawn,
    startNum,
    refX: referencePlayer ? Math.round(referencePlayer.x) : undefined,
    refY: referencePlayer ? Math.round(referencePlayer.y) : undefined,
    roomId,
  };
}

export function createTargetDronesBatch(
  existingPlayers: Map<string, PlayerState>,
  countToSpawn: number,
  referencePlayer?: PlayerState | null,
  roomId: string = 'SECTOR-01'
): PlayerState[] {
  const spec = createDroneBatchSpec(existingPlayers, countToSpawn, referencePlayer, roomId);
  return createTargetDronesFromBatchSpec(spec, roomId);
}

function wingAngleDist(d: number): number {
  return d;
}

export function mergeSmoothRemotePlayerState(
  existing: PlayerState | undefined,
  incoming: PlayerState,
  preserveLocalDamage: boolean = false,
  roomId: string = 'SECTOR-01'
): PlayerState {
  const arena = getRoomArenaConfig(roomId);
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (!existing) {
    return {
      ...incoming,
      netTargetX: incoming.x,
      netTargetY: incoming.y,
      netTargetVx: incoming.vx,
      netTargetVy: incoming.vy,
      netTargetAngle: incoming.angle,
      netTargetCursorX: incoming.cursorX,
      netTargetCursorY: incoming.cursorY,
      netUpdatedAt: nowPerf,
    };
  }

  let dx = incoming.x - existing.x;
  if (dx > arena.width * 0.5) dx -= arena.width;
  if (dx < -arena.width * 0.5) dx += arena.width;
  let dy = incoming.y - existing.y;
  if (dy > arena.height * 0.5) dy -= arena.height;
  if (dy < -arena.height * 0.5) dy += arena.height;
  const dist = Math.hypot(dx, dy);

  // Hard-snap if the ship just respawned, died, exited Warp Speed to a zero-momentum stop, landed on a planet, or warped across the arena
  const justStoppedWarp = Boolean(existing.warping && !incoming.warping);
  const justLanded = Boolean(!existing.landedPlanetId && incoming.landedPlanetId);
  const snapThreshold = arena.fixedCamera ? 720 : 2200;
  const shouldSnap =
    !existing.alive || !incoming.alive || justStoppedWarp || justLanded || dist > snapThreshold;

  let cursorShouldSnap =
    typeof existing.cursorX !== 'number' || typeof existing.cursorY !== 'number';
  if (
    !cursorShouldSnap &&
    typeof incoming.cursorX === 'number' &&
    typeof incoming.cursorY === 'number'
  ) {
    let cdx = incoming.cursorX - existing.cursorX!;
    if (cdx > arena.width * 0.5) cdx -= arena.width;
    if (cdx < -arena.width * 0.5) cdx += arena.width;
    let cdy = incoming.cursorY - existing.cursorY!;
    if (cdy > arena.height * 0.5) cdy -= arena.height;
    if (cdy < -arena.height * 0.5) cdy += arena.height;
    if (Math.hypot(cdx, cdy) > (arena.fixedCamera ? 800 : 2600)) {
      cursorShouldSnap = true;
    }
  }

  return {
    ...incoming,
    // Keep visual position, velocity, heading & cursor smooth; store incoming values in netTarget*
    x: shouldSnap ? incoming.x : existing.x,
    y: shouldSnap ? incoming.y : existing.y,
    vx: shouldSnap ? incoming.vx : existing.vx,
    vy: shouldSnap ? incoming.vy : existing.vy,
    angle: shouldSnap ? incoming.angle : existing.angle,
    cursorX: cursorShouldSnap ? incoming.cursorX : existing.cursorX,
    cursorY: cursorShouldSnap ? incoming.cursorY : existing.cursorY,
    netTargetX: incoming.x,
    netTargetY: incoming.y,
    netTargetVx: incoming.vx,
    netTargetVy: incoming.vy,
    netTargetAngle: incoming.angle,
    netTargetCursorX: incoming.cursorX,
    netTargetCursorY: incoming.cursorY,
    netUpdatedAt: nowPerf,
    hp: preserveLocalDamage ? Math.min(existing.hp, incoming.hp) : incoming.hp,
    alive: preserveLocalDamage ? (existing.alive ? incoming.alive : false) : incoming.alive,
    deaths: preserveLocalDamage ? Math.max(existing.deaths, incoming.deaths) : incoming.deaths,
    respawnTimer:
      preserveLocalDamage && !existing.alive ? existing.respawnTimer : incoming.respawnTimer,
    lastFireTime: Math.max(existing.lastFireTime || 0, incoming.lastFireTime || 0),
  };
}

function compactPlayerForWire(p: PlayerState): Partial<PlayerState> {
  const hasActiveCheats =
    p.cheats &&
    (p.cheats.homingMissiles ||
      p.cheats.rapidFire ||
      p.cheats.novaSpread ||
      p.cheats.godMode ||
      p.cheats.freeCam);

  const out: Partial<PlayerState> = {
    id: p.id,
    name: p.name,
    color: p.color,
    hull: p.hull,
    x: Math.round(p.x),
    y: Math.round(p.y),
    vx: Math.round(p.vx),
    vy: Math.round(p.vy),
    angle: Number(p.angle.toFixed(2)),
    thrusting: p.thrusting,
    shooting: p.shooting,
    hp: Math.round(p.hp),
    maxHp: p.maxHp,
    score: p.score,
    kills: p.kills,
    deaths: p.deaths,
    streak: p.streak,
    peakSpeed: Math.round(p.peakSpeed),
    alive: p.alive,
  };

  if (hasActiveCheats) out.cheats = p.cheats;
  if (p.spectating) {
    out.spectating = true;
    if (p.spectateTargetId) out.spectateTargetId = p.spectateTargetId;
    if (typeof p.cursorX === 'number') out.cursorX = Math.round(p.cursorX);
    if (typeof p.cursorY === 'number') out.cursorY = Math.round(p.cursorY);
  }
  if (p.music && p.music.isPlaying) {
    out.music = {
      filename: p.music.filename,
      title: p.music.title,
      isPlaying: true,
      trackTime: Number(p.music.trackTime.toFixed(2)),
      updatedAt: p.music.updatedAt,
      volume: Number(p.music.volume.toFixed(2)),
      loopTrack: p.music.loopTrack,
    };
  }
  if (p.deathSound) out.deathSound = p.deathSound;
  if (p.shipPng) out.shipPng = p.shipPng;
  if (p.warping) out.warping = true;
  if (p.landedPlanetId) {
    out.landedPlanetId = p.landedPlanetId;
    if (typeof p.landedSurfaceAngle === 'number') {
      out.landedSurfaceAngle = Number(p.landedSurfaceAngle.toFixed(3));
    }
  }
  return out;
}

function hydratePlayerFromWire(raw: Partial<PlayerState>, roomId: string = 'SECTOR-01'): PlayerState {
  const arena = getRoomArenaConfig(roomId);
  const hull = raw.hull && HULL_SPECS[raw.hull] ? raw.hull : 'needle';
  const maxHp = raw.maxHp ?? HULL_SPECS[hull].maxHp;
  return {
    id: raw.id || 'plr_unknown',
    name: raw.name || 'PILOT',
    color: raw.color || PLAYER_COLORS[0],
    hull,
    x: Number(raw.x) || arena.starX,
    y: Number(raw.y) || arena.starY,
    vx: Number(raw.vx) || 0,
    vy: Number(raw.vy) || 0,
    angle: Number(raw.angle) || 0,
    thrusting: Boolean(raw.thrusting),
    shooting: Boolean(raw.shooting),
    hp: typeof raw.hp === 'number' ? raw.hp : maxHp,
    maxHp,
    score: raw.score || 0,
    kills: raw.kills || 0,
    deaths: raw.deaths || 0,
    streak: raw.streak || 0,
    peakSpeed: raw.peakSpeed || 0,
    alive: raw.alive !== false,
    respawnTimer: raw.respawnTimer || 0,
    invulnerableTimer: raw.invulnerableTimer || 0,
    lastFireTime: 0,
    inputSource: raw.inputSource || 'keyboard',
    cheats: raw.cheats,
    isDrone: Boolean(raw.isDrone),
    squadId: raw.squadId ?? null,
    spectating: Boolean(raw.spectating),
    spectateTargetId: raw.spectateTargetId ?? null,
    cursorX: raw.cursorX,
    cursorY: raw.cursorY,
    music: raw.music ?? null,
    deathSound: raw.deathSound,
    shipPng: raw.shipPng ?? null,
    warping: Boolean(raw.warping),
    landedPlanetId: raw.landedPlanetId ?? null,
    landedSurfaceAngle: raw.landedSurfaceAngle,
  };
}

function compactEventForWire(packet: PeerSyncPacket): PeerSyncPacket {
  if (packet.type === 'peer:salvo') {
    const s = packet.salvo;
    return {
      type: 'peer:salvo',
      senderId: packet.senderId,
      roomId: packet.roomId,
      salvo: {
        ...s,
        x: Math.round(s.x),
        y: Math.round(s.y),
        vx: Math.round(s.vx),
        vy: Math.round(s.vy),
        angle: Number(s.angle.toFixed(3)),
        spreadAngle: Number(s.spreadAngle.toFixed(3)),
        targetIds: s.targetIds.length > 10 ? s.targetIds.slice(0, 10) : s.targetIds,
      },
    };
  }
  if (packet.type === 'peer:cheat_action' && packet.droneBatch) {
    // Strip the 100-item spawnedDrones array from cloud HTTP packets; only send the 60-byte deterministic droneBatch seed!
    return {
      type: 'peer:cheat_action',
      senderId: packet.senderId,
      roomId: packet.roomId,
      playerId: packet.playerId,
      action: packet.action,
      droneBatch: packet.droneBatch,
    };
  }
  return packet;
}

/**
 * Provides automatic multi-window & serverless multiplayer synchronization when deployed
 * to static/serverless hosts like Vercel where the persistent `/ws` server is not running.
 */
export class PeerSectorSync {
  private channel: BroadcastChannel | null = null;
  private selfId: string;
  private roomId: string = 'SECTOR-01';
  private peerLastSeen = new Map<string, number>();
  private onPacket: (packet: PeerSyncPacket) => void;
  private pollTimer: number | null = null;
  private pendingCloudEvents: PeerSyncPacket[] = [];
  private lastCloudSeq = 0;
  private seenSalvos = new Set<string>();
  private seenHits = new Set<string>();
  private seenChats = new Set<string>();
  private seenBatches = new Set<number>();
  private isPolling = false;
  private lastPollTime = 0;
  private lastCloudSalvoSentAt = 0;
  private focusedPeerId: string | null = null;
  private focusListenersCleanup: (() => void) | null = null;

  constructor(selfId: string, onPacket: (packet: PeerSyncPacket) => void, initialRoomId: string = 'SECTOR-01') {
    this.selfId = selfId;
    this.roomId = initialRoomId;
    this.onPacket = onPacket;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('vector_spacewar_sector_01_sync');
        this.channel.onmessage = (ev) => {
          const pkt = ev.data as PeerSyncPacket;
          this.handleIncomingPacket(pkt);
        };
      } catch {
        // Ignore if BroadcastChannel is blocked
      }
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.hasFocus()) {
        this.focusedPeerId = this.selfId;
      }
      const onFocus = () => {
        this.focusedPeerId = this.selfId;
        this.broadcastFocus(true);
      };
      const onBlur = () => {
        this.broadcastFocus(false);
      };
      const onVis = () => {
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          this.focusedPeerId = this.selfId;
          this.broadcastFocus(true);
        } else if (document.visibilityState === 'hidden') {
          this.broadcastFocus(false);
        }
      };
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVis);
      this.focusListenersCleanup = () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVis);
      };
    }
  }

  public setRoomId(roomId: string) {
    const clean = roomId === 'COUCH-COOP' ? 'COUCH-COOP' : 'SECTOR-01';
    if (this.roomId !== clean) {
      this.roomId = clean;
      this.peerLastSeen.clear();
      this.pendingCloudEvents = [];
      this.lastCloudSeq = 0;
      this.seenBatches.clear();
    }
  }

  public getRoomId(): string {
    return this.roomId;
  }

  private broadcastFocus(focused: boolean) {
    if (!this.channel) return;
    try {
      this.channel.postMessage({
        type: 'peer:focus',
        senderId: this.selfId,
        roomId: this.roomId,
        focused,
      } satisfies PeerSyncPacket);
    } catch {
      // Ignore
    }
  }

  /**
   * Returns true if another local browser tab/window on the same computer currently has focus,
   * so this background tab yields its flat cockpit audio and lets the focused tab render spatial proximity audio.
   */
  public isAnotherLocalTabFocused(): boolean {
    return Boolean(this.focusedPeerId && this.focusedPeerId !== this.selfId);
  }

  private handleIncomingPacket(pkt: PeerSyncPacket) {
    if (!pkt || pkt.senderId === this.selfId) return;

    if (pkt.type === 'peer:focus') {
      if (pkt.focused) {
        this.focusedPeerId = pkt.senderId;
      } else if (this.focusedPeerId === pkt.senderId) {
        this.focusedPeerId = typeof document !== 'undefined' && document.hasFocus() ? this.selfId : null;
      }
      return;
    }

    const pktRoom = pkt.roomId || 'SECTOR-01';
    if (pktRoom !== this.roomId) return;

    this.peerLastSeen.set(pkt.senderId, Date.now());
    if (pkt.type === 'peer:player_state' && pkt.player2?.id) {
      this.peerLastSeen.set(pkt.player2.id, Date.now());
    }

    if (pkt.type === 'peer:salvo') {
      if (this.seenSalvos.has(pkt.salvo.idPrefix)) return;
      this.seenSalvos.add(pkt.salvo.idPrefix);
      if (this.seenSalvos.size > 600) {
        const first = this.seenSalvos.values().next().value;
        if (first) this.seenSalvos.delete(first);
      }
    } else if (pkt.type === 'peer:combat_hit' && pkt.hitId) {
      if (this.seenHits.has(pkt.hitId)) return;
      this.seenHits.add(pkt.hitId);
      if (this.seenHits.size > 600) {
        const first = this.seenHits.values().next().value;
        if (first) this.seenHits.delete(first);
      }
    } else if (pkt.type === 'peer:chat' && pkt.message?.id) {
      if (this.seenChats.has(pkt.message.id)) return;
      this.seenChats.add(pkt.message.id);
      if (this.seenChats.size > 300) {
        const first = this.seenChats.values().next().value;
        if (first) this.seenChats.delete(first);
      }
    } else if (pkt.type === 'peer:cheat_action' && pkt.droneBatch) {
      if (this.seenBatches.has(pkt.droneBatch.seed)) return;
      this.seenBatches.add(pkt.droneBatch.seed);
      if (!pkt.spawnedDrones) {
        pkt = {
          ...pkt,
          spawnedDrones: createTargetDronesFromBatchSpec(pkt.droneBatch, this.roomId),
        };
      }
    }

    this.onPacket(pkt);
  }

  public hasSeenHit(hitId: string): boolean {
    return this.seenHits.has(hitId);
  }

  public markHitSeen(hitId: string) {
    this.seenHits.add(hitId);
    if (this.seenHits.size > 600) {
      const first = this.seenHits.values().next().value;
      if (first) this.seenHits.delete(first);
    }
  }

  public announceJoin(localPlayer?: PlayerState, localPlayer2?: PlayerState) {
    this.send({
      type: 'peer:hello',
      senderId: this.selfId,
      roomId: this.roomId,
      player: localPlayer,
      player2: localPlayer2,
    });
  }

  public send(packet: PeerSyncPacket) {
    const taggedPacket: PeerSyncPacket = {
      ...packet,
      roomId: packet.roomId || this.roomId,
    };

    if (taggedPacket.type === 'peer:salvo') {
      this.seenSalvos.add(taggedPacket.salvo.idPrefix);
    } else if (taggedPacket.type === 'peer:combat_hit' && taggedPacket.hitId) {
      this.seenHits.add(taggedPacket.hitId);
    } else if (taggedPacket.type === 'peer:chat' && taggedPacket.message?.id) {
      this.seenChats.add(taggedPacket.message.id);
    } else if (taggedPacket.type === 'peer:cheat_action' && taggedPacket.droneBatch) {
      this.seenBatches.add(taggedPacket.droneBatch.seed);
    }

    if (this.channel) {
      try {
        this.channel.postMessage(taggedPacket);
      } catch {
        // Ignore channel errors
      }
    }

    // Queue discrete gameplay events for the /api/sector cloud relay (with compact wire representation)
    if (
      taggedPacket.type === 'peer:salvo' ||
      taggedPacket.type === 'peer:combat_hit' ||
      taggedPacket.type === 'peer:cheat_action' ||
      taggedPacket.type === 'peer:rename' ||
      taggedPacket.type === 'peer:cheat_rename' ||
      taggedPacket.type === 'peer:player_leave' ||
      taggedPacket.type === 'peer:chat'
    ) {
      // Avoid flooding Vercel with redundant rapid-fire salvo packets; remote clients already synthesize continuous fire while p.shooting is true
      if (taggedPacket.type === 'peer:salvo') {
        const now = Date.now();
        if (now - this.lastCloudSalvoSentAt < 140) {
          return;
        }
        this.lastCloudSalvoSentAt = now;
      }
      // Do not send AI-vs-AI or player-vs-AI drone hits over Vercel relay if no other human peers exist
      if (
        taggedPacket.type === 'peer:combat_hit' &&
        this.peerLastSeen.size === 0 &&
        taggedPacket.targetId.startsWith('drn_')
      ) {
        return;
      }

      this.pendingCloudEvents.push(compactEventForWire(taggedPacket));
      if (this.pendingCloudEvents.length > 40) {
        this.pendingCloudEvents.shift();
      }
    }
  }

  public pruneStalePeers(players: Map<string, PlayerState>, localPlayer2Id?: string) {
    const now = Date.now();
    for (const [peerId, lastTime] of this.peerLastSeen.entries()) {
      if (now - lastTime > 5000) {
        this.peerLastSeen.delete(peerId);
        const stale = players.get(peerId);
        if (stale && !stale.isDrone && peerId !== this.selfId && peerId !== localPlayer2Id) {
          players.delete(peerId);
        }
      }
    }
    for (const [pid, p] of players.entries()) {
      if (pid !== this.selfId && pid !== localPlayer2Id && !p.isDrone && !this.peerLastSeen.has(pid)) {
        this.peerLastSeen.set(pid, now);
      }
    }
  }

  /**
   * Deterministic leader election among open browser windows:
   * The lowest lexicographical ID among active human peers steps shared drones.
   */
  public isLeader(players: Map<string, PlayerState>, localPlayer2Id?: string): boolean {
    this.pruneStalePeers(players, localPlayer2Id);

    const humanIds: string[] = [this.selfId];
    for (const p of players.values()) {
      if (!p.isDrone && p.id !== this.selfId && p.id !== localPlayer2Id) {
        humanIds.push(p.id);
      }
    }
    humanIds.sort();
    return humanIds[0] === this.selfId;
  }

  public startCloudRelayPoll(
    isWsConnected: () => boolean,
    getLocalPlayer: () => PlayerState | undefined,
    onServerTime?: (serverTime: number) => void,
    getLocalPlayer2?: () => PlayerState | undefined
  ) {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(async () => {
      if (isWsConnected() || this.isPolling) return;

      const now = Date.now();
      const hasOtherHumans = this.peerLastSeen.size > 0;
      const hasPendingEvents = this.pendingCloudEvents.length > 0;
      const isHidden = typeof document !== 'undefined' && document.hidden;

      // Adaptive poll interval to drastically reduce Vercel Hobby Plan bandwidth & function invocations:
      // - 135ms when other human players are in the sector or discrete events are queued
      // - 600ms when flying solo (waiting to discover if another human joins)
      // - 1400ms when the browser tab is in the background
      const minInterval = hasPendingEvents
        ? 90
        : isHidden
        ? 1400
        : hasOtherHumans
        ? 135
        : 600;

      if (now - this.lastPollTime < minInterval) return;

      const localPlayer = getLocalPlayer();
      const localPlayer2 = getLocalPlayer2 ? getLocalPlayer2() : undefined;
      const eventsToSend = this.pendingCloudEvents.splice(0, this.pendingCloudEvents.length);
      if (!localPlayer && !localPlayer2 && eventsToSend.length === 0) return;

      this.isPolling = true;
      this.lastPollTime = now;
      const activeRoomId = this.roomId;
      try {
        const payload: Record<string, unknown> = {
          id: this.selfId,
          r: activeRoomId,
          q: this.lastCloudSeq,
        };
        if (localPlayer) {
          payload.p = compactPlayerForWire(localPlayer);
        }
        if (localPlayer2) {
          payload.p2 = compactPlayerForWire(localPlayer2);
        }
        if (eventsToSend.length > 0) {
          payload.e = eventsToSend;
        }

        const res = await fetch('/api/sector', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok && activeRoomId === this.roomId) {
          const data = (await res.json()) as {
            q?: number;
            latestSeq?: number;
            s?: number;
            serverTime?: number;
            p?: Partial<PlayerState>[];
            players?: Partial<PlayerState>[];
            b?: DroneBatchSpec[];
            d?: string[];
            e?: PeerSyncPacket[];
            events?: PeerSyncPacket[];
          };
          const srvTime = data.s ?? data.serverTime;
          if (typeof srvTime === 'number' && onServerTime) {
            onServerTime(srvTime);
          }
          const latestSeq = data.q ?? data.latestSeq;
          if (typeof latestSeq === 'number' && latestSeq > this.lastCloudSeq) {
            this.lastCloudSeq = latestSeq;
          }
          const remotePlayers = data.p ?? data.players;
          const localP2Id = localPlayer2?.id;
          if (Array.isArray(remotePlayers)) {
            for (const rawRemote of remotePlayers) {
              if (
                rawRemote &&
                rawRemote.id &&
                rawRemote.id !== this.selfId &&
                rawRemote.id !== localP2Id
              ) {
                const remote = hydratePlayerFromWire(rawRemote, activeRoomId);
                this.peerLastSeen.set(remote.id, Date.now());
                this.onPacket({
                  type: 'peer:player_state',
                  senderId: remote.id,
                  roomId: activeRoomId,
                  player: remote,
                });
              }
            }
          }
          if (Array.isArray(data.b) && data.b.length > 0) {
            const deadSet = new Set(Array.isArray(data.d) ? data.d : []);
            for (const batch of data.b) {
              if (batch && typeof batch.seed === 'number' && !this.seenBatches.has(batch.seed)) {
                this.seenBatches.add(batch.seed);
                const drones = createTargetDronesFromBatchSpec(batch, activeRoomId).filter(
                  (dr) => !deadSet.has(dr.id)
                );
                if (drones.length > 0) {
                  this.onPacket({
                    type: 'peer:cheat_action',
                    senderId: 'relay',
                    roomId: activeRoomId,
                    playerId: 'relay',
                    action: batch.count > 1 ? 'spawn_drones_100' : 'spawn_drone',
                    droneBatch: batch,
                    spawnedDrones: drones,
                  });
                }
              }
            }
          }
          const incomingEvents = data.e ?? data.events;
          if (Array.isArray(incomingEvents)) {
            for (const pkt of incomingEvents) {
              this.handleIncomingPacket({ ...pkt, roomId: pkt.roomId || activeRoomId });
            }
          }
        }
      } catch {
        // Ignore if /api/sector is unavailable
      } finally {
        this.isPolling = false;
      }
    }, 65);
  }

  public destroy(localPlayerId: string, localPlayer2Id?: string) {
    if (this.focusListenersCleanup) {
      this.focusListenersCleanup();
      this.focusListenersCleanup = null;
    }
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.send({
      type: 'peer:player_leave',
      senderId: this.selfId,
      roomId: this.roomId,
      playerId: localPlayerId,
    });
    if (localPlayer2Id) {
      this.send({
        type: 'peer:player_leave',
        senderId: this.selfId,
        roomId: this.roomId,
        playerId: localPlayer2Id,
      });
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}

