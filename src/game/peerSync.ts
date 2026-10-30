import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
  ChatMessage,
  CheatActionType,
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

export type PeerSyncPacket =
  | {
      type: 'peer:hello';
      senderId: string;
      player?: PlayerState;
    }
  | {
      type: 'peer:welcome';
      senderId: string;
      players: PlayerState[];
      asteroids: AsteroidState[];
      planets: PlanetState[];
      killFeed: KillFeedEntry[];
      gravityStarEnabled: boolean;
    }
  | {
      type: 'peer:player_state';
      senderId: string;
      player: PlayerState;
      drones?: PlayerState[];
      asteroids?: AsteroidState[];
    }
  | {
      type: 'peer:player_leave';
      senderId: string;
      playerId: string;
    }
  | {
      type: 'peer:salvo';
      senderId: string;
      salvo: SalvoSpawnPayload;
    }
  | {
      type: 'peer:cheat_action';
      senderId: string;
      playerId: string;
      action: CheatActionType;
      spawnedDrones?: PlayerState[];
    }
  | {
      type: 'peer:rename';
      senderId: string;
      playerId: string;
      newName: string;
    }
  | {
      type: 'peer:cheat_rename';
      senderId: string;
      requesterId: string;
      targetId: string | 'ALL_OTHERS';
      newName: string;
    }
  | {
      type: 'peer:combat_hit';
      senderId: string;
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
      message: ChatMessage;
    };

export function getSafeSunOrbitPoint(): { x: number; y: number } {
  const theta = Math.random() * Math.PI * 2;
  const orbitRadius = 2200 + Math.random() * 1600; // Well outside the 440-radius Sun
  const x = (((GRAVITY_STAR_X + Math.cos(theta) * orbitRadius) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
  const y = (((GRAVITY_STAR_Y + Math.sin(theta) * orbitRadius) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Computes a co-located spawn point in SECTOR-01 so players opening multiple windows
 * spawn near existing human players (if that player is safely outside the Sun),
 * or in a safe orbit around the Sun.
 */
export function getColocatedSpawnPoint(
  players: Iterable<PlayerState>,
  excludeId?: string
): { x: number; y: number } {
  for (const p of players) {
    if (p.alive && !p.isDrone && p.id !== excludeId) {
      const distFromSun = Math.hypot(p.x - GRAVITY_STAR_X, p.y - GRAVITY_STAR_Y);
      if (distFromSun > 1950) {
        const angleOffset = Math.random() * Math.PI * 2;
        const dist = 160 + Math.random() * 140;
        const x = (((p.x + Math.cos(angleOffset) * dist) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
        const y = (((p.y + Math.sin(angleOffset) * dist) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
        if (Math.hypot(x - GRAVITY_STAR_X, y - GRAVITY_STAR_Y) > 1800) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
  }

  return getSafeSunOrbitPoint();
}

export function createInitialClientAsteroids(count: number = 24): AsteroidState[] {
  const list: AsteroidState[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2 + (i % 3) * 0.4;
    const dist = 2000 + ((i * 571) % 6200);
    const x = (((GRAVITY_STAR_X + Math.cos(theta) * dist) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
    const y = (((GRAVITY_STAR_Y + Math.sin(theta) * dist) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
    const radius = 40 + ((i * 19) % 48);
    const speed = 40 + ((i * 23) % 65);
    const moveAngle = theta + Math.PI * 0.5;
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

export function createTargetDronesBatch(
  existingPlayers: Map<string, PlayerState>,
  countToSpawn: number,
  referencePlayer?: PlayerState | null
): PlayerState[] {
  const spawned: PlayerState[] = [];
  let droneNum = Array.from(existingPlayers.values()).filter((p) => p.isDrone).length;

  for (let i = 0; i < countToSpawn; i++) {
    droneNum++;
    const droneId = `drone_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    const hull = HULL_LIST[(existingPlayers.size + i) % HULL_LIST.length];
    const spec = HULL_SPECS[hull];
    const color = PLAYER_COLORS[(existingPlayers.size + i) % PLAYER_COLORS.length];

    let spawnX: number;
    let spawnY: number;
    let initAngle: number;
    let initSpeed: number;

    if (countToSpawn === 1 && referencePlayer) {
      // Spawn single target ship near the player so it is immediately visible
      const theta = Math.random() * Math.PI * 2;
      const dist = 260 + Math.random() * 240;
      spawnX = (((referencePlayer.x + Math.cos(theta) * dist) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
      spawnY = (((referencePlayer.y + Math.sin(theta) * dist) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
      initAngle = theta + Math.PI * 0.5;
      initSpeed = 240 + Math.random() * 140;
    } else {
      const frac = (i + 0.5) / countToSpawn;
      const orbitRadius = 1400 + Math.sqrt(frac) * 7200;
      const theta = i * 2.3999632 + Math.random() * 0.15;
      spawnX = (((GRAVITY_STAR_X + Math.cos(theta) * orbitRadius) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
      spawnY = (((GRAVITY_STAR_Y + Math.sin(theta) * orbitRadius) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
      initAngle = theta + Math.PI * 0.5;
      initSpeed = 260 + Math.random() * 180;
    }

    const drone: PlayerState = {
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
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      score: 0,
      kills: 0,
      deaths: 0,
      streak: 0,
      peakSpeed: Math.round(initSpeed),
      alive: true,
      respawnTimer: 0,
      invulnerableTimer: 0,
      lastFireTime: 0,
      inputSource: 'keyboard',
      isDrone: true,
    };
    spawned.push(drone);
  }

  return spawned;
}

export function mergeSmoothRemotePlayerState(
  existing: PlayerState | undefined,
  incoming: PlayerState,
  preserveLocalDamage: boolean = false
): PlayerState {
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
  if (dx > ARENA_WIDTH * 0.5) dx -= ARENA_WIDTH;
  if (dx < -ARENA_WIDTH * 0.5) dx += ARENA_WIDTH;
  let dy = incoming.y - existing.y;
  if (dy > ARENA_HEIGHT * 0.5) dy -= ARENA_HEIGHT;
  if (dy < -ARENA_HEIGHT * 0.5) dy += ARENA_HEIGHT;
  const dist = Math.hypot(dx, dy);

  // Hard-snap if the ship just respawned, died, exited Warp Speed to a zero-momentum stop, or warped > 2200u
  const justStoppedWarp = Boolean(existing.warping && !incoming.warping);
  const shouldSnap = !existing.alive || !incoming.alive || justStoppedWarp || dist > 2200;

  let cursorShouldSnap =
    typeof existing.cursorX !== 'number' || typeof existing.cursorY !== 'number';
  if (
    !cursorShouldSnap &&
    typeof incoming.cursorX === 'number' &&
    typeof incoming.cursorY === 'number'
  ) {
    let cdx = incoming.cursorX - existing.cursorX!;
    if (cdx > ARENA_WIDTH * 0.5) cdx -= ARENA_WIDTH;
    if (cdx < -ARENA_WIDTH * 0.5) cdx += ARENA_WIDTH;
    let cdy = incoming.cursorY - existing.cursorY!;
    if (cdy > ARENA_HEIGHT * 0.5) cdy -= ARENA_HEIGHT;
    if (cdy < -ARENA_HEIGHT * 0.5) cdy += ARENA_HEIGHT;
    if (Math.hypot(cdx, cdy) > 2600) {
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

/**
 * Provides automatic multi-window & serverless multiplayer synchronization when deployed
 * to static/serverless hosts like Vercel where the persistent `/ws` server is not running.
 */
export class PeerSectorSync {
  private channel: BroadcastChannel | null = null;
  private selfId: string;
  private peerLastSeen = new Map<string, number>();
  private onPacket: (packet: PeerSyncPacket) => void;
  private pollTimer: number | null = null;
  private pendingCloudEvents: PeerSyncPacket[] = [];
  private lastCloudSeq = 0;
  private seenSalvos = new Set<string>();
  private seenHits = new Set<string>();
  private seenChats = new Set<string>();
  private isPolling = false;

  constructor(selfId: string, onPacket: (packet: PeerSyncPacket) => void) {
    this.selfId = selfId;
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
  }

  private handleIncomingPacket(pkt: PeerSyncPacket) {
    if (!pkt || pkt.senderId === this.selfId) return;
    this.peerLastSeen.set(pkt.senderId, Date.now());

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

  public announceJoin(localPlayer?: PlayerState) {
    this.send({
      type: 'peer:hello',
      senderId: this.selfId,
      player: localPlayer,
    });
  }

  public send(packet: PeerSyncPacket) {
    if (packet.type === 'peer:salvo') {
      this.seenSalvos.add(packet.salvo.idPrefix);
    } else if (packet.type === 'peer:combat_hit' && packet.hitId) {
      this.seenHits.add(packet.hitId);
    } else if (packet.type === 'peer:chat' && packet.message?.id) {
      this.seenChats.add(packet.message.id);
    }

    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch {
        // Ignore channel errors
      }
    }

    // Queue discrete gameplay events (salvos, hits, drones, renames, leaves, chats) for the /api/sector cloud relay
    if (
      packet.type === 'peer:salvo' ||
      packet.type === 'peer:combat_hit' ||
      packet.type === 'peer:cheat_action' ||
      packet.type === 'peer:rename' ||
      packet.type === 'peer:cheat_rename' ||
      packet.type === 'peer:player_leave' ||
      packet.type === 'peer:chat'
    ) {
      this.pendingCloudEvents.push(packet);
      if (this.pendingCloudEvents.length > 80) {
        this.pendingCloudEvents.shift();
      }
    }
  }

  public pruneStalePeers(players: Map<string, PlayerState>) {
    const now = Date.now();
    for (const [peerId, lastTime] of this.peerLastSeen.entries()) {
      if (now - lastTime > 5000) {
        this.peerLastSeen.delete(peerId);
        const stale = players.get(peerId);
        if (stale && !stale.isDrone && peerId !== this.selfId) {
          players.delete(peerId);
        }
      }
    }
    for (const [pid, p] of players.entries()) {
      if (pid !== this.selfId && !p.isDrone && !this.peerLastSeen.has(pid)) {
        this.peerLastSeen.set(pid, now);
      }
    }
  }

  /**
   * Deterministic leader election among open browser windows:
   * The lowest lexicographical ID among active human peers steps shared drones.
   */
  public isLeader(players: Map<string, PlayerState>): boolean {
    this.pruneStalePeers(players);

    const humanIds: string[] = [this.selfId];
    for (const p of players.values()) {
      if (!p.isDrone && p.id !== this.selfId) {
        humanIds.push(p.id);
      }
    }
    humanIds.sort();
    return humanIds[0] === this.selfId;
  }

  public startCloudRelayPoll(
    isWsConnected: () => boolean,
    getLocalPlayer: () => PlayerState | undefined
  ) {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(async () => {
      if (isWsConnected() || this.isPolling) return;
      const localPlayer = getLocalPlayer();
      const eventsToSend = this.pendingCloudEvents.splice(0, this.pendingCloudEvents.length);
      if (!localPlayer && eventsToSend.length === 0) return;

      this.isPolling = true;
      try {
        const res = await fetch('/api/sector', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: localPlayer,
            sinceSeq: this.lastCloudSeq,
            events: eventsToSend,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            latestSeq?: number;
            players?: PlayerState[];
            events?: PeerSyncPacket[];
          };
          if (typeof data.latestSeq === 'number' && data.latestSeq > this.lastCloudSeq) {
            this.lastCloudSeq = data.latestSeq;
          }
          if (Array.isArray(data.players)) {
            for (const remote of data.players) {
              if (remote.id !== this.selfId) {
                this.peerLastSeen.set(remote.id, Date.now());
                this.onPacket({
                  type: 'peer:player_state',
                  senderId: remote.id,
                  player: remote,
                });
              }
            }
          }
          if (Array.isArray(data.events)) {
            for (const pkt of data.events) {
              this.handleIncomingPacket(pkt);
            }
          }
        }
      } catch {
        // Ignore if /api/sector is unavailable
      } finally {
        this.isPolling = false;
      }
    }, 85);
  }

  public destroy(localPlayerId: string) {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.send({
      type: 'peer:player_leave',
      senderId: this.selfId,
      playerId: localPlayerId,
    });
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
