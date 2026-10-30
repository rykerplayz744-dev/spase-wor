import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AsteroidState,
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
      targetId: string;
      attackerId: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      damage: number;
      fatal: boolean;
      color: string;
      killEntry?: KillFeedEntry;
    };

/**
 * Computes a co-located spawn point in SECTOR-01 so players opening multiple windows
 * always spawn right near existing human players (or at the shared Sector-01 Rendezvous point)
 * instead of thousands of units apart across the 10x star system.
 */
export function getColocatedSpawnPoint(
  players: Iterable<PlayerState>,
  excludeId?: string
): { x: number; y: number } {
  for (const p of players) {
    if (p.alive && !p.isDrone && p.id !== excludeId) {
      const angleOffset = Math.random() * Math.PI * 2;
      const dist = 160 + Math.random() * 140; // Right on the same screen!
      const x = (((p.x + Math.cos(angleOffset) * dist) % ARENA_WIDTH) + ARENA_WIDTH) % ARENA_WIDTH;
      const y = (((p.y + Math.sin(angleOffset) * dist) % ARENA_HEIGHT) + ARENA_HEIGHT) % ARENA_HEIGHT;
      return { x: Math.round(x), y: Math.round(y) };
    }
  }

  // Default Sector-01 Rendezvous Beacon (safe orbital zone to the right of the central Sun)
  const angleOffset = (Math.random() - 0.5) * 0.12;
  const radius = 2900 + (Math.random() - 0.5) * 180;
  return {
    x: Math.round(GRAVITY_STAR_X + Math.cos(angleOffset) * radius),
    y: Math.round(GRAVITY_STAR_Y + Math.sin(angleOffset) * radius),
  };
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
      invulnerableTimer: 0.4,
      lastFireTime: 0,
      inputSource: 'keyboard',
      isDrone: true,
    };
    spawned.push(drone);
  }

  return spawned;
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

  constructor(selfId: string, onPacket: (packet: PeerSyncPacket) => void) {
    this.selfId = selfId;
    this.onPacket = onPacket;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('vector_spacewar_sector_01_sync');
        this.channel.onmessage = (ev) => {
          const pkt = ev.data as PeerSyncPacket;
          if (!pkt || pkt.senderId === this.selfId) return;
          this.peerLastSeen.set(pkt.senderId, Date.now());
          this.onPacket(pkt);
        };
      } catch {
        // Ignore if BroadcastChannel is blocked
      }
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
    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch {
        // Ignore channel errors
      }
    }
  }

  /**
   * Deterministic leader election among open browser windows:
   * The lowest lexicographical ID among active human peers steps shared drones.
   */
  public isLeader(players: Map<string, PlayerState>): boolean {
    const now = Date.now();
    for (const [peerId, lastTime] of this.peerLastSeen.entries()) {
      if (now - lastTime > 4000) {
        this.peerLastSeen.delete(peerId);
        const stale = players.get(peerId);
        if (stale && !stale.isDrone) {
          players.delete(peerId);
        }
      }
    }

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
      if (isWsConnected()) return;
      const localPlayer = getLocalPlayer();
      if (!localPlayer) return;
      try {
        const res = await fetch('/api/sector', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: localPlayer,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { players?: PlayerState[] };
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
        }
      } catch {
        // Ignore if /api/sector is unavailable
      }
    }, 250);
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
