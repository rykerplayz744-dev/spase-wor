import { useCallback, useEffect, useRef, useState } from 'react';
import { CheatMenuModal } from './components/CheatMenuModal.tsx';
import { ControllerModal } from './components/ControllerModal.tsx';
import {
  DeathSoundModal,
  useDeathSoundController,
} from './components/DeathSoundModal.tsx';
import {
  FloatingMusicBoxWindow,
  useMusicBoxController,
} from './components/MusicBox.tsx';
import {
  ControllerMapping,
  InputManager,
  loadControllerMapping,
} from './game/input.ts';
import {
  createInitialClientAsteroids,
  createTargetDronesBatch,
  getColocatedSpawnPoint,
  getSafeSunOrbitPoint,
  mergeSmoothRemotePlayerState,
  PeerSectorSync,
} from './game/peerSync.ts';
import {
  shortestToroidalDelta,
  SpacewarRenderer,
  wrapCoord,
} from './game/renderer.ts';
import { soundEngine } from './game/sound.ts';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  arePlayersTeammates,
  AsteroidState,
  BulletState,
  ChatMessage,
  CheatActionType,
  ClientToServerMessage,
  DEFAULT_PLAYER_CHEATS,
  expandSalvoToBullets,
  GRAVITY_STAR_RADIUS,
  GRAVITY_STAR_X,
  GRAVITY_STAR_Y,
  HULL_SPECS,
  INITIAL_PLANETS,
  KillFeedEntry,
  parseChatInput,
  PLAYER_COLORS,
  PlanetState,
  PlayerCheats,
  PlayerState,
  RoomSummary,
  ServerToClientMessage,
  SHIP_SMASH_SPEED_THRESHOLD,
  ShipHullType,
  stepAiDroneAutopilot,
  WARP_DRIVE_SPEED,
} from './shared/types.ts';

type GameShellState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'RESPAWNING';

interface HudTelemetry {
  hp: number;
  maxHp: number;
  speed: number;
  peakSpeed: number;
  angleDeg: number;
  kills: number;
  deaths: number;
  score: number;
  alive: boolean;
  respawnTimer: number;
  inputSource: 'gamepad' | 'keyboard';
  gamepadConnected: boolean;
  gamepadName: string;
  stickActive: boolean;
  playerCount: number;
  droneCount: number;
  leaderboard: PlayerState[];
  killFeed: KillFeedEntry[];
  gravityStarEnabled: boolean;
  pingMs: number;
  secondPadAvailable: boolean;
  localCoopActive: boolean;
  landedPlanetName: string | null;
}

const HULL_LIST: ShipHullType[] = ['needle', 'wedge', 'interceptor', 'disc'];

export default function App() {
  const [shellState, setShellState] = useState<GameShellState>('TITLE_MENU');
  const [pilotName, setPilotName] = useState<string>(() => {
    const saved = localStorage.getItem('spacewar_pilot_name');
    if (saved) return saved;
    return `PILOT-${Math.floor(100 + Math.random() * 899)}`;
  });
  const [selectedHull, setSelectedHull] = useState<ShipHullType>('needle');
  const [selectedColor, setSelectedColor] = useState<string>(PLAYER_COLORS[0]);
  const roomId = 'SECTOR-01';
  const [isMuted, setIsMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [controllerModalOpen, setControllerModalOpen] = useState<boolean>(false);
  const [deathSoundModalOpen, setDeathSoundModalOpen] = useState<boolean>(false);
  const [cheatMenuOpen, setCheatMenuOpen] = useState<boolean>(false);
  const [isEditingOwnName, setIsEditingOwnName] = useState<boolean>(false);
  const [ownNameDraft, setOwnNameDraft] = useState<string>('');
  const [autoFire, setAutoFire] = useState<boolean>(false);
  const [warpSpeedActive, setWarpSpeedActive] = useState<boolean>(false);
  const [cheats, setCheats] = useState<PlayerCheats>({ ...DEFAULT_PLAYER_CHEATS });
  const [spectateTargetId, setSpectateTargetId] = useState<string | null>(null);
  const musicBox = useMusicBoxController();
  const deathSoundCtrl = useDeathSoundController();
  const [mapping, setMapping] = useState<ControllerMapping>(() => loadControllerMapping());
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState<string>('');
  const [serverWideBanner, setServerWideBanner] = useState<ChatMessage | null>(null);
  const [selectedShipPng, setSelectedShipPng] = useState<string | null>(() => {
    return localStorage.getItem('spacewar_ship_png') || null;
  });

  const [hud, setHud] = useState<HudTelemetry>({
    hp: 100,
    maxHp: 100,
    speed: 0,
    peakSpeed: 0,
    angleDeg: -90,
    kills: 0,
    deaths: 0,
    score: 0,
    alive: true,
    respawnTimer: 0,
    inputSource: 'keyboard',
    gamepadConnected: false,
    gamepadName: '',
    stickActive: false,
    playerCount: 1,
    droneCount: 0,
    leaderboard: [],
    killFeed: [],
    gravityStarEnabled: true,
    pingMs: 12,
    secondPadAvailable: false,
    localCoopActive: false,
    landedPlanetName: null,
  });

  // Mutable simulation refs isolated from React render cycle for 60fps canvas loop
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerSyncRef = useRef<PeerSectorSync | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const rendererRef = useRef<SpacewarRenderer | null>(null);
  const shellStateRef = useRef<GameShellState>(shellState);
  shellStateRef.current = shellState;
  const pilotNameRef = useRef<string>(pilotName);
  pilotNameRef.current = pilotName;
  const selectedHullRef = useRef<ShipHullType>(selectedHull);
  selectedHullRef.current = selectedHull;
  const selectedColorRef = useRef<string>(selectedColor);
  selectedColorRef.current = selectedColor;
  const cheatsRef = useRef<PlayerCheats>(cheats);
  cheatsRef.current = cheats;
  const cheatMenuOpenRef = useRef<boolean>(cheatMenuOpen);
  cheatMenuOpenRef.current = cheatMenuOpen;
  const controllerModalOpenRef = useRef<boolean>(controllerModalOpen);
  controllerModalOpenRef.current = controllerModalOpen;
  const deathSoundModalOpenRef = useRef<boolean>(deathSoundModalOpen);
  deathSoundModalOpenRef.current = deathSoundModalOpen;
  const spectateTargetIdRef = useRef<string | null>(spectateTargetId);
  spectateTargetIdRef.current = spectateTargetId;
  const freeCamPosRef = useRef<{ x: number; y: number; initialized: boolean }>({
    x: GRAVITY_STAR_X,
    y: GRAVITY_STAR_Y,
    initialized: false,
  });
  const autoFireRef = useRef<boolean>(autoFire);
  autoFireRef.current = autoFire;
  const warpSpeedActiveRef = useRef<boolean>(warpSpeedActive);
  warpSpeedActiveRef.current = warpSpeedActive;
  const musicBoxRef = useRef(musicBox);
  musicBoxRef.current = musicBox;
  const deathSoundCtrlRef = useRef(deathSoundCtrl);
  deathSoundCtrlRef.current = deathSoundCtrl;
  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;
  const lastDamagedRemoteAtRef = useRef<Map<string, number>>(new Map());
  const lastLocalSunHitAtRef = useRef<number>(0);
  const lastLocalEnvHitAtRef = useRef<number>(0);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const serverWideTimerRef = useRef<number | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const selectedShipPngRef = useRef<string | null>(selectedShipPng);
  selectedShipPngRef.current = selectedShipPng;

  const selfIdRef = useRef<string>(
    (() => {
      try {
        const saved = sessionStorage.getItem('spacewar_self_id');
        if (saved && saved.startsWith('plr_')) return saved;
        const fresh = `plr_${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem('spacewar_self_id', fresh);
        return fresh;
      } catch {
        return `plr_${Math.random().toString(36).slice(2, 9)}`;
      }
    })()
  );
  const coopIdRef = useRef<string>(`plr2_${Math.random().toString(36).slice(2, 9)}`);
  const coopActiveRef = useRef<boolean>(false);

  const worldRef = useRef<{
    players: Map<string, PlayerState>;
    bullets: BulletState[];
    asteroids: AsteroidState[];
    planets: PlanetState[];
    killFeed: KillFeedEntry[];
    gravityStarEnabled: boolean;
    pingMs: number;
  }>({
    players: new Map(),
    bullets: [],
    asteroids: createInitialClientAsteroids(192),
    planets: INITIAL_PLANETS.map((p) => ({
      ...p,
      x: GRAVITY_STAR_X + Math.cos(p.orbitAngle) * p.orbitRadius,
      y: GRAVITY_STAR_Y + Math.sin(p.orbitAngle) * p.orbitRadius,
      vx: -Math.sin(p.orbitAngle) * p.orbitSpeed * p.orbitRadius,
      vy: Math.cos(p.orbitAngle) * p.orbitSpeed * p.orbitRadius,
    })),
    killFeed: [],
    gravityStarEnabled: true,
    pingMs: 10,
  });

  const sendWs = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const receiveChatMessage = useCallback(
    (msg: ChatMessage, allowBannerTrigger: boolean = true) => {
      if (!msg || !msg.id) return;
      if (seenChatIdsRef.current.has(msg.id)) return;
      seenChatIdsRef.current.add(msg.id);
      if (seenChatIdsRef.current.size > 300) {
        const first = seenChatIdsRef.current.values().next().value;
        if (first) seenChatIdsRef.current.delete(first);
      }

      setChatMessages((prev) => {
        const next = [...prev, msg];
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });

      if (
        allowBannerTrigger &&
        msg.isServerWide &&
        Date.now() - (msg.timestamp || Date.now()) < 12000
      ) {
        setServerWideBanner(msg);
        if (serverWideTimerRef.current) {
          window.clearTimeout(serverWideTimerRef.current);
        }
        serverWideTimerRef.current = window.setTimeout(() => {
          setServerWideBanner((curr) => (curr?.id === msg.id ? null : curr));
        }, 7000);
        soundEngine.playWarp();
      }
    },
    []
  );

  const receiveChatMessageRef = useRef(receiveChatMessage);
  receiveChatMessageRef.current = receiveChatMessage;

  useEffect(() => {
    const el = chatListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    const onGlobalKeyCapture = (e: KeyboardEvent) => {
      const isEsc =
        e.key === 'Escape' ||
        e.code === 'Escape' ||
        e.key === 'BrowserBack';

      if (isEsc && !e.repeat) {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        inputRef.current?.clearHeldInputs();

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

        if (cheatMenuOpenRef.current) {
          e.preventDefault();
          e.stopPropagation();
          cheatMenuOpenRef.current = false;
          setCheatMenuOpen(false);
          return;
        }
        if (controllerModalOpenRef.current) {
          e.preventDefault();
          e.stopPropagation();
          controllerModalOpenRef.current = false;
          setControllerModalOpen(false);
          return;
        }
        if (deathSoundModalOpenRef.current) {
          e.preventDefault();
          e.stopPropagation();
          deathSoundModalOpenRef.current = false;
          setDeathSoundModalOpen(false);
          return;
        }
        if (shellStateRef.current !== 'TITLE_MENU') {
          e.preventDefault();
          e.stopPropagation();
          setIsEditingOwnName(false);
          setShellState((prev) => {
            const next = prev === 'PAUSED' ? 'PLAYING' : 'PAUSED';
            shellStateRef.current = next;
            return next;
          });
          return;
        }
      }
    };

    const onGlobalChatShortcut = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (
        shellStateRef.current === 'TITLE_MENU' ||
        controllerModalOpenRef.current ||
        deathSoundModalOpenRef.current ||
        cheatMenuOpenRef.current
      ) {
        return;
      }
      if (e.key === 't' || e.key === 'T' || e.key === 'Enter') {
        e.preventDefault();
        chatInputRef.current?.focus();
      } else if (e.key === '/') {
        e.preventDefault();
        setChatDraft((prev) => (prev ? prev : '/'));
        chatInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onGlobalKeyCapture, true);
    window.addEventListener('keydown', onGlobalChatShortcut);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyCapture, true);
      window.removeEventListener('keydown', onGlobalChatShortcut);
    };
  }, []);

  // Connect to authoritative WebSocket server with auto-reconnect
  useEffect(() => {
    let reconnectTimer: number | null = null;
    let pingInterval: number | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (shellStateRef.current === 'PLAYING' || shellStateRef.current === 'PAUSED') {
          ws.send(
            JSON.stringify({
              type: 'player:join',
              roomId,
              playerId: selfIdRef.current,
              name: pilotNameRef.current.trim().slice(0, 16) || 'PILOT',
              hull: selectedHullRef.current,
              color: selectedColorRef.current,
              inputSource: 'keyboard',
              deathSound: deathSoundCtrlRef.current.selectedDeathSound,
              shipPng: selectedShipPngRef.current,
            } satisfies ClientToServerMessage)
          );
          ws.send(
            JSON.stringify({
              type: 'player:cheats',
              playerId: selfIdRef.current,
              cheats: cheatsRef.current,
            } satisfies ClientToServerMessage)
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerToClientMessage;
          const world = worldRef.current;

          if (msg.type === 'pong') {
            world.pingMs = Math.max(1, Date.now() - msg.clientTime);
            if (typeof msg.serverTime === 'number') {
              musicBoxRef.current.updateServerClock(msg.serverTime);
            }
            return;
          }

          if (msg.type === 'room:init') {
            world.gravityStarEnabled = msg.gravityStarEnabled;
            world.bullets = msg.bullets;
            world.asteroids = msg.asteroids;
            if (Array.isArray(msg.planets)) {
              world.planets = msg.planets;
            }
            world.killFeed = msg.killFeed;

            const nextPlayers = new Map<string, PlayerState>();
            for (const p of msg.players) {
              nextPlayers.set(p.id, p);
            }
            world.players = nextPlayers;
            if (Array.isArray(msg.chatMessages)) {
              for (const chatMsg of msg.chatMessages) {
                receiveChatMessageRef.current(chatMsg, Date.now() - chatMsg.timestamp < 7000);
              }
            }
            return;
          }

          if (msg.type === 'state:snapshot') {
            if (typeof msg.serverTime === 'number') {
              musicBoxRef.current.updateServerClock(msg.serverTime);
            }
            world.gravityStarEnabled = msg.gravityStarEnabled;
            if (Array.isArray(msg.bullets)) {
              world.bullets = msg.bullets;
            }
            world.asteroids = msg.asteroids;
            if (Array.isArray(msg.planets)) {
              world.planets = msg.planets;
            }

            const currentPlayers = world.players;
            const seenIds = new Set<string>();

            for (const serverPlayer of msg.players) {
              seenIds.add(serverPlayer.id);
              const existing = currentPlayers.get(serverPlayer.id);
              const isLocalControlled =
                serverPlayer.id === selfIdRef.current ||
                (coopActiveRef.current && serverPlayer.id === coopIdRef.current);

              if (isLocalControlled && existing) {
                const wasAlive = existing.alive;
                const recentlyEnvDamaged =
                  serverPlayer.id === selfIdRef.current &&
                  Date.now() - lastLocalEnvHitAtRef.current < 650;
                existing.name = serverPlayer.name;
                if (!recentlyEnvDamaged || serverPlayer.hp <= existing.hp || !serverPlayer.alive) {
                  existing.hp = serverPlayer.hp;
                  existing.alive = serverPlayer.alive;
                }
                existing.maxHp = serverPlayer.maxHp;
                existing.score = serverPlayer.score;
                existing.kills = serverPlayer.kills;
                existing.deaths = serverPlayer.deaths;
                existing.streak = serverPlayer.streak;
                existing.respawnTimer = serverPlayer.respawnTimer;
                if (!wasAlive && serverPlayer.alive) {
                  existing.invulnerableTimer = serverPlayer.invulnerableTimer;
                }

                if (!serverPlayer.alive && serverPlayer.id === selfIdRef.current) {
                  existing.warping = false;
                  existing.landedPlanetId = null;
                  existing.landedSurfaceAngle = undefined;
                  if (warpSpeedActiveRef.current) {
                    warpSpeedActiveRef.current = false;
                    setWarpSpeedActive(false);
                  }
                }

                const distToSun = Math.hypot(
                  existing.x - GRAVITY_STAR_X,
                  existing.y - GRAVITY_STAR_Y
                );
                const recentlyTeleportedFromSun =
                  serverPlayer.id === selfIdRef.current &&
                  Date.now() - lastLocalSunHitAtRef.current < 1200;
                if (
                  !recentlyTeleportedFromSun &&
                  (!serverPlayer.alive ||
                    (!wasAlive && serverPlayer.alive) ||
                    serverPlayer.invulnerableTimer > 1.6 ||
                    distToSun < GRAVITY_STAR_RADIUS + 20)
                ) {
                  existing.x = serverPlayer.x;
                  existing.y = serverPlayer.y;
                  existing.vx = serverPlayer.vx;
                  existing.vy = serverPlayer.vy;
                }
              } else {
                currentPlayers.set(
                  serverPlayer.id,
                  mergeSmoothRemotePlayerState(existing, serverPlayer)
                );
              }
            }

            for (const id of Array.from(currentPlayers.keys())) {
              if (!seenIds.has(id)) {
                currentPlayers.delete(id);
              }
            }
            return;
          }

          if (msg.type === 'salvo:spawn') {
            const spawned = expandSalvoToBullets(msg.salvo);
            world.bullets.push(...spawned);
            if (world.bullets.length > 1800) {
              world.bullets.splice(0, world.bullets.length - 1800);
            }
            return;
          }

          if (msg.type === 'bullets:spawn_batch') {
            const existingIds = new Set(world.bullets.map((b) => b.id));
            for (const b of msg.bullets) {
              if (!existingIds.has(b.id)) {
                world.bullets.push(b);
              }
            }
            if (world.bullets.length > 1800) {
              world.bullets.splice(0, world.bullets.length - 1800);
            }
            return;
          }

          if (msg.type === 'bullets:remove') {
            const removeSet = new Set(msg.bulletIds);
            world.bullets = world.bullets.filter((b) => !removeSet.has(b.id));
            return;
          }

          if (msg.type === 'player:joined') {
            if (!world.players.has(msg.player.id)) {
              world.players.set(msg.player.id, msg.player);
            }
            return;
          }

          if (msg.type === 'player:left') {
            world.players.delete(msg.playerId);
            return;
          }

          if (msg.type === 'combat:hit') {
            const isLocalSunEcho =
              msg.targetId === selfIdRef.current &&
              (msg.attackerId === 'star' ||
                msg.cause === 'star' ||
                Date.now() - lastLocalSunHitAtRef.current < 1500);
            const isLocalEnvEcho =
              msg.targetId === selfIdRef.current &&
              (msg.cause === 'asteroid' || msg.cause === 'planet') &&
              Date.now() - lastLocalEnvHitAtRef.current < 650;
            if (isLocalSunEcho || isLocalEnvEcho) {
              return;
            }
            const renderer = rendererRef.current;
            if (renderer) {
              renderer.hitFlashes.set(msg.targetId, 0.12);
              renderer.addBurst(
                msg.x,
                msg.y,
                msg.vx * 0.25,
                msg.vy * 0.25,
                msg.color,
                msg.fatal ? 34 : 12,
                msg.fatal ? 320 : 180,
                msg.fatal
              );
              if (msg.fatal) {
                if (msg.cause === 'collision') {
                  deathSoundCtrlRef.current.playSmashSound(undefined, isMutedRef.current);
                } else {
                  const victim = world.players.get(msg.targetId);
                  deathSoundCtrlRef.current.playDeathSound(
                    msg.deathSound || victim?.deathSound,
                    isMutedRef.current
                  );
                }
              }
              if (msg.targetId === selfIdRef.current || msg.attackerId === selfIdRef.current) {
                renderer.cameraShake = msg.fatal ? 14 : 5;
                if (msg.fatal) {
                  renderer.hitstopTimer = 0.045;
                }
                soundEngine.playHit(msg.fatal);
              }
            }
            return;
          }

          if (msg.type === 'combat:kill') {
            world.killFeed = [
              msg.entry,
              ...world.killFeed.filter((k) => k.id !== msg.entry.id),
            ].slice(0, 6);
            return;
          }

          if (msg.type === 'chat:message') {
            receiveChatMessageRef.current(msg.message, true);
            return;
          }
        } catch {
          // ignore malformed packet
        }
      };

      ws.onclose = () => {
        if (!unmounted) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      };
    };

    connect();

    pingInterval = window.setInterval(() => {
      sendWs({ type: 'ping', clientTime: Date.now() });
    }, 2500);

    const handleBeforeUnload = () => {
      sendWs({ type: 'player:leave', playerId: selfIdRef.current });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      unmounted = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      wsRef.current?.close();
    };
  }, [roomId, sendWs]);

  // Multi-Window & Vercel Serverless Peer Sync (ensures multiple windows share SECTOR-01 even without /ws)
  useEffect(() => {
    const peerSync = new PeerSectorSync(selfIdRef.current, (pkt) => {
      // When the authoritative WebSocket server is connected, ignore peer fallback packets so they don't overwrite server state
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const world = worldRef.current;

      if (pkt.type === 'peer:hello') {
        if (pkt.player && pkt.player.id !== selfIdRef.current) {
          const existing = world.players.get(pkt.player.id);
          world.players.set(
            pkt.player.id,
            mergeSmoothRemotePlayerState(existing, pkt.player)
          );
        }
        peerSync.send({
          type: 'peer:welcome',
          senderId: selfIdRef.current,
          players: Array.from(world.players.values()),
          asteroids: world.asteroids,
          planets: world.planets,
          killFeed: world.killFeed,
          gravityStarEnabled: world.gravityStarEnabled,
        });
        return;
      }

      if (pkt.type === 'peer:welcome') {
        for (const p of pkt.players) {
          if (p.id !== selfIdRef.current) {
            const existing = world.players.get(p.id);
            world.players.set(p.id, mergeSmoothRemotePlayerState(existing, p));
          }
        }
        if (pkt.planets && pkt.planets.length === world.planets.length) {
          for (let i = 0; i < pkt.planets.length; i++) {
            world.planets[i].orbitAngle = pkt.planets[i].orbitAngle;
          }
        }
        if (pkt.killFeed && pkt.killFeed.length > 0 && world.killFeed.length === 0) {
          world.killFeed = pkt.killFeed;
        }
        return;
      }

      if (pkt.type === 'peer:player_state') {
        if (pkt.player.id !== selfIdRef.current) {
          const existing = world.players.get(pkt.player.id);
          // Do not overwrite live-simulated AI drones with static initial spawn coordinates from /api/sector
          if (pkt.player.isDrone && existing) {
            existing.name = pkt.player.name || existing.name;
          } else {
            const lastDamaged = lastDamagedRemoteAtRef.current.get(pkt.player.id) || 0;
            const recentlyDamagedLocally = Date.now() - lastDamaged < 450;

            world.players.set(
              pkt.player.id,
              mergeSmoothRemotePlayerState(existing, pkt.player, recentlyDamagedLocally)
            );
          }
        }
        if (pkt.drones) {
          for (const d of pkt.drones) {
            if (!world.players.has(d.id)) {
              world.players.set(d.id, mergeSmoothRemotePlayerState(undefined, d));
            }
          }
        }
        return;
      }

      if (pkt.type === 'peer:player_leave') {
        if (pkt.playerId !== selfIdRef.current) {
          world.players.delete(pkt.playerId);
        }
        return;
      }

      if (pkt.type === 'peer:salvo') {
        const owner = world.players.get(pkt.salvo.ownerId);
        if (owner) {
          owner.lastFireTime = performance.now() / 1000;
        }
        const spawned = expandSalvoToBullets(pkt.salvo);
        world.bullets.push(...spawned);
        if (world.bullets.length > 1800) {
          world.bullets.splice(0, world.bullets.length - 1800);
        }
        return;
      }

      if (pkt.type === 'peer:cheat_action') {
        if (pkt.spawnedDrones) {
          for (const d of pkt.spawnedDrones) {
            world.players.set(d.id, d);
          }
        } else if (pkt.action === 'clear_drones') {
          for (const [pid, p] of world.players.entries()) {
            if (p.isDrone) {
              world.players.delete(pid);
            }
          }
        }
        return;
      }

      if (pkt.type === 'peer:rename') {
        const target = world.players.get(pkt.playerId);
        if (target) target.name = pkt.newName;
        return;
      }

      if (pkt.type === 'peer:cheat_rename') {
        if (pkt.targetId === 'ALL_OTHERS') {
          for (const p of world.players.values()) {
            if (p.id !== pkt.requesterId) {
              p.name = pkt.newName;
              if (p.id === selfIdRef.current) {
                setPilotName(pkt.newName);
              }
            }
          }
        } else {
          const target = world.players.get(pkt.targetId);
          if (target) {
            target.name = pkt.newName;
            if (target.id === selfIdRef.current) {
              setPilotName(pkt.newName);
            }
          }
        }
        return;
      }

      if (pkt.type === 'peer:combat_hit') {
        const target = world.players.get(pkt.targetId);
        if (target && target.alive) {
          if (
            (target.invulnerableTimer <= 0 || target.spectating) &&
            !target.cheats?.godMode &&
            !target.warping
          ) {
            target.hp = Math.max(0, target.hp - pkt.damage);
          }
          if (!target.spectating && !target.warping) {
            target.vx = pkt.vx;
            target.vy = pkt.vy;
          }
          const isFatal =
            (pkt.fatal || target.hp <= 0) && !target.cheats?.godMode && !target.warping;
          if (isFatal) {
            target.alive = false;
            target.hp = 0;
            target.deaths += 1;
            target.streak = 0;
            target.respawnTimer = 2.8;
            target.warping = false;
            if (target.id === selfIdRef.current) {
              warpSpeedActiveRef.current = false;
              setWarpSpeedActive(false);
            }
            const attacker = world.players.get(pkt.attackerId);
            if (attacker && attacker.id !== target.id) {
              attacker.kills += 1;
              attacker.streak += 1;
              attacker.score += 150;
            }
          }
        }
        const renderer = rendererRef.current;
        if (renderer) {
          renderer.hitFlashes.set(pkt.targetId, 0.12);
          renderer.addBurst(
            pkt.x,
            pkt.y,
            pkt.vx * 0.25,
            pkt.vy * 0.25,
            pkt.color,
            pkt.fatal ? 34 : 12,
            pkt.fatal ? 320 : 180,
            pkt.fatal
          );
          if (pkt.fatal) {
            if (pkt.cause === 'collision' || pkt.killEntry?.cause === 'collision') {
              deathSoundCtrlRef.current.playSmashSound(undefined, isMutedRef.current);
            } else {
              deathSoundCtrlRef.current.playDeathSound(
                pkt.deathSound || pkt.killEntry?.deathSound || target?.deathSound,
                isMutedRef.current
              );
            }
          }
          if (pkt.targetId === selfIdRef.current || pkt.attackerId === selfIdRef.current) {
            renderer.cameraShake = pkt.fatal ? 14 : 5;
            soundEngine.playHit(pkt.fatal);
          }
        }
        if (pkt.killEntry) {
          world.killFeed = [
            pkt.killEntry,
            ...world.killFeed.filter((k) => k.id !== pkt.killEntry!.id),
          ].slice(0, 6);
        }
        return;
      }

      if (pkt.type === 'peer:chat' && pkt.message) {
        receiveChatMessageRef.current(pkt.message, true);
        return;
      }
    });

    peerSyncRef.current = peerSync;
    peerSync.announceJoin();
    peerSync.startCloudRelayPoll(
      () => wsRef.current?.readyState === WebSocket.OPEN,
      () => {
        const lp = worldRef.current.players.get(selfIdRef.current);
        if (lp) {
          lp.music = musicBoxRef.current.getBroadcastMusicState();
          lp.deathSound = deathSoundCtrlRef.current.selectedDeathSound;
          lp.shipPng = selectedShipPngRef.current;
        }
        return lp;
      },
      (serverTime) => {
        musicBoxRef.current.updateServerClock(serverTime);
      }
    );

    // Background heartbeat so when a tab is unfocused/hidden or paused, its server music stream and multi-tab audio yield stay active
    const bgSyncTimer = window.setInterval(() => {
      const world = worldRef.current;
      const lp = world.players.get(selfIdRef.current);
      if (!lp) return;

      const isHiddenOrPaused =
        (typeof document !== 'undefined' && document.hidden) ||
        shellStateRef.current === 'PAUSED';

      if (isHiddenOrPaused && shellStateRef.current !== 'TITLE_MENU') {
        lp.music = musicBoxRef.current.getBroadcastMusicState();
        lp.deathSound = deathSoundCtrlRef.current.selectedDeathSound;
        lp.shipPng = selectedShipPngRef.current;

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendWs({
            type: 'player:input',
            playerId: selfIdRef.current,
            angle: lp.angle,
            thrusting: false,
            shooting: false,
            inputSource: lp.inputSource,
            x: lp.x,
            y: lp.y,
            vx: lp.vx,
            vy: lp.vy,
            spectating: lp.spectating,
            spectateTargetId: lp.spectateTargetId,
            cursorX: lp.cursorX,
            cursorY: lp.cursorY,
            music: lp.music,
            deathSound: lp.deathSound,
            shipPng: lp.shipPng,
            warping: lp.warping,
            landedPlanetId: lp.landedPlanetId,
            landedSurfaceAngle: lp.landedSurfaceAngle,
          });
        } else {
          peerSync.send({
            type: 'peer:player_state',
            senderId: selfIdRef.current,
            player: lp,
          });
        }
      }

      if (typeof document !== 'undefined' && document.hidden) {
        const camPos = rendererRef.current?.getCameraPosition();
        const listenerX =
          lp && !cheatsRef.current.freeCam ? lp.x : camPos ? camPos.x : lp.x;
        const listenerY =
          lp && !cheatsRef.current.freeCam ? lp.y : camPos ? camPos.y : lp.y;
        musicBoxRef.current.syncRemotePlayersAudio(
          world.players,
          selfIdRef.current,
          listenerX,
          listenerY,
          isMutedRef.current,
          {
            localShipX: lp.x,
            localShipY: lp.y,
            isFreeCam: Boolean(cheatsRef.current.freeCam),
            yieldLocalCockpitToOtherTab: peerSync.isAnotherLocalTabFocused(),
          }
        );
      }
    }, 350);

    return () => {
      window.clearInterval(bgSyncTimer);
      peerSync.destroy(selfIdRef.current);
      peerSyncRef.current = null;
    };
  }, [sendWs]);

  const handleStartGame = useCallback(() => {
    const cleanName = pilotName.trim().slice(0, 16) || 'PILOT';
    localStorage.setItem('spacewar_pilot_name', cleanName);

    const spec = HULL_SPECS[selectedHull];
    const spawnPt = getColocatedSpawnPoint(
      worldRef.current.players.values(),
      selfIdRef.current
    );

    const localPlayerObj: PlayerState = {
      id: selfIdRef.current,
      name: cleanName,
      color: selectedColor,
      hull: selectedHull,
      x: spawnPt.x,
      y: spawnPt.y,
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
      inputSource: 'keyboard',
      cheats: cheatsRef.current,
      deathSound: deathSoundCtrlRef.current.selectedDeathSound,
      shipPng: selectedShipPngRef.current,
      warping: false,
    };

    warpSpeedActiveRef.current = false;
    setWarpSpeedActive(false);
    shellStateRef.current = 'PLAYING';
    setShellState('PLAYING');

    worldRef.current.players.set(selfIdRef.current, localPlayerObj);
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      peerSyncRef.current?.announceJoin(localPlayerObj);
    }

    sendWs({
      type: 'player:join',
      roomId,
      playerId: selfIdRef.current,
      name: cleanName,
      hull: selectedHull,
      color: selectedColor,
      inputSource: 'keyboard',
      deathSound: deathSoundCtrlRef.current.selectedDeathSound,
      shipPng: selectedShipPngRef.current,
    });

    sendWs({
      type: 'player:cheats',
      playerId: selfIdRef.current,
      cheats: cheatsRef.current,
    });
  }, [pilotName, roomId, selectedColor, selectedHull, sendWs]);

  const handleUpdateCheats = useCallback(
    (nextCheats: PlayerCheats) => {
      setCheats(nextCheats);
      cheatsRef.current = nextCheats;
      const localPlayer = worldRef.current.players.get(selfIdRef.current);
      if (localPlayer) {
        localPlayer.cheats = nextCheats;
        if (!nextCheats.godMode) {
          localPlayer.invulnerableTimer = 0;
        }
        localPlayer.spectating = Boolean(nextCheats.freeCam);
        if (nextCheats.freeCam) {
          localPlayer.warping = false;
          warpSpeedActiveRef.current = false;
          setWarpSpeedActive(false);
        } else {
          localPlayer.spectateTargetId = null;
        }
      }
      if (!nextCheats.freeCam) {
        freeCamPosRef.current.initialized = false;
      } else if (!freeCamPosRef.current.initialized) {
        const cam = rendererRef.current?.getCameraPosition();
        freeCamPosRef.current = {
          x: cam ? cam.x : localPlayer ? localPlayer.x : GRAVITY_STAR_X,
          y: cam ? cam.y : localPlayer ? localPlayer.y : GRAVITY_STAR_Y,
          initialized: true,
        };
      }
      sendWs({
        type: 'player:cheats',
        playerId: selfIdRef.current,
        cheats: nextCheats,
      });
    },
    [sendWs]
  );

  const handleSelectSpectateTarget = useCallback((targetId: string | null) => {
    const safeTargetId = targetId === selfIdRef.current ? null : targetId;
    setSpectateTargetId(safeTargetId);
    spectateTargetIdRef.current = safeTargetId;
    if (safeTargetId === null) {
      const cam = rendererRef.current?.getCameraPosition();
      if (cam) {
        freeCamPosRef.current = { x: cam.x, y: cam.y, initialized: true };
      }
    }
  }, []);

  const handleCycleSpectateTarget = useCallback(
    (dir: -1 | 1) => {
      const otherPlayers = Array.from(worldRef.current.players.values()).filter(
        (p) => p.id !== selfIdRef.current
      );
      if (otherPlayers.length === 0) {
        handleSelectSpectateTarget(null);
        return;
      }
      const currentId = spectateTargetIdRef.current;
      const idx = otherPlayers.findIndex((p) => p.id === currentId);
      const nextIdx =
        idx === -1
          ? dir > 0
            ? 0
            : otherPlayers.length - 1
          : (idx + dir + otherPlayers.length) % otherPlayers.length;
      const chosen = otherPlayers[nextIdx];
      if (chosen && chosen.id !== selfIdRef.current) {
        handleSelectSpectateTarget(chosen.id);
        if (!cheatsRef.current.freeCam) {
          handleUpdateCheats({ ...cheatsRef.current, freeCam: true });
        }
      }
    },
    [handleSelectSpectateTarget, handleUpdateCheats]
  );

  const handleTriggerCheatAction = useCallback(
    (action: CheatActionType) => {
      const world = worldRef.current;
      const localPlayer = world.players.get(selfIdRef.current);
      const isWsConnected = wsRef.current?.readyState === WebSocket.OPEN;

      if (action === 'missile_swarm') {
        soundEngine.playMissileLaunch();
        if (!isWsConnected && localPlayer && localPlayer.alive) {
          const spec = HULL_SPECS[localPlayer.hull] || HULL_SPECS.needle;
          const targetIds: string[] = [];
          for (const p of world.players.values()) {
            if (p.alive && p.id !== localPlayer.id) targetIds.push(p.id);
          }
          const salvo = {
            idPrefix: `swm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
            ownerId: localPlayer.id,
            ownerName: localPlayer.name,
            color: '#F43F5E',
            x: localPlayer.x,
            y: localPlayer.y,
            vx: localPlayer.vx,
            vy: localPlayer.vy,
            angle: localPlayer.angle + ((performance.now() * 0.011) % (Math.PI * 2)),
            noseDist: spec.radius + 12,
            count: 16,
            spreadAngle: (Math.PI * 2) / 16,
            novaSpread: true,
            baseMuzzle: 760,
            damage: 42,
            ttl: 3.5,
            isMissile: true,
            targetIds,
          };
          world.bullets.push(...expandSalvoToBullets(salvo));
          if (world.bullets.length > 1800) {
            world.bullets.splice(0, world.bullets.length - 1800);
          }
          peerSyncRef.current?.send({
            type: 'peer:salvo',
            senderId: selfIdRef.current,
            salvo,
          });
        }
      } else if (action === 'momentum_boost' && localPlayer && localPlayer.alive) {
        localPlayer.landedPlanetId = null;
        localPlayer.landedSurfaceAngle = undefined;
        localPlayer.vx += Math.cos(localPlayer.angle) * 2500;
        localPlayer.vy += Math.sin(localPlayer.angle) * 2500;
        const spd = Math.hypot(localPlayer.vx, localPlayer.vy);
        if (spd > localPlayer.peakSpeed) {
          localPlayer.peakSpeed = Math.round(spd);
        }
        soundEngine.playWarp();
      } else if (action === 'momentum_zero' && localPlayer && localPlayer.alive) {
        warpSpeedActiveRef.current = false;
        setWarpSpeedActive(false);
        localPlayer.warping = false;
        localPlayer.vx = 0;
        localPlayer.vy = 0;
      } else if (action === 'spawn_drone' || action === 'spawn_drones_100') {
        const countToSpawn = action === 'spawn_drones_100' ? 100 : 1;
        if (!isWsConnected) {
          const spawnedDrones = createTargetDronesBatch(
            world.players,
            countToSpawn,
            localPlayer
          );
          for (const d of spawnedDrones) {
            world.players.set(d.id, d);
          }
          peerSyncRef.current?.send({
            type: 'peer:cheat_action',
            senderId: selfIdRef.current,
            playerId: selfIdRef.current,
            action,
            spawnedDrones,
          });
        }
        setHud((prev) => ({
          ...prev,
          droneCount: prev.droneCount + countToSpawn,
          playerCount: prev.playerCount + countToSpawn,
        }));
      } else if (action === 'clear_drones') {
        if (!isWsConnected) {
          for (const [pid, p] of world.players.entries()) {
            if (p.isDrone) {
              world.players.delete(pid);
            }
          }
          peerSyncRef.current?.send({
            type: 'peer:cheat_action',
            senderId: selfIdRef.current,
            playerId: selfIdRef.current,
            action: 'clear_drones',
          });
        }
        setHud((prev) => ({
          ...prev,
          droneCount: 0,
          playerCount: Math.max(1, prev.playerCount - prev.droneCount),
        }));
      }

      sendWs({
        type: 'player:cheat_action',
        playerId: selfIdRef.current,
        action,
      });
    },
    [sendWs]
  );

  const handleToggleWarpSpeed = useCallback(() => {
    const localPlayer = worldRef.current.players.get(selfIdRef.current);
    if (!localPlayer || !localPlayer.alive || cheatsRef.current.freeCam) return;

    const nextWarp = !warpSpeedActiveRef.current;
    warpSpeedActiveRef.current = nextWarp;
    setWarpSpeedActive(nextWarp);
    localPlayer.warping = nextWarp;

    soundEngine.playWarp();
    const renderer = rendererRef.current;

    if (nextWarp) {
      localPlayer.landedPlanetId = null;
      localPlayer.landedSurfaceAngle = undefined;
      // Engage Warp Speed Drive: full invincibility + warp velocity along ship heading
      localPlayer.invulnerableTimer = Math.max(localPlayer.invulnerableTimer, 0.5);
      const currentSpd = Math.hypot(localPlayer.vx, localPlayer.vy);
      const warpSpd = Math.max(WARP_DRIVE_SPEED, currentSpd);
      localPlayer.vx = Math.cos(localPlayer.angle) * warpSpd;
      localPlayer.vy = Math.sin(localPlayer.angle) * warpSpd;
      if (warpSpd > localPlayer.peakSpeed) {
        localPlayer.peakSpeed = Math.round(warpSpd);
      }
      renderer?.addBurst(
        localPlayer.x,
        localPlayer.y,
        localPlayer.vx * 0.15,
        localPlayer.vy * 0.15,
        '#38BDF8',
        28,
        320,
        false
      );
    } else {
      // Second click: immediately stop ship and set momentum to 0 wherever you clicked!
      localPlayer.vx = 0;
      localPlayer.vy = 0;
      renderer?.addBurst(
        localPlayer.x,
        localPlayer.y,
        0,
        0,
        '#A855F7',
        26,
        240,
        false
      );
    }

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      peerSyncRef.current?.send({
        type: 'peer:player_state',
        senderId: selfIdRef.current,
        player: localPlayer,
      });
    }
    sendWs({
      type: 'player:input',
      playerId: selfIdRef.current,
      angle: localPlayer.angle,
      thrusting: localPlayer.thrusting,
      shooting: localPlayer.shooting,
      inputSource: localPlayer.inputSource,
      x: localPlayer.x,
      y: localPlayer.y,
      vx: localPlayer.vx,
      vy: localPlayer.vy,
      spectating: localPlayer.spectating,
      spectateTargetId: localPlayer.spectateTargetId,
      cursorX: localPlayer.cursorX,
      cursorY: localPlayer.cursorY,
      music: localPlayer.music,
      deathSound: localPlayer.deathSound,
      shipPng: localPlayer.shipPng,
      warping: localPlayer.warping,
      landedPlanetId: localPlayer.landedPlanetId,
      landedSurfaceAngle: localPlayer.landedSurfaceAngle,
    });
  }, [sendWs]);

  const handleSelectShipPng = useCallback(
    (filename: string | null) => {
      setSelectedShipPng(filename);
      selectedShipPngRef.current = filename;
      if (filename) {
        localStorage.setItem('spacewar_ship_png', filename);
      } else {
        localStorage.removeItem('spacewar_ship_png');
      }

      const localPlayer = worldRef.current.players.get(selfIdRef.current);
      if (localPlayer) {
        localPlayer.shipPng = filename;
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          peerSyncRef.current?.send({
            type: 'peer:player_state',
            senderId: selfIdRef.current,
            player: localPlayer,
          });
        }
        sendWs({
          type: 'player:input',
          playerId: selfIdRef.current,
          angle: localPlayer.angle,
          thrusting: localPlayer.thrusting,
          shooting: localPlayer.shooting,
          inputSource: localPlayer.inputSource,
          x: localPlayer.x,
          y: localPlayer.y,
          vx: localPlayer.vx,
          vy: localPlayer.vy,
          spectating: localPlayer.spectating,
          spectateTargetId: localPlayer.spectateTargetId,
          cursorX: localPlayer.cursorX,
          cursorY: localPlayer.cursorY,
          music: localPlayer.music,
          deathSound: localPlayer.deathSound,
          shipPng: filename,
          warping: localPlayer.warping,
        });
      }
    },
    [sendWs]
  );

  const handleToggleCoopGamepad = useCallback(() => {
    if (coopActiveRef.current) {
      coopActiveRef.current = false;
      sendWs({ type: 'player:leave', playerId: coopIdRef.current });
      worldRef.current.players.delete(coopIdRef.current);
    } else {
      coopActiveRef.current = true;
      sendWs({
        type: 'player:join',
        roomId,
        playerId: coopIdRef.current,
        name: `${pilotName.slice(0, 11)}-P2`,
        hull: 'interceptor',
        color: '#10B981',
        inputSource: 'gamepad',
      });
    }
  }, [pilotName, roomId, sendWs]);

  const handleRenameOwnShip = useCallback(
    (rawName: string) => {
      const clean = rawName.trim().slice(0, 16);
      if (!clean) return;
      setPilotName(clean);
      localStorage.setItem('spacewar_pilot_name', clean);
      const localPlayer = worldRef.current.players.get(selfIdRef.current);
      if (localPlayer) {
        localPlayer.name = clean;
      }
      peerSyncRef.current?.send({
        type: 'peer:rename',
        senderId: selfIdRef.current,
        playerId: selfIdRef.current,
        newName: clean,
      });
      sendWs({
        type: 'player:rename',
        playerId: selfIdRef.current,
        newName: clean,
      });
      setIsEditingOwnName(false);
    },
    [sendWs]
  );

  const handleCheatRenameShip = useCallback(
    (targetId: string | 'ALL_OTHERS', newName: string) => {
      const clean = newName.trim().slice(0, 16);
      if (!clean) return;

      if (targetId === 'ALL_OTHERS') {
        for (const p of worldRef.current.players.values()) {
          if (p.id !== selfIdRef.current) {
            p.name = clean;
          }
        }
      } else {
        const target = worldRef.current.players.get(targetId);
        if (target) {
          target.name = clean;
        }
      }

      peerSyncRef.current?.send({
        type: 'peer:cheat_rename',
        senderId: selfIdRef.current,
        requesterId: selfIdRef.current,
        targetId,
        newName: clean,
      });

      sendWs({
        type: 'player:cheat_rename',
        requesterId: selfIdRef.current,
        targetId,
        newName: clean,
      });
    },
    [sendWs]
  );

  const handleRespawnNow = useCallback(() => {
    const localPlayer = worldRef.current.players.get(selfIdRef.current);
    if (localPlayer && wsRef.current?.readyState !== WebSocket.OPEN) {
      const spawnPt = getColocatedSpawnPoint(
        worldRef.current.players.values(),
        selfIdRef.current
      );
      const spec = HULL_SPECS[selectedHull];
      localPlayer.hull = selectedHull;
      localPlayer.name = pilotName.trim().slice(0, 16) || localPlayer.name;
      localPlayer.x = spawnPt.x;
      localPlayer.y = spawnPt.y;
      localPlayer.vx = 0;
      localPlayer.vy = 0;
      localPlayer.hp = spec.maxHp;
      localPlayer.maxHp = spec.maxHp;
      localPlayer.alive = true;
      localPlayer.respawnTimer = 0;
      localPlayer.invulnerableTimer = 2.0;
    }
    sendWs({
      type: 'player:respawn',
      playerId: selfIdRef.current,
      hull: selectedHull,
      name: pilotName,
    });
    setShellState('PLAYING');
  }, [pilotName, selectedHull, sendWs]);

  // Isolated 60fps Canvas Simulation & Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const input = new InputManager();
    const renderer = new SpacewarRenderer();
    inputRef.current = input;
    rendererRef.current = renderer;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let rafId = 0;
    let lastTime = performance.now();
    let lastNetSend = 0;
    let lastHudSync = 0;
    let lastLocalFire = 0;
    let lastOfflineShot = 0;

    const loop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      const dt = Math.min(rawDt, 0.05);
      lastTime = now;
      const nowSec = now / 1000;

      const world = worldRef.current;
      const localPlayer = world.players.get(selfIdRef.current) || null;
      const isTitle = shellStateRef.current === 'TITLE_MENU';
      const isPaused = shellStateRef.current === 'PAUSED';
      const isWsConnected = wsRef.current?.readyState === WebSocket.OPEN;

      const sampled = input.sample(
        dt,
        window.innerWidth * 0.5,
        window.innerHeight * 0.5,
        0
      );

      // Press K while in-game to toggle the Cheat Menu
      if (!isTitle && sampled.cheatMenuJustPressed) {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        input.clearHeldInputs();
        setCheatMenuOpen((prev) => {
          const next = !prev;
          cheatMenuOpenRef.current = next;
          return next;
        });
      }

      // Press F (or R3 on controller) to toggle Auto-Fire
      if (sampled.autoFireToggleJustPressed) {
        setAutoFire((prev) => {
          const next = !prev;
          autoFireRef.current = next;
          return next;
        });
      }

      // Press M during gameplay to fire an Homing Missile Swarm
      if (!isTitle && sampled.missileSwarmJustPressed && !cheatsRef.current.freeCam) {
        handleTriggerCheatAction('missile_swarm');
      }

      // Press [ or ] to cycle spectated players (also activates Free-Cam / Spectator mode)
      if (!isTitle && (sampled.spectatePrevJustPressed || sampled.spectateNextJustPressed)) {
        handleCycleSpectateTarget(sampled.spectateNextJustPressed ? 1 : -1);
      }

      if (
        isTitle &&
        sampled.startJustPressed &&
        !controllerModalOpenRef.current &&
        !deathSoundModalOpenRef.current &&
        !cheatMenuOpenRef.current
      ) {
        handleStartGame();
      } else if (!isTitle && sampled.pauseJustPressed) {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        input.clearHeldInputs();
        if (cheatMenuOpenRef.current) {
          cheatMenuOpenRef.current = false;
          setCheatMenuOpen(false);
        } else if (controllerModalOpenRef.current) {
          controllerModalOpenRef.current = false;
          setControllerModalOpen(false);
        } else if (deathSoundModalOpenRef.current) {
          deathSoundModalOpenRef.current = false;
          setDeathSoundModalOpen(false);
        } else {
          setShellState((prev) => {
            const next = prev === 'PAUSED' ? 'PLAYING' : 'PAUSED';
            shellStateRef.current = next;
            return next;
          });
        }
      }

      // Step client-side planetary orbits smoothly at 60fps
      renderer.stepClientPlanets(world.planets, dt);

      const isFreeCam = Boolean(cheatsRef.current.freeCam);

      if (renderer.hitstopTimer > 0) {
        renderer.hitstopTimer = Math.max(0, renderer.hitstopTimer - dt);
      } else if (!isTitle && !isPaused && localPlayer) {
        if (isFreeCam) {
          // If the player died to enemy bullets while in spectator mode, send them back to the Main Menu!
          if (!localPlayer.alive || localPlayer.hp <= 0) {
            const nextCheats = { ...cheatsRef.current, freeCam: false };
            cheatsRef.current = nextCheats;
            setCheats(nextCheats);
            spectateTargetIdRef.current = null;
            setSpectateTargetId(null);
            freeCamPosRef.current.initialized = false;
            world.players.delete(selfIdRef.current);
            peerSyncRef.current?.send({
              type: 'peer:player_leave',
              senderId: selfIdRef.current,
              playerId: selfIdRef.current,
            });
            sendWs({ type: 'player:leave', playerId: selfIdRef.current });
            shellStateRef.current = 'TITLE_MENU';
            setShellState('TITLE_MENU');
            rafId = requestAnimationFrame(loop);
            return;
          }

          // Detached Camera / Spectator Mode:
          // Ship controls and physics are parked (immune to the Sun), but you retain HP and can be killed by bullets!
          localPlayer.thrusting = false;
          localPlayer.shooting = false;
          localPlayer.vx = 0;
          localPlayer.vy = 0;
          localPlayer.spectating = true;
          localPlayer.invulnerableTimer = 0;
          localPlayer.inputSource = sampled.inputSource;

          if (!freeCamPosRef.current.initialized) {
            const cam = renderer.getCameraPosition();
            freeCamPosRef.current = {
              x: cam.x || localPlayer.x,
              y: cam.y || localPlayer.y,
              initialized: true,
            };
          }

          // Never allow spectating yourself; if target left or user pushes WASD/Arrows/Stick to manually fly off:
          const currentTargetId =
            spectateTargetIdRef.current === selfIdRef.current ? null : spectateTargetIdRef.current;
          const targetExists = currentTargetId ? world.players.has(currentTargetId) : false;
          const manualPanActive =
            Math.abs(sampled.panVector.x) > 0.05 || Math.abs(sampled.panVector.y) > 0.05;

          if (spectateTargetIdRef.current && !targetExists) {
            spectateTargetIdRef.current = null;
            setSpectateTargetId(null);
          } else if (currentTargetId && manualPanActive) {
            // Smoothly detach from spectated ship into free-fly camera when moving WASD/Arrows/Stick
            const cam = renderer.getCameraPosition();
            freeCamPosRef.current = { x: cam.x, y: cam.y, initialized: true };
            spectateTargetIdRef.current = null;
            setSpectateTargetId(null);
          }

          if (!spectateTargetIdRef.current) {
            const camSpeed = sampled.boostHeld ? 3600 : 1450;
            freeCamPosRef.current.x = wrapCoord(
              freeCamPosRef.current.x + sampled.panVector.x * camSpeed * dt,
              ARENA_WIDTH
            );
            freeCamPosRef.current.y = wrapCoord(
              freeCamPosRef.current.y + sampled.panVector.y * camSpeed * dt,
              ARENA_HEIGHT
            );
          }

          localPlayer.spectateTargetId = spectateTargetIdRef.current;
        } else {
          if (freeCamPosRef.current.initialized) {
            freeCamPosRef.current.initialized = false;
          }
          localPlayer.spectating = false;
          localPlayer.spectateTargetId = null;
          localPlayer.warping = warpSpeedActiveRef.current && localPlayer.alive;
          localPlayer.angle = sampled.angle;
          localPlayer.thrusting = sampled.thrusting && localPlayer.alive;
          localPlayer.shooting = (sampled.shooting || autoFireRef.current) && localPlayer.alive;
          localPlayer.inputSource = sampled.inputSource;

          const applyEnvironmentHit = (
            target: PlayerState,
            cause: 'asteroid' | 'planet',
            sourceId: string,
            sourceName: string,
            sourceColor: string,
            damage: number,
            fatal: boolean,
            impactSpeed: number
          ) => {
            if (target.cheats?.godMode || target.warping) return;
            target.hp = Math.max(0, target.hp - damage);
            const isFatal = fatal || target.hp <= 0;
            if (target.id === selfIdRef.current) {
              lastLocalEnvHitAtRef.current = Date.now();
            }

            renderer.hitFlashes.set(target.id, 0.14);
            if (target.id === selfIdRef.current) {
              renderer.cameraShake = isFatal ? 14 : 6;
              if (isFatal) {
                renderer.hitstopTimer = 0.045;
              }
              soundEngine.playHit(isFatal);
            }

            let killEntry: KillFeedEntry | undefined;
            if (isFatal) {
              target.alive = false;
              target.hp = 0;
              target.deaths += 1;
              target.streak = 0;
              target.respawnTimer = 2.8;
              target.warping = false;
              target.landedPlanetId = null;
              target.landedSurfaceAngle = undefined;
              if (target.id === selfIdRef.current) {
                warpSpeedActiveRef.current = false;
                setWarpSpeedActive(false);
              }
              renderer.addBurst(
                target.x,
                target.y,
                target.vx * 0.2,
                target.vy * 0.2,
                sourceColor,
                34,
                320,
                true
              );
              deathSoundCtrlRef.current.playDeathSound(target.deathSound, isMutedRef.current);

              if (!isWsConnected) {
                killEntry = {
                  id: `kill_env_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
                  killerId: sourceId,
                  killerName: sourceName,
                  killerColor: sourceColor,
                  victimId: target.id,
                  victimName: target.name,
                  victimColor: target.color,
                  cause,
                  speedAtKill: impactSpeed,
                  timestamp: Date.now(),
                };
                world.killFeed = [killEntry, ...world.killFeed].slice(0, 6);
              }
            }

            if (isWsConnected && (target.id === selfIdRef.current || target.id === coopIdRef.current)) {
              sendWs({
                type: 'player:env_hit',
                playerId: target.id,
                cause,
                sourceId,
                sourceName,
                sourceColor,
                damage,
                fatal: isFatal,
                impactSpeed,
                x: Math.round(target.x),
                y: Math.round(target.y),
                vx: Math.round(target.vx),
                vy: Math.round(target.vy),
              });
            } else if (!isWsConnected) {
              peerSyncRef.current?.send({
                type: 'peer:combat_hit',
                senderId: selfIdRef.current,
                hitId: `env_${Date.now().toString(36)}_${target.id}`,
                targetId: target.id,
                attackerId: sourceId,
                x: Math.round(target.x),
                y: Math.round(target.y),
                vx: Math.round(target.vx),
                vy: Math.round(target.vy),
                damage,
                fatal: isFatal,
                color: sourceColor,
                cause,
                deathSound: target.deathSound,
                killEntry,
              });
            }
          };

          localPlayer.cheats = cheatsRef.current;
          renderer.stepLocalPlayerPhysics(
            localPlayer,
            dt,
            world.gravityStarEnabled,
            world.planets,
            world.asteroids,
            applyEnvironmentHit
          );

          // Prevent getting stuck inside the giant Sun's gravity well:
          // touching the Sun immediately teleports/respawns the ship to a safe orbit around the Sun.
          if (world.gravityStarEnabled && localPlayer.alive) {
            const hullRadius = (HULL_SPECS[localPlayer.hull] || HULL_SPECS.needle).radius;
            const distToSun = Math.hypot(
              localPlayer.x - GRAVITY_STAR_X,
              localPlayer.y - GRAVITY_STAR_Y
            );
            if (distToSun < GRAVITY_STAR_RADIUS + hullRadius - 4) {
              const nowMs = Date.now();
              const isDuplicateSunHit = nowMs - lastLocalSunHitAtRef.current < 1200;
              const wasInvulnerable = localPlayer.invulnerableTimer > 0;
              lastLocalSunHitAtRef.current = nowMs;

              const impactSpeed = Math.round(Math.hypot(localPlayer.vx, localPlayer.vy));
              renderer.addBurst(
                localPlayer.x,
                localPlayer.y,
                0,
                0,
                '#F59E0B',
                32,
                300,
                true
              );
              const safeOrbit = getSafeSunOrbitPoint();
              localPlayer.x = safeOrbit.x;
              localPlayer.y = safeOrbit.y;
              if (!localPlayer.warping) {
                localPlayer.vx = 0;
                localPlayer.vy = 0;
              }
              localPlayer.invulnerableTimer = 2.0;

              if (
                !wasInvulnerable &&
                !isDuplicateSunHit &&
                !localPlayer.cheats?.godMode &&
                !localPlayer.warping
              ) {
                soundEngine.playHit(true);
                deathSoundCtrlRef.current.playDeathSound(
                  localPlayer.deathSound,
                  isMutedRef.current
                );
                if (!isWsConnected) {
                  localPlayer.deaths += 1;
                  localPlayer.streak = 0;
                  localPlayer.hp = localPlayer.maxHp;
                  const killEntry: KillFeedEntry = {
                    id: `kill_sun_${Date.now().toString(36)}`,
                    killerId: 'STAR',
                    killerName: 'GRAVITY STAR',
                    killerColor: '#F59E0B',
                    victimId: localPlayer.id,
                    victimName: localPlayer.name,
                    victimColor: localPlayer.color,
                    cause: 'star',
                    speedAtKill: impactSpeed,
                    timestamp: nowMs,
                  };
                  world.killFeed = [killEntry, ...world.killFeed].slice(0, 6);
                }
              }

              // Immediately sync post-teleport safe orbit coordinates & zero velocity to server
              lastNetSend = now;
              if (!isWsConnected) {
                peerSyncRef.current?.send({
                  type: 'peer:player_state',
                  senderId: selfIdRef.current,
                  player: localPlayer,
                });
              }
              sendWs({
                type: 'player:input',
                playerId: selfIdRef.current,
                angle: localPlayer.angle,
                thrusting: localPlayer.thrusting,
                shooting: localPlayer.shooting,
                inputSource: sampled.inputSource,
                x: localPlayer.x,
                y: localPlayer.y,
                vx: localPlayer.vx,
                vy: localPlayer.vy,
                spectating: localPlayer.spectating,
                spectateTargetId: localPlayer.spectateTargetId,
                cursorX: localPlayer.cursorX,
                cursorY: localPlayer.cursorY,
                music: localPlayer.music,
                deathSound: localPlayer.deathSound,
                shipPng: localPlayer.shipPng,
                warping: localPlayer.warping,
              });

              renderer.addBurst(
                localPlayer.x,
                localPlayer.y,
                0,
                0,
                '#38BDF8',
                24,
                240,
                false
              );
            }
          }
        }

        // If running on static Vercel / Peer mode without WebSocket backend, step respawn, remote players, drones, & asteroids
        if (!isWsConnected) {
          peerSyncRef.current?.pruneStalePeers(world.players);
          if (!localPlayer.alive) {
            localPlayer.respawnTimer = Math.max(0, localPlayer.respawnTimer - dt);
            if (localPlayer.respawnTimer <= 0) {
              const spawnPt = getColocatedSpawnPoint(world.players.values(), localPlayer.id);
              const spec = HULL_SPECS[localPlayer.hull] || HULL_SPECS.needle;
              localPlayer.x = spawnPt.x;
              localPlayer.y = spawnPt.y;
              localPlayer.vx = 0;
              localPlayer.vy = 0;
              localPlayer.hp = spec.maxHp;
              localPlayer.maxHp = spec.maxHp;
              localPlayer.alive = true;
              localPlayer.invulnerableTimer = 2.0;
            }
          }

          if (world.asteroids.length < 192) {
            const extra = createInitialClientAsteroids(
              Math.min(32, 192 - world.asteroids.length),
              true
            );
            for (const ast of extra) {
              ast.id = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
              world.asteroids.push(ast);
            }
          }
          for (const ast of world.asteroids) {
            ast.x = wrapCoord(ast.x + ast.vx * dt, ARENA_WIDTH);
            ast.y = wrapCoord(ast.y + ast.vy * dt, ARENA_HEIGHT);
            ast.angle += ast.vAngle * dt;
          }

          for (const p of world.players.values()) {
            if (p.id === selfIdRef.current) continue;

            if (!p.alive) {
              p.respawnTimer = Math.max(0, p.respawnTimer - dt);
              if (p.respawnTimer <= 0 && p.isDrone) {
                const safePt = getSafeSunOrbitPoint();
                p.x = safePt.x;
                p.y = safePt.y;
                p.alive = true;
                p.hp = p.maxHp;
                p.invulnerableTimer = 0.5;
              }
              continue;
            }

            if (p.cheats?.godMode) {
              p.hp = p.maxHp;
              p.invulnerableTimer = 0;
            } else if (p.invulnerableTimer > 0) {
              p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);
            }

            if (p.isDrone) {
              stepAiDroneAutopilot(
                p,
                world.players,
                world.planets,
                world.gravityStarEnabled,
                dt,
                nowSec
              );
              renderer.stepLocalPlayerPhysics(
                p,
                dt,
                world.gravityStarEnabled,
                world.planets,
                world.asteroids,
                (target, cause, sourceId, sourceName, sourceColor, damage, fatal, impactSpeed) => {
                  target.hp = Math.max(0, target.hp - damage);
                  if (fatal || target.hp <= 0) {
                    target.alive = false;
                    target.hp = 0;
                    target.deaths += 1;
                    target.streak = 0;
                    target.respawnTimer = 2.8;
                    renderer.addBurst(
                      target.x,
                      target.y,
                      target.vx * 0.2,
                      target.vy * 0.2,
                      sourceColor,
                      28,
                      260,
                      true
                    );
                    const killEntry: KillFeedEntry = {
                      id: `kill_ai_env_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
                      killerId: sourceId,
                      killerName: sourceName,
                      killerColor: sourceColor,
                      victimId: target.id,
                      victimName: target.name,
                      victimColor: target.color,
                      cause,
                      speedAtKill: impactSpeed,
                      timestamp: Date.now(),
                    };
                    world.killFeed = [killEntry, ...world.killFeed].slice(0, 6);
                  }
                }
              );

              // Respawn AI drone at a safe orbit if pulled into the central Gravity Star
              if (world.gravityStarEnabled) {
                const dSpec = HULL_SPECS[p.hull] || HULL_SPECS.needle;
                const distToSun = Math.hypot(p.x - GRAVITY_STAR_X, p.y - GRAVITY_STAR_Y);
                if (distToSun < GRAVITY_STAR_RADIUS + dSpec.radius - 4) {
                  const safeOrbit = getSafeSunOrbitPoint();
                  p.x = safeOrbit.x;
                  p.y = safeOrbit.y;
                  p.vx = 0;
                  p.vy = 0;
                  p.hp = p.maxHp;
                  p.invulnerableTimer = 1.5;
                }
              }

              p.netTargetX = p.x;
              p.netTargetY = p.y;
              p.netTargetVx = p.vx;
              p.netTargetVy = p.vy;
              p.netTargetAngle = p.angle;

              // Allow nearby AI ships to actively fire weapons at players & rival ships in Vercel/client mode without flooding bullets off-screen
              if (p.shooting && world.bullets.length < 480) {
                const refX = localPlayer ? localPlayer.x : GRAVITY_STAR_X;
                const refY = localPlayer ? localPlayer.y : GRAVITY_STAR_Y;
                const distToViewX = Math.abs(shortestToroidalDelta(refX, p.x, ARENA_WIDTH));
                const distToViewY = Math.abs(shortestToroidalDelta(refY, p.y, ARENA_HEIGHT));
                if (distToViewX < 2400 && distToViewY < 2400) {
                  const dSpec = HULL_SPECS[p.hull] || HULL_SPECS.needle;
                  const aiCooldown = Math.max(dSpec.fireCooldown * 1.6, 0.42);
                  if (nowSec - (p.lastFireTime || 0) >= aiCooldown) {
                    p.lastFireTime = nowSec;
                    const aiSalvo = {
                      idPrefix: `ai_${p.id}_${Date.now().toString(36)}`,
                      ownerId: p.id,
                      ownerName: p.name,
                      color: p.color,
                      x: p.x,
                      y: p.y,
                      vx: p.vx,
                      vy: p.vy,
                      angle: p.angle,
                      noseDist: dSpec.radius + 10,
                      count: dSpec.spreadCount,
                      spreadAngle: dSpec.spreadAngle,
                      novaSpread: false,
                      baseMuzzle: dSpec.bulletSpeed,
                      damage: dSpec.bulletDamage,
                      ttl: 2.2,
                      isMissile: false,
                      targetIds: [],
                    };
                    world.bullets.push(...expandSalvoToBullets(aiSalvo));
                  }
                }
              }
            } else {
              if (p.shooting) {
                // Ensure remote player shooting is always visible even between /api/sector HTTP polls
                const rSpec = HULL_SPECS[p.hull] || HULL_SPECS.needle;
                const rCheats = p.cheats || DEFAULT_PLAYER_CHEATS;
                const rCooldown = rCheats.novaSpread || rCheats.rapidFire ? 0.08 : rSpec.fireCooldown;
                if (nowSec - (p.lastFireTime || 0) >= rCooldown * 1.25) {
                  p.lastFireTime = nowSec;
                  const count = rCheats.novaSpread ? 360 : rSpec.spreadCount;
                  const targetIds: string[] = [];
                  if (rCheats.homingMissiles) {
                    for (const tp of world.players.values()) {
                      if (tp.alive && tp.id !== p.id) targetIds.push(tp.id);
                    }
                  }
                  const remoteSalvo = {
                    idPrefix: `rem_${p.id}_${Date.now().toString(36)}`,
                    ownerId: p.id,
                    ownerName: p.name,
                    color: rCheats.homingMissiles ? '#F43F5E' : p.color,
                    x: p.x,
                    y: p.y,
                    vx: p.vx,
                    vy: p.vy,
                    angle: p.angle,
                    noseDist: rSpec.radius + 10,
                    count,
                    spreadAngle: rSpec.spreadAngle,
                    novaSpread: Boolean(rCheats.novaSpread),
                    baseMuzzle: rCheats.homingMissiles ? 860 : rSpec.bulletSpeed,
                    damage: rCheats.homingMissiles ? (rCheats.novaSpread ? 26 : 38) : rSpec.bulletDamage,
                    ttl: rCheats.homingMissiles ? 4.0 : 2.6,
                    isMissile: Boolean(rCheats.homingMissiles),
                    targetIds,
                  };
                  world.bullets.push(...expandSalvoToBullets(remoteSalvo));
                  if (world.bullets.length > 1800) {
                    world.bullets.splice(0, world.bullets.length - 1800);
                  }
                }
              }

              // Smooth 60fps dead-reckoning & exponential convergence hides choppy Vercel HTTP polls
              renderer.stepRemotePlayerSmooth(
                p,
                dt,
                world.gravityStarEnabled,
                world.planets
              );
            }
          }
        } else {
          // Smoothly dead-reckon & interpolate remote player positions between WebSocket snapshots
          for (const p of world.players.values()) {
            if (p.id !== selfIdRef.current) {
              renderer.stepRemotePlayerSmooth(
                p,
                dt,
                world.gravityStarEnabled,
                world.planets
              );
            }
          }
        }

        renderer.stepClientBulletsAndMissiles(
          world.bullets,
          world.players,
          world.asteroids,
          dt,
          world.planets,
          world.gravityStarEnabled
        );

        // Collision check when running on static Vercel / Peer mode without WebSocket backend
        if (!isWsConnected && world.bullets.length > 0) {
          for (let i = world.bullets.length - 1; i >= 0; i--) {
            const b = world.bullets[i];
            let bulletConsumed = false;

            // 1. Check bullet vs all alive players (both ship body AND 2x spectator mouse cursor!)
            const bulletOwner = world.players.get(b.ownerId);
            for (const target of world.players.values()) {
              if (
                !target.alive ||
                target.id === b.ownerId ||
                arePlayersTeammates(bulletOwner, target)
              ) {
                continue;
              }
              const tSpec = HULL_SPECS[target.hull] || HULL_SPECS.needle;
              const hitRadius = tSpec.radius + (b.isMissile ? 14 : 9);
              const dx = shortestToroidalDelta(b.x, target.x, ARENA_WIDTH);
              const dy = shortestToroidalDelta(b.y, target.y, ARENA_HEIGHT);
              const hitShip =
                Math.abs(dx) <= hitRadius &&
                Math.abs(dy) <= hitRadius &&
                dx * dx + dy * dy <= hitRadius * hitRadius;

              let hitCursor = false;
              if (
                !hitShip &&
                target.spectating &&
                typeof target.cursorX === 'number' &&
                typeof target.cursorY === 'number'
              ) {
                const cursorRadius = b.isMissile ? 40 : 34;
                const cdx = shortestToroidalDelta(b.x, target.cursorX, ARENA_WIDTH);
                const cdy = shortestToroidalDelta(b.y, target.cursorY, ARENA_HEIGHT);
                hitCursor =
                  Math.abs(cdx) <= cursorRadius &&
                  Math.abs(cdy) <= cursorRadius &&
                  cdx * cdx + cdy * cdy <= cursorRadius * cursorRadius;
              }

              if (hitShip || hitCursor) {
                world.bullets.splice(i, 1);
                bulletConsumed = true;

                const hitId = `hit_${b.id}`;
                const alreadyProcessed = peerSyncRef.current?.hasSeenHit(hitId) ?? false;
                const isDroneCombat = Boolean(bulletOwner?.isDrone || target.isDrone);

                if (
                  !alreadyProcessed &&
                  (b.ownerId === selfIdRef.current ||
                    target.id === selfIdRef.current ||
                    isDroneCombat)
                ) {
                  peerSyncRef.current?.markHitSeen(hitId);
                  if (!target.spectating && !target.warping) {
                    const knockback = b.isMissile ? 95 : 65;
                    target.vx += Math.cos(b.angle) * knockback;
                    target.vy += Math.sin(b.angle) * knockback;
                  }
                  if (
                    (target.invulnerableTimer <= 0 || target.spectating) &&
                    !target.cheats?.godMode &&
                    !target.warping
                  ) {
                    target.hp = Math.max(0, target.hp - b.damage);
                  }
                  if (target.id !== selfIdRef.current) {
                    lastDamagedRemoteAtRef.current.set(target.id, Date.now());
                  }

                  const attacker = world.players.get(b.ownerId);
                  const fatal = target.hp <= 0 && !target.cheats?.godMode && !target.warping;
                  let killEntry: KillFeedEntry | undefined;

                  if (fatal) {
                    target.alive = false;
                    target.hp = 0;
                    target.deaths += 1;
                    target.streak = 0;
                    target.respawnTimer = 2.8;
                    target.warping = false;
                    if (target.id === selfIdRef.current) {
                      warpSpeedActiveRef.current = false;
                      setWarpSpeedActive(false);
                    }
                    if (attacker && attacker.id !== target.id) {
                      attacker.kills += 1;
                      attacker.streak += 1;
                      attacker.score += 150;
                    }
                    killEntry = {
                      id: `kill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
                      killerId: b.ownerId,
                      killerName: attacker?.name || b.ownerName || 'PILOT',
                      killerColor: attacker?.color || b.color,
                      victimId: target.id,
                      victimName: target.name,
                      victimColor: target.color,
                      cause: b.isMissile ? 'missile' : 'laser',
                      speedAtKill: attacker ? Math.round(Math.hypot(attacker.vx, attacker.vy)) : 0,
                      timestamp: Date.now(),
                    };
                    world.killFeed = [killEntry, ...world.killFeed].slice(0, 6);
                    renderer.addBurst(
                      hitCursor ? b.x : target.x,
                      hitCursor ? b.y : target.y,
                      target.vx * 0.2,
                      target.vy * 0.2,
                      target.color,
                      32,
                      300,
                      true
                    );
                    soundEngine.playHit(true);
                    deathSoundCtrlRef.current.playDeathSound(
                      target.deathSound,
                      isMutedRef.current
                    );
                  } else {
                    renderer.hitFlashes.set(target.id, 0.12);
                    renderer.addBurst(b.x, b.y, 0, 0, b.color, 10, 160, false);
                    soundEngine.playHit(false);
                  }

                  peerSyncRef.current?.send({
                    type: 'peer:combat_hit',
                    senderId: selfIdRef.current,
                    hitId,
                    targetId: target.id,
                    attackerId: b.ownerId,
                    x: Math.round(b.x),
                    y: Math.round(b.y),
                    vx: Math.round(target.vx),
                    vy: Math.round(target.vy),
                    damage: b.damage,
                    fatal,
                    color: b.color,
                    cause: b.isMissile ? 'missile' : 'laser',
                    deathSound: target.deathSound,
                    killEntry,
                  });
                } else {
                  renderer.hitFlashes.set(target.id, 0.12);
                  renderer.addBurst(b.x, b.y, 0, 0, b.color, 8, 140, false);
                }
                break;
              }
            }

            if (bulletConsumed) continue;

            // 2. Check bullet vs asteroids
            for (let aIdx = world.asteroids.length - 1; aIdx >= 0; aIdx--) {
              const ast = world.asteroids[aIdx];
              const r = ast.radius + (b.isMissile ? 6 : 0);
              const dx = shortestToroidalDelta(b.x, ast.x, ARENA_WIDTH);
              if (Math.abs(dx) > r) continue;
              const dy = shortestToroidalDelta(b.y, ast.y, ARENA_HEIGHT);
              if (Math.abs(dy) > r) continue;
              if (dx * dx + dy * dy <= r * r) {
                world.bullets.splice(i, 1);
                ast.hp -= b.damage;
                ast.vx += Math.cos(b.angle) * 24;
                ast.vy += Math.sin(b.angle) * 24;
                renderer.addBurst(b.x, b.y, 0, 0, '#94A3B8', 8, 130, false);
                if (ast.hp <= 0) {
                  renderer.addBurst(ast.x, ast.y, ast.vx * 0.2, ast.vy * 0.2, '#94A3B8', 22, 220, true);
                  world.asteroids.splice(aIdx, 1);
                  if (b.ownerId === selfIdRef.current) {
                    localPlayer.score += 25;
                  }
                }
                break;
              }
            }
          }
        }

        // High-Force Ship-to-Ship Smash Collisions (>= 1,000 u/s) in Peer/Vercel Mode
        if (!isWsConnected && localPlayer.alive && !localPlayer.spectating) {
          const myRadius = (HULL_SPECS[localPlayer.hull] || HULL_SPECS.needle).radius;
          for (const other of world.players.values()) {
            if (other.id === localPlayer.id || !other.alive || other.spectating) continue;
            const otherRadius = (HULL_SPECS[other.hull] || HULL_SPECS.needle).radius;
            const minDist = myRadius + otherRadius;
            const dx = shortestToroidalDelta(other.x, localPlayer.x, ARENA_WIDTH);
            if (Math.abs(dx) > minDist) continue;
            const dy = shortestToroidalDelta(other.y, localPlayer.y, ARENA_HEIGHT);
            if (Math.abs(dy) > minDist) continue;
            const distSq = dx * dx + dy * dy;
            if (distSq <= minDist * minDist) {
              const relSpeed = Math.hypot(localPlayer.vx - other.vx, localPlayer.vy - other.vy);
              const mySpeed = Math.hypot(localPlayer.vx, localPlayer.vy);
              const otherSpeed = Math.hypot(other.vx, other.vy);
              const smashForce = Math.max(relSpeed, mySpeed, otherSpeed);

              if (smashForce >= SHIP_SMASH_SPEED_THRESHOLD) {
                const hitId = `smash_${Math.floor(Date.now() / 400)}_${[localPlayer.id, other.id].sort().join('_')}`;
                if (!(peerSyncRef.current?.hasSeenHit(hitId) ?? false)) {
                  peerSyncRef.current?.markHitSeen(hitId);
                  const impactSpeed = Math.round(smashForce);

                  if (!localPlayer.cheats?.godMode && !localPlayer.warping) {
                    localPlayer.alive = false;
                    localPlayer.hp = 0;
                    localPlayer.deaths += 1;
                    localPlayer.streak = 0;
                    localPlayer.respawnTimer = 2.8;
                  }
                  if (!other.cheats?.godMode && !other.warping) {
                    other.alive = false;
                    other.hp = 0;
                    other.deaths += 1;
                    other.streak = 0;
                    other.respawnTimer = 2.8;
                    lastDamagedRemoteAtRef.current.set(other.id, Date.now());
                  }

                  const killEntry: KillFeedEntry = {
                    id: `kill_smash_${Date.now().toString(36)}`,
                    killerId: localPlayer.id,
                    killerName: localPlayer.name,
                    killerColor: localPlayer.color,
                    victimId: other.id,
                    victimName: other.name,
                    victimColor: other.color,
                    cause: 'collision',
                    speedAtKill: impactSpeed,
                    timestamp: Date.now(),
                  };
                  world.killFeed = [killEntry, ...world.killFeed].slice(0, 6);

                  renderer.cameraShake = 18;
                  renderer.hitstopTimer = 0.055;
                  renderer.addBurst(
                    localPlayer.x,
                    localPlayer.y,
                    localPlayer.vx * 0.2,
                    localPlayer.vy * 0.2,
                    localPlayer.color,
                    38,
                    360,
                    true
                  );
                  renderer.addBurst(
                    other.x,
                    other.y,
                    other.vx * 0.2,
                    other.vy * 0.2,
                    other.color,
                    38,
                    360,
                    true
                  );
                  soundEngine.playHit(true);
                  deathSoundCtrlRef.current.playSmashSound(undefined, isMutedRef.current);

                  peerSyncRef.current?.send({
                    type: 'peer:combat_hit',
                    senderId: selfIdRef.current,
                    hitId,
                    targetId: other.id,
                    attackerId: localPlayer.id,
                    x: Math.round(other.x),
                    y: Math.round(other.y),
                    vx: Math.round(other.vx),
                    vy: Math.round(other.vy),
                    damage: 999,
                    fatal: true,
                    color: other.color,
                    cause: 'collision',
                    killEntry,
                  });
                  break;
                }
              } else {
                // Sub-1000 u/s elastic bump separation
                const dist = Math.max(1, Math.sqrt(distSq));
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist + 2;
                localPlayer.x = wrapCoord(localPlayer.x + nx * overlap * 0.6, ARENA_WIDTH);
                localPlayer.y = wrapCoord(localPlayer.y + ny * overlap * 0.6, ARENA_HEIGHT);
                localPlayer.vx += nx * 130;
                localPlayer.vy += ny * 130;
              }
            }
          }
        }

        const currentSpeed = Math.hypot(localPlayer.vx, localPlayer.vy);
        soundEngine.updateThrust(
          localPlayer.thrusting && !localPlayer.landedPlanetId,
          currentSpeed
        );

        const hullSpec = HULL_SPECS[localPlayer.hull] || HULL_SPECS.needle;
        const activeCheats = cheatsRef.current;

        if (!isWsConnected && localPlayer.shooting && localPlayer.alive) {
          const effCooldown =
            activeCheats.novaSpread || activeCheats.rapidFire ? 0 : hullSpec.fireCooldown;
          if (effCooldown === 0 || nowSec - lastOfflineShot >= effCooldown) {
            const prevShotTime = lastOfflineShot;
            lastOfflineShot = nowSec;
            localPlayer.lastFireTime = nowSec;
            const count = activeCheats.novaSpread ? 360 : hullSpec.spreadCount;
            const targetIds: string[] = [];
            if (activeCheats.homingMissiles) {
              for (const p of world.players.values()) {
                if (p.alive && p.id !== localPlayer.id) targetIds.push(p.id);
              }
            }
            const salvoAngle = activeCheats.novaSpread
              ? localPlayer.angle + ((nowSec * 9.5) % ((Math.PI * 2) / count))
              : localPlayer.angle;
            const salvo = {
              idPrefix: `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
              ownerId: localPlayer.id,
              ownerName: localPlayer.name,
              color: activeCheats.homingMissiles ? '#F43F5E' : localPlayer.color,
              x: localPlayer.x,
              y: localPlayer.y,
              vx: localPlayer.vx,
              vy: localPlayer.vy,
              angle: salvoAngle,
              noseDist: hullSpec.radius + 10,
              count,
              spreadAngle: hullSpec.spreadAngle,
              novaSpread: Boolean(activeCheats.novaSpread),
              baseMuzzle: activeCheats.homingMissiles ? 860 : hullSpec.bulletSpeed,
              damage: activeCheats.homingMissiles ? (activeCheats.novaSpread ? 26 : 38) : hullSpec.bulletDamage,
              ttl: activeCheats.homingMissiles ? (activeCheats.novaSpread ? 4.0 : 5.5) : 2.6,
              isMissile: Boolean(activeCheats.homingMissiles),
              targetIds,
            };
            world.bullets.push(...expandSalvoToBullets(salvo));
            if (world.bullets.length > 1800) {
              world.bullets.splice(0, world.bullets.length - 1800);
            }
            if (effCooldown > 0 || nowSec - prevShotTime >= 0.055) {
              peerSyncRef.current?.send({
                type: 'peer:salvo',
                senderId: selfIdRef.current,
                salvo,
              });
            }
          }
        }

        const sfxInterval =
          activeCheats.novaSpread || activeCheats.rapidFire
            ? 0.065
            : hullSpec.fireCooldown;
        if (localPlayer.shooting && localPlayer.alive && nowSec - lastLocalFire >= sfxInterval) {
          lastLocalFire = nowSec;
          if (activeCheats.homingMissiles) {
            soundEngine.playMissileLaunch();
          } else {
            soundEngine.playLaser(localPlayer.hull);
          }
        }

        if (sampled.warpJustPressed && localPlayer.alive && !isFreeCam) {
          handleToggleWarpSpeed();
        }

        // Compute world-space coordinates for the local mouse cursor when in Free-Cam / Spectator Mode
        if (isFreeCam) {
          let refCamX = freeCamPosRef.current.x;
          let refCamY = freeCamPosRef.current.y;
          if (spectateTargetIdRef.current) {
            const specTarget = world.players.get(spectateTargetIdRef.current);
            if (specTarget) {
              const curCam = renderer.getCameraPosition();
              refCamX = curCam.x;
              refCamY = curCam.y;
            }
          }
          localPlayer.cursorX = Math.round(
            wrapCoord(refCamX + (sampled.mouseScreenX - window.innerWidth * 0.5), ARENA_WIDTH)
          );
          localPlayer.cursorY = Math.round(
            wrapCoord(refCamY + (sampled.mouseScreenY - window.innerHeight * 0.5), ARENA_HEIGHT)
          );
        }

        // Attach live Music Box broadcast state, custom Death Sound (.OGG), and Admin Ship PNG to localPlayer
        localPlayer.music = musicBoxRef.current.getBroadcastMusicState();
        localPlayer.deathSound = deathSoundCtrlRef.current.selectedDeathSound;
        localPlayer.shipPng = selectedShipPngRef.current;
        localPlayer.warping = warpSpeedActiveRef.current && localPlayer.alive && !isFreeCam;

        if (now - lastNetSend >= 32) {
          lastNetSend = now;
          if (!isWsConnected) {
            peerSyncRef.current?.send({
              type: 'peer:player_state',
              senderId: selfIdRef.current,
              player: localPlayer,
            });
          }
          sendWs({
            type: 'player:input',
            playerId: selfIdRef.current,
            angle: localPlayer.angle,
            thrusting: localPlayer.thrusting,
            shooting: localPlayer.shooting,
            inputSource: sampled.inputSource,
            x: localPlayer.x,
            y: localPlayer.y,
            vx: localPlayer.vx,
            vy: localPlayer.vy,
            spectating: localPlayer.spectating,
            spectateTargetId: localPlayer.spectateTargetId,
            cursorX: localPlayer.cursorX,
            cursorY: localPlayer.cursorY,
            music: localPlayer.music,
            deathSound: localPlayer.deathSound,
            shipPng: localPlayer.shipPng,
            warping: localPlayer.warping,
            landedPlanetId: localPlayer.landedPlanetId,
            landedSurfaceAngle: localPlayer.landedSurfaceAngle,
            cheats: cheatsRef.current,
          });
        }

        if (coopActiveRef.current) {
          const p2 = world.players.get(coopIdRef.current);
          const pads = input.getConnectedGamepads();
          const pad2 = pads[1] || null;
          if (p2 && pad2) {
            const lx = pad2.axes[0] ?? 0;
            const ly = pad2.axes[1] ?? 0;
            if (Math.hypot(lx, ly) > input.getMapping().deadzone) {
              p2.angle = Math.atan2(ly, lx);
            }
            p2.thrusting = Boolean(pad2.buttons[7]?.pressed || pad2.buttons[0]?.pressed) && p2.alive;
            p2.shooting = Boolean(pad2.buttons[5]?.pressed || pad2.buttons[2]?.pressed) && p2.alive;
            renderer.stepLocalPlayerPhysics(
              p2,
              dt,
              world.gravityStarEnabled,
              world.planets,
              world.asteroids
            );
            if (now - lastNetSend < 18) {
              sendWs({
                type: 'player:input',
                playerId: coopIdRef.current,
                angle: p2.angle,
                thrusting: p2.thrusting,
                shooting: p2.shooting,
                inputSource: 'gamepad',
                x: p2.x,
                y: p2.y,
                vx: p2.vx,
                vy: p2.vy,
              });
            }
          }
        }
      } else {
        soundEngine.stopThrust();
        if (localPlayer) {
          localPlayer.music = musicBoxRef.current.getBroadcastMusicState();
        }
        for (const p of world.players.values()) {
          if (p.id !== selfIdRef.current) {
            renderer.stepRemotePlayerSmooth(
              p,
              dt,
              world.gravityStarEnabled,
              world.planets
            );
          }
        }
        renderer.stepClientBulletsAndMissiles(
          world.bullets,
          world.players,
          world.asteroids,
          dt,
          world.planets,
          world.gravityStarEnabled
        );
      }

      const cameraOverride = cheatsRef.current.freeCam
        ? {
            mode: spectateTargetIdRef.current ? ('spectate' as const) : ('freecam' as const),
            x: freeCamPosRef.current.x,
            y: freeCamPosRef.current.y,
            targetId: spectateTargetIdRef.current,
          }
        : null;

      renderer.render(
        ctx,
        window.innerWidth,
        window.innerHeight,
        dt,
        nowSec,
        localPlayer,
        world.players,
        world.bullets,
        world.asteroids,
        world.planets,
        world.gravityStarEnabled,
        sampled.stickVector,
        isTitle,
        cameraOverride
      );

      // Update spatial proximity audio from other ships playing music within MUSIC_HEARING_RADIUS (1800u)
      const camPos = renderer.getCameraPosition();
      const listenerX =
        localPlayer && !cheatsRef.current.freeCam ? localPlayer.x : camPos.x;
      const listenerY =
        localPlayer && !cheatsRef.current.freeCam ? localPlayer.y : camPos.y;
      musicBoxRef.current.syncRemotePlayersAudio(
        world.players,
        selfIdRef.current,
        listenerX,
        listenerY,
        isMutedRef.current,
        {
          localShipX: localPlayer?.x,
          localShipY: localPlayer?.y,
          isFreeCam: Boolean(cheatsRef.current.freeCam),
          yieldLocalCockpitToOtherTab:
            peerSyncRef.current?.isAnotherLocalTabFocused() ?? false,
        }
      );

      // Keep local cursor world position synced with rendered camera even while paused or right after camera lerp
      if (localPlayer && cheatsRef.current.freeCam) {
        localPlayer.cursorX = Math.round(
          wrapCoord(camPos.x + (sampled.mouseScreenX - window.innerWidth * 0.5), ARENA_WIDTH)
        );
        localPlayer.cursorY = Math.round(
          wrapCoord(camPos.y + (sampled.mouseScreenY - window.innerHeight * 0.5), ARENA_HEIGHT)
        );
      }

      const anyModalOpen =
        cheatMenuOpenRef.current ||
        controllerModalOpenRef.current ||
        deathSoundModalOpenRef.current ||
        shellStateRef.current === 'PAUSED';
      const hudSyncInterval = anyModalOpen ? 450 : 100;

      if (now - lastHudSync > hudSyncInterval) {
        lastHudSync = now;
        const landedPlanetObj =
          localPlayer && localPlayer.landedPlanetId
            ? world.planets.find((pl) => pl.id === localPlayer.landedPlanetId) || null
            : null;
        const speed = localPlayer
          ? landedPlanetObj
            ? 0
            : Math.round(Math.hypot(localPlayer.vx, localPlayer.vy))
          : 0;
        const allPlayers = Array.from(world.players.values());
        let totalDrones = 0;
        for (let i = 0; i < allPlayers.length; i++) {
          if (allPlayers[i].isDrone) totalDrones++;
        }
        const sortedPlayers = allPlayers
          .sort(
            (a, b) =>
              Number(Boolean(a.isDrone)) - Number(Boolean(b.isDrone)) ||
              b.kills - a.kills ||
              b.score - a.score
          )
          .slice(0, 36);
        const pads = input.getConnectedGamepads();

        setHud({
          hp: localPlayer ? Math.max(0, Math.round(localPlayer.hp)) : 100,
          maxHp: localPlayer ? localPlayer.maxHp : 100,
          speed,
          peakSpeed: localPlayer ? localPlayer.peakSpeed : 0,
          angleDeg: Math.round((sampled.angle * 180) / Math.PI),
          kills: localPlayer ? localPlayer.kills : 0,
          deaths: localPlayer ? localPlayer.deaths : 0,
          score: localPlayer ? localPlayer.score : 0,
          alive: localPlayer ? localPlayer.alive : true,
          respawnTimer: localPlayer ? Math.max(0, localPlayer.respawnTimer) : 0,
          inputSource: sampled.inputSource,
          gamepadConnected: sampled.gamepadConnected,
          gamepadName: sampled.gamepadName,
          stickActive: sampled.stickVector.active,
          playerCount: world.players.size,
          droneCount: totalDrones,
          leaderboard: sortedPlayers,
          killFeed: world.killFeed,
          gravityStarEnabled: world.gravityStarEnabled,
          pingMs: world.pingMs,
          secondPadAvailable: pads.length > 1,
          localCoopActive: coopActiveRef.current,
          landedPlanetName: landedPlanetObj ? landedPlanetObj.name : null,
        });
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      input.destroy();
      soundEngine.stopThrust();
    };
  }, [
    handleCycleSpectateTarget,
    handleStartGame,
    handleToggleWarpSpeed,
    handleTriggerCheatAction,
    sendWs,
  ]);

  const handleUpdateMapping = useCallback((next: ControllerMapping) => {
    setMapping(next);
    inputRef.current?.updateMapping(next);
  }, []);

  const handleCopyInvite = () => {
    navigator.clipboard?.writeText(window.location.origin + window.location.pathname).catch(() => {});
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const handleToggleMute = () => {
    const muted = soundEngine.toggleMute();
    setIsMuted(muted);
  };

  const handleSendChat = useCallback(() => {
    const parsed = parseChatInput(chatDraft);
    if (!parsed) {
      setChatDraft('');
      return;
    }

    const localPlayer = worldRef.current.players.get(selfIdRef.current);
    const senderName =
      (localPlayer?.name || pilotNameRef.current || 'PILOT').trim().slice(0, 16) || 'PILOT';
    const senderColor = localPlayer?.color || selectedColorRef.current || '#38BDF8';
    const msgId = `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const chatEntry: ChatMessage = {
      id: msgId,
      senderId: selfIdRef.current,
      senderName,
      senderColor,
      text: parsed.text,
      isServerWide: parsed.isServerWide,
      timestamp: Date.now(),
    };

    receiveChatMessage(chatEntry, true);

    peerSyncRef.current?.send({
      type: 'peer:chat',
      senderId: selfIdRef.current,
      message: chatEntry,
    });

    sendWs({
      type: 'chat:send',
      id: msgId,
      playerId: selfIdRef.current,
      senderName,
      senderColor,
      text: chatDraft.trim(),
    });

    setChatDraft('');
    chatInputRef.current?.blur();
  }, [chatDraft, receiveChatMessage, sendWs]);

  const getMomentumLabel = (spd: number) => {
    if (spd >= 2400) return 'RELATIVISTIC VECTOR';
    if (spd >= 1400) return 'HYPER-MOMENTUM';
    if (spd >= 700) return 'SUPERSONIC DRIFT';
    if (spd >= 250) return 'ORBITAL CRUISE';
    return 'SUB-ORBITAL';
  };

  const anyCheatActive =
    cheats.homingMissiles ||
    cheats.rapidFire ||
    cheats.novaSpread ||
    cheats.godMode ||
    cheats.freeCam;

  const spectatedPlayerObj = spectateTargetId
    ? worldRef.current.players.get(spectateTargetId) || null
    : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#060913] select-none">
      {/* Isolated 60fps Game Viewport Canvas */}
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
      />

      {/* ==================== GLOBAL SERVER-WIDE BIG TEXT BROADCAST BANNER ==================== */}
      {serverWideBanner && (
        <div className="fixed inset-x-0 top-16 md:top-20 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto relative max-w-4xl w-full rounded-2xl border-2 border-amber-400/90 bg-[#0B1120]/95 px-6 py-5 text-center shadow-[0_0_50px_rgba(245,158,11,0.45)] backdrop-blur-md">
            <div className="flex items-center justify-center gap-2 font-mono-tabular text-xs font-bold uppercase tracking-widest text-amber-400">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
              <span>SERVER-WIDE BROADCAST</span>
              <span className="text-slate-500">·</span>
              <span style={{ color: serverWideBanner.senderColor }}>
                {serverWideBanner.senderName}
              </span>
            </div>
            <div className="mt-2 font-display text-3xl sm:text-4xl md:text-5xl font-black tracking-wide text-white break-words drop-shadow-[0_4px_20px_rgba(245,158,11,0.5)]">
              {serverWideBanner.text}
            </div>
            <button
              onClick={() => setServerWideBanner(null)}
              className="absolute right-3 top-3 rounded-md border border-slate-700/80 bg-[#060913]/80 px-2 py-0.5 font-mono-tabular text-[10px] text-slate-400 hover:border-slate-500 hover:text-white"
              title="Dismiss announcement"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ==================== 1. TITLE SCREEN SHELL ==================== */}
      {shellState === 'TITLE_MENU' && (
        <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none">
          {/* Top Perimeter Bar on Title Screen */}
          <div className="flex items-center justify-between gap-4 pointer-events-auto">
            <div className="text-xs text-slate-400 font-mono-tabular">
              <span>ONLINE MULTIPLAYER ARENA</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-slate-200">{hud.playerCount} PILOTS ONLINE</span>
              <span className="mx-2 text-slate-600">·</span>
              <span>
                {hud.gamepadConnected ? 'CONTROLLER READY' : 'CONNECT CONTROLLER OR USE MOUSE/WASD'}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setDeathSoundModalOpen(true)}
                className="rounded-lg border border-amber-500/50 bg-[#0B1120] px-3.5 py-2 text-xs font-medium text-amber-300 transition-colors hover:border-amber-400 hover:text-white whitespace-nowrap shrink-0"
              >
                Death Sound (.OGG)
              </button>
              <button
                onClick={() => setControllerModalOpen(true)}
                className="rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0"
              >
                Controller & Stick Mapping
              </button>
              <button
                onClick={handleToggleMute}
                className="rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0"
              >
                {isMuted ? 'Audio Muted' : 'Audio On'}
              </button>
            </div>
          </div>

          {/* Center Hero Lockup over generous negative space */}
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center pointer-events-auto">
            {/* Bespoke Inline SVG Title Lockup */}
            <svg
              viewBox="0 0 560 96"
              className="h-16 md:h-22 w-auto mb-2"
              aria-label="Vector Spacewar"
            >
              <path
                d="M 40 78 Q 280 12 520 78"
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.5"
                strokeDasharray="4 6"
                opacity="0.55"
              />
              <g transform="translate(68, 52) rotate(-22)">
                <polygon
                  points="18,0 -12,-8 -7,0 -12,8"
                  fill="#0B1120"
                  stroke="#38BDF8"
                  strokeWidth="2"
                />
                <polygon points="-9,-3 -20,0 -9,3" fill="#F59E0B" />
              </g>
              <g transform="translate(492, 52) rotate(202)">
                <polygon
                  points="18,0 -10,-11 -14,-7 -8,0 -14,7 -10,11"
                  fill="#0B1120"
                  stroke="#F59E0B"
                  strokeWidth="2"
                />
              </g>
              <text
                x="280"
                y="58"
                textAnchor="middle"
                fill="#F8FAFC"
                fontFamily="Outfit, sans-serif"
                fontWeight="700"
                fontSize="44"
                letterSpacing="6"
              >
                VECTOR SPACEWAR
              </text>
              <text
                x="280"
                y="82"
                textAnchor="middle"
                fill="#94A3B8"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="600"
                fontSize="11"
                letterSpacing="3"
              >
                DIRECT JOYSTICK VECTOR AIM · UNCAPPED INFINITE MOMENTUM
              </text>
            </svg>

            {/* Launch Configuration Panel */}
            <div className="mt-4 w-full rounded-xl border border-slate-800/90 bg-[#0B1120]/95 p-5 text-left shadow-2xl">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-7">
                  <label className="block text-xs font-medium text-slate-400">
                    Pilot Callsign
                  </label>
                  <input
                    type="text"
                    maxLength={16}
                    value={pilotName}
                    onChange={(e) => setPilotName(e.target.value.toUpperCase())}
                    placeholder="PILOT-01"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#060913] px-3 py-2 font-mono-tabular text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="md:col-span-5">
                  <label className="block text-xs font-medium text-slate-400">
                    Vector Trace Color
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    {PLAYER_COLORS.slice(0, 6).map((c) => (
                      <button
                        key={c}
                        onClick={() => setSelectedColor(c)}
                        aria-label={`Select color ${c}`}
                        className={`h-7 w-7 rounded-md border transition-transform ${
                          selectedColor === c
                            ? 'scale-110 border-white'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Ship Hull Selector */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Select Spacecraft Hull</span>
                  <span className="font-mono-tabular text-slate-500">
                    Zero Friction · Infinite Velocity Accumulation
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  {HULL_LIST.map((hullKey) => {
                    const spec = HULL_SPECS[hullKey];
                    const active = selectedHull === hullKey;
                    return (
                      <button
                        key={hullKey}
                        onClick={() => setSelectedHull(hullKey)}
                        className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? 'border-amber-500 bg-[#111C33] text-white'
                            : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-display text-sm font-bold text-white">
                            {spec.name}
                          </span>
                          <svg viewBox="-22 -22 44 44" className="h-7 w-7 shrink-0">
                            {hullKey === 'needle' && (
                              <polygon
                                points="16,0 -11,-7 -6,0 -11,7"
                                fill="none"
                                stroke={active ? selectedColor : '#64748B'}
                                strokeWidth="2.2"
                              />
                            )}
                            {hullKey === 'wedge' && (
                              <polygon
                                points="14,0 -6,-12 -12,-9 -8,0 -12,9 -6,12"
                                fill="none"
                                stroke={active ? selectedColor : '#64748B'}
                                strokeWidth="2.2"
                              />
                            )}
                            {hullKey === 'interceptor' && (
                              <polygon
                                points="17,0 0,-5 3,-11 -12,-6 -8,0 -12,6 3,11 0,5"
                                fill="none"
                                stroke={active ? selectedColor : '#64748B'}
                                strokeWidth="2.2"
                              />
                            )}
                            {hullKey === 'disc' && (
                              <g
                                fill="none"
                                stroke={active ? selectedColor : '#64748B'}
                                strokeWidth="2.2"
                              >
                                <circle cx="0" cy="0" r="10" />
                                <polyline points="4,-4 16,0 4,4" />
                              </g>
                            )}
                          </svg>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                          {spec.description}
                        </p>
                        <div className="mt-2 font-mono-tabular text-[11px] text-slate-400">
                          Accel {spec.thrustAccel} · HP {spec.maxHp}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary Launch Row */}
              <div className="mt-5 flex flex-col items-center justify-between gap-4 border-t border-slate-800/80 pt-4 sm:flex-row">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{hud.playerCount} Pilots in Sector</span>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={handleCopyInvite}
                    className="font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
                  >
                    {copiedInvite ? 'Invite Link Copied!' : 'Copy Invite Link'}
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => setDeathSoundModalOpen(true)}
                    className="font-medium text-cyan-400 hover:text-cyan-300 whitespace-nowrap shrink-0"
                  >
                    Custom Death Sound (.OGG)
                  </button>
                </div>

                <button
                  onClick={handleStartGame}
                  className="w-full sm:w-auto rounded-lg bg-amber-500 px-7 py-3 font-display text-sm font-bold tracking-wide text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  Launch Ship · Enter / Start
                </button>
              </div>
            </div>
          </div>

          {/* Single Flat Control-Hint Line at Bottom */}
          <div className="text-center font-mono-tabular text-xs text-slate-400 pointer-events-auto">
            Joystick Points Exact Ship Direction · RT / A Build Infinite Momentum · RB / X Fire · F / R3 Auto-Fire · Y / E Warp · T / Enter Chat · Esc Pause
          </div>
        </div>
      )}

      {/* ==================== 2. ACTIVE PLAY HUD (LOW-OCCLUSION PERIMETER) ==================== */}
      {shellState !== 'TITLE_MENU' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-5">
          {/* Top Perimeter Row */}
          <div className="flex items-start justify-between gap-4">
            {/* Top-Left Telemetry Cluster: Hull Integrity, Infinite Momentum & Direct Joystick Vector */}
            <div className="rounded-lg border border-slate-800/80 bg-[#0B1120]/90 px-4 py-3">
              <div className="flex items-center gap-2.5 pointer-events-auto">
                {isEditingOwnName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={16}
                      autoFocus
                      value={ownNameDraft}
                      onChange={(e) => setOwnNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameOwnShip(ownNameDraft);
                        if (e.key === 'Escape') setIsEditingOwnName(false);
                      }}
                      className="w-32 rounded border border-amber-500 bg-[#060913] px-2 py-0.5 font-mono-tabular text-xs text-white focus:outline-none"
                    />
                    <button
                      onClick={() => handleRenameOwnShip(ownNameDraft)}
                      className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-display text-sm font-bold text-white">
                      {worldRef.current.players.get(selfIdRef.current)?.name || pilotName}
                    </span>
                    <button
                      onClick={() => {
                        const current =
                          worldRef.current.players.get(selfIdRef.current)?.name || pilotName;
                        setOwnNameDraft(current);
                        setIsEditingOwnName(true);
                      }}
                      className="rounded border border-slate-700/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0"
                    >
                      Rename
                    </button>
                  </>
                )}
                <span className="text-slate-600">·</span>
                <span className="font-mono-tabular text-xs text-amber-400">
                  {roomId}
                </span>
                <span className="text-slate-600">·</span>
                <span className="font-mono-tabular text-xs text-slate-300">
                  HP: {hud.hp}/{hud.maxHp}
                </span>
              </div>

              {/* Hull Health Bar */}
              <div className="mt-1.5 h-1.5 w-52 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full transition-transform duration-100 origin-left"
                  style={{
                    backgroundColor:
                      hud.hp / hud.maxHp > 0.5
                        ? selectedColor
                        : hud.hp / hud.maxHp > 0.25
                        ? '#F59E0B'
                        : '#F43F5E',
                    transform: `scaleX(${Math.max(0, Math.min(1, hud.hp / hud.maxHp))})`,
                  }}
                />
              </div>

              {/* Infinite Momentum Readout */}
              <div className="mt-2.5 flex items-baseline gap-3 font-mono-tabular">
                <div>
                  <span className="text-[11px] text-slate-400">MOMENTUM </span>
                  <span className="text-base font-bold text-white">
                    {hud.speed.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400"> u/s</span>
                </div>
                <span className="text-slate-600">·</span>
                <div className="text-xs text-slate-400">
                  PEAK <span className="text-slate-200">{hud.peakSpeed.toLocaleString()} u/s</span>
                </div>
              </div>

              {/* Direct Vector Heading & Input Status */}
              <div className="mt-1 font-mono-tabular text-[11px] text-slate-400">
                <span className={hud.landedPlanetName ? 'font-bold text-emerald-400' : ''}>
                  {hud.landedPlanetName
                    ? `ANCHORED: ${hud.landedPlanetName}`
                    : getMomentumLabel(hud.speed)}
                </span>
                <span className="mx-1.5 text-slate-600">·</span>
                <span className="text-slate-300">HDG {hud.angleDeg}°</span>
                <span className="mx-1.5 text-slate-600">·</span>
                <button
                  onClick={() =>
                    setAutoFire((prev) => {
                      const next = !prev;
                      autoFireRef.current = next;
                      return next;
                    })
                  }
                  className={`pointer-events-auto font-semibold transition-colors ${
                    autoFire ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  AUTO-FIRE (F): {autoFire ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Dedicated Warp Speed Toggle Button (Invincible while warping; click again to stop at 0 u/s) */}
              <div className="mt-2 pointer-events-auto">
                <button
                  onClick={handleToggleWarpSpeed}
                  disabled={!hud.alive || cheats.freeCam}
                  className={`w-full rounded-md border px-3 py-1.5 font-mono-tabular text-xs font-bold transition-colors whitespace-nowrap ${
                    warpSpeedActive
                      ? 'border-cyan-300 bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-lg shadow-cyan-500/25'
                      : 'border-cyan-500/50 bg-[#060913] text-cyan-300 hover:border-cyan-400 hover:text-white disabled:opacity-40'
                  }`}
                >
                  {warpSpeedActive
                    ? '⏹ STOP WARP (ZERO MOMENTUM) · [INVINCIBLE]'
                    : '⚡ ENGAGE WARP SPEED (E) · INVINCIBLE'}
                </button>
              </div>

              {/* Active Cheats Readout */}
              {anyCheatActive && (
                <div className="mt-1.5 font-mono-tabular text-[11px] text-rose-400">
                  {[
                    cheats.homingMissiles && 'HOMING MISSILES',
                    cheats.rapidFire && 'RAPID FIRE',
                    cheats.novaSpread && '360° NOVA',
                    cheats.godMode && 'GOD MODE',
                    cheats.freeCam && (spectateTargetId ? 'SPECTATING' : 'FREE-CAM'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}

              {/* Nearby Ship Proximity Music Readout */}
              {musicBox.nearbyStreams.length > 0 && (
                <div className="mt-1.5 font-mono-tabular text-[11px] text-amber-400">
                  {musicBox.nearbyStreams.slice(0, 2).map((s) => (
                    <div key={s.playerId} className="truncate max-w-[230px]">
                      ♪ {s.trackTitle} · <span style={{ color: s.playerColor }}>{s.playerName}</span> ({s.distance}m)
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top-Center Detached Camera / Spectator Control Banner */}
            {cheats.freeCam && (
              <div className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-xl border border-cyan-500/50 bg-[#0B1120]/95 px-4 py-2.5 shadow-2xl">
                <div className="flex items-center gap-2 text-xs font-mono-tabular">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="font-display font-bold text-cyan-300">
                    {spectatedPlayerObj
                      ? `SPECTATING: ${spectatedPlayerObj.name}`
                      : 'FREE-CAM DETACHED'}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300 text-[11px]">
                    Other players can see your mouse cursor!
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <button
                    onClick={() => handleCycleSpectateTarget(-1)}
                    className="rounded border border-slate-700 bg-[#060913] px-2.5 py-1 font-mono-tabular text-[11px] text-slate-200 hover:border-cyan-400 hover:text-white whitespace-nowrap shrink-0"
                  >
                    ◀ Prev Player ([)
                  </button>
                  <button
                    onClick={() => handleSelectSpectateTarget(null)}
                    className={`rounded border px-2.5 py-1 font-mono-tabular text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                      !spectateTargetId
                        ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                        : 'border-slate-700 bg-[#060913] text-slate-300 hover:border-cyan-400 hover:text-white'
                    }`}
                  >
                    Free-Fly (WASD / Shift)
                  </button>
                  <button
                    onClick={() => handleCycleSpectateTarget(1)}
                    className="rounded border border-slate-700 bg-[#060913] px-2.5 py-1 font-mono-tabular text-[11px] text-slate-200 hover:border-cyan-400 hover:text-white whitespace-nowrap shrink-0"
                  >
                    Next Player (]) ▶
                  </button>
                  <button
                    onClick={() => {
                      handleSelectSpectateTarget(null);
                      handleUpdateCheats({ ...cheats, freeCam: false });
                    }}
                    className="rounded bg-rose-600 px-2.5 py-1 font-display text-[11px] font-bold text-white hover:bg-rose-500 whitespace-nowrap shrink-0"
                  >
                    Reconnect Ship
                  </button>
                </div>
              </div>
            )}

            {/* Top-Right Perimeter Cluster: Live Multiplayer Roster & Controls */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="rounded-lg border border-slate-800 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedInvite ? 'Sector Link Copied!' : `Invite Players (${hud.playerCount} Online)`}
                </button>
                {(hud.secondPadAvailable || hud.localCoopActive) && (
                  <button
                    type="button"
                    onClick={handleToggleCoopGamepad}
                    className="rounded-lg border border-slate-800 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:border-emerald-500/60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {hud.localCoopActive ? 'Remove 2nd Controller' : '+ Join 2nd Controller'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current?.clearHeldInputs();
                    setDeathSoundModalOpen(true);
                  }}
                  className="rounded-lg border border-amber-500/40 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-amber-300 hover:border-amber-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Death Sound (.OGG)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current?.clearHeldInputs();
                    setControllerModalOpen(true);
                  }}
                  className="rounded-lg border border-slate-800 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-amber-500/60 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Controller Setup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current?.clearHeldInputs();
                    setCheatMenuOpen((prev) => !prev);
                  }}
                  className="rounded-lg border border-rose-500/40 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-rose-300 hover:border-rose-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Cheats (K)
                </button>
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="rounded-lg border border-slate-800 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current?.clearHeldInputs();
                    setShellState((prev) => (prev === 'PAUSED' ? 'PLAYING' : 'PAUSED'));
                  }}
                  className="rounded-lg border border-slate-800 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Pause (Esc)
                </button>
              </div>

              {/* Compact Sector Leaderboard */}
              <div className="w-64 rounded-lg border border-slate-800/80 bg-[#0B1120]/90 px-3.5 py-2.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>SECTOR PILOTS ({hud.playerCount})</span>
                  <span className="font-mono-tabular">K / D · VELOCITY</span>
                </div>
                <div className="mt-1.5 space-y-1 pointer-events-auto">
                  {hud.leaderboard.slice(0, 6).map((p) => {
                    const pSpeed = Math.round(Math.hypot(p.vx, p.vy));
                    const isMe = p.id === selfIdRef.current;
                    const isSpectatingThis = cheats.freeCam && spectateTargetId === p.id;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-1 text-xs font-mono-tabular"
                      >
                        <span
                          className="truncate max-w-[105px] font-medium"
                          style={{ color: p.color }}
                        >
                          {p.name}
                          {isMe ? ' (YOU)' : ''}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-slate-300">
                            {p.kills}/{p.deaths} · {pSpeed} u/s
                          </span>
                          {!isMe && (
                            <button
                              onClick={() => {
                                if (isSpectatingThis) {
                                  handleSelectSpectateTarget(null);
                                } else {
                                  handleSelectSpectateTarget(p.id);
                                  if (!cheats.freeCam) {
                                    handleUpdateCheats({ ...cheats, freeCam: true });
                                  }
                                }
                              }}
                              title={isSpectatingThis ? 'Stop spectating this ship' : `Spectate ${p.name}`}
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                                isSpectatingThis
                                  ? 'border-cyan-400 bg-cyan-500/25 text-cyan-300'
                                  : 'border-slate-700 bg-[#060913] text-slate-400 hover:border-cyan-500/60 hover:text-white'
                              }`}
                            >
                              {isSpectatingThis ? 'Viewing' : 'View'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Perimeter Row: Sector Text Chat, Combat Kill Feed & Respawn Notice */}
          <div className="flex items-end justify-between gap-4">
            {/* Bottom-Left: Sector Text Chat + Kill Feed */}
            <div className="flex flex-col gap-2.5">
              {/* Kill Feed */}
              {hud.killFeed.length > 0 && (
                <div className="space-y-1">
                  {hud.killFeed.slice(0, 4).map((entry) => (
                    <div
                      key={entry.id}
                      className="font-mono-tabular text-xs text-slate-300"
                    >
                      <span style={{ color: entry.killerColor }}>{entry.killerName}</span>
                      <span className="mx-1.5 text-slate-500">
                        {entry.cause === 'collision'
                          ? 'smashed into (1000+ u/s)'
                          : entry.cause === 'missile'
                          ? 'locked & destroyed'
                          : 'destroyed'}
                      </span>
                      <span style={{ color: entry.victimColor }}>{entry.victimName}</span>
                      <span className="mx-1.5 text-slate-600">·</span>
                      <span className="text-slate-400">{entry.speedAtKill} u/s</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Live Sector Text Chat */}
              <div className="pointer-events-auto w-80 sm:w-96 rounded-xl border border-slate-800/90 bg-[#0B1120]/90 p-2.5 shadow-xl backdrop-blur-sm">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80 text-[11px] font-mono-tabular">
                  <span className="font-semibold text-slate-300">
                    SECTOR CHAT ({roomId})
                  </span>
                </div>

                {/* Chat Message History */}
                <div
                  ref={chatListRef}
                  className="mt-1.5 max-h-28 overflow-y-auto space-y-1 pr-1 font-mono-tabular text-xs"
                >
                  {chatMessages.length === 0 ? (
                    <div className="py-1 text-[11px] text-slate-500">
                      Press <span className="text-slate-300">T</span> or <span className="text-slate-300">Enter</span> to chat.
                    </div>
                  ) : (
                    chatMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`leading-snug break-words ${
                          m.isServerWide
                            ? 'rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-200 font-semibold'
                            : 'text-slate-200'
                        }`}
                      >
                        {m.isServerWide && (
                          <span className="mr-1.5 rounded bg-amber-500 px-1 py-0.2 text-[9px] font-bold uppercase text-slate-950">
                            SERVER-WIDE
                          </span>
                        )}
                        <span
                          className="font-bold"
                          style={{ color: m.senderColor || '#38BDF8' }}
                        >
                          {m.senderName}:
                        </span>{' '}
                        <span>{m.text}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Chat Input Row */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChat();
                  }}
                  className="mt-2 flex items-center gap-1.5"
                >
                  <input
                    ref={chatInputRef}
                    type="text"
                    maxLength={240}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        chatInputRef.current?.blur();
                      }
                    }}
                    placeholder="Type a message..."
                    className={`w-full rounded-lg border px-2.5 py-1.5 font-mono-tabular text-xs text-white focus:outline-none ${
                      /^\/server-wide\s+/i.test(chatDraft)
                        ? 'border-amber-400 bg-amber-950/30 text-amber-200'
                        : 'border-slate-700 bg-[#060913] focus:border-cyan-400'
                    }`}
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-amber-500 px-3 py-1.5 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>

            {/* Respawn Banner when Destroyed */}
            {!hud.alive && (
              <div className="pointer-events-auto flex items-center gap-4 rounded-xl border border-rose-500/40 bg-[#0B1120]/95 px-5 py-3 shadow-xl">
                <div>
                  <div className="font-display text-sm font-bold text-rose-400">
                    HULL DESTROYED · PEAK MOMENTUM {hud.peakSpeed.toLocaleString()} u/s
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-400">
                    Auto-redeploying in {hud.respawnTimer.toFixed(1)}s or deploy immediately
                  </div>
                </div>
                <button
                  onClick={handleRespawnNow}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  Deploy Now
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 3. PAUSE / SECTOR OPTIONS MODAL ==================== */}
      {shellState === 'PAUSED' && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShellState('PLAYING');
          }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#060913]/85 p-4 pointer-events-auto"
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-slate-800 bg-[#0B1120] p-6 text-slate-100 shadow-2xl pointer-events-auto"
          >
            <h2 className="font-display text-xl font-bold text-white">
              Tactical Systems Paused
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Multiplayer sector <span className="font-mono-tabular text-amber-400">{roomId}</span> continues in real time.
            </p>

            <div className="mt-5 space-y-3 border-y border-slate-800 py-4 text-xs font-mono-tabular">
              <div>
                <label className="block text-[11px] font-sans font-medium text-slate-400">
                  Rename Your Ship
                </label>
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="text"
                    maxLength={16}
                    value={pilotName}
                    onChange={(e) => handleRenameOwnShip(e.target.value)}
                    placeholder="Ship Name"
                    className="w-full rounded-lg border border-slate-700 bg-[#060913] px-3 py-1.5 font-mono-tabular text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-slate-400">Current Momentum</span>
                <span className="text-white">{hud.speed.toLocaleString()} u/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Session Peak Velocity</span>
                <span className="text-amber-400">{hud.peakSpeed.toLocaleString()} u/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Combat Record</span>
                <span className="text-white">
                  {hud.kills} Kills · {hud.deaths} Deaths · {hud.score} Pts
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400">Central Gravity Star</span>
                <button
                  type="button"
                  onClick={() =>
                    sendWs({
                      type: 'room:toggle_star',
                      enabled: !hud.gravityStarEnabled,
                    })
                  }
                  className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {hud.gravityStarEnabled ? 'Active (1962 Classic)' : 'Disabled'}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setShellState('PLAYING')}
                className="w-full rounded-lg bg-amber-500 py-2.5 font-display text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Resume Combat (Esc)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShellState('PLAYING');
                  setCheatMenuOpen(true);
                }}
                className="w-full rounded-lg border border-rose-500/50 py-2.5 text-xs font-medium text-rose-300 hover:border-rose-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                Cheat & Experimental Weapons Menu (K)
              </button>
              <button
                type="button"
                onClick={() => setDeathSoundModalOpen(true)}
                className="w-full rounded-lg border border-amber-500/50 py-2.5 text-xs font-medium text-amber-300 hover:border-amber-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                Custom Death & Smash Sounds (.OGG)
              </button>
              <button
                type="button"
                onClick={() => setControllerModalOpen(true)}
                className="w-full rounded-lg border border-slate-700 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Controller & Joystick Vector Mapping
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cheatsRef.current.freeCam) {
                    handleUpdateCheats({ ...cheatsRef.current, freeCam: false });
                  }
                  handleSelectSpectateTarget(null);
                  worldRef.current.players.delete(selfIdRef.current);
                  peerSyncRef.current?.send({
                    type: 'peer:player_leave',
                    senderId: selfIdRef.current,
                    playerId: selfIdRef.current,
                  });
                  sendWs({ type: 'player:leave', playerId: selfIdRef.current });
                  setShellState('TITLE_MENU');
                }}
                className="w-full rounded-lg border border-slate-800 py-2.5 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Return to Hangar Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. CONTROLLER MAPPING MODAL ==================== */}
      <ControllerModal
        isOpen={controllerModalOpen}
        onClose={() => setControllerModalOpen(false)}
        mapping={mapping}
        onUpdateMapping={handleUpdateMapping}
      />

      {/* ==================== 4B. PUBLIC DEATH SOUND (.OGG) SELECTOR MODAL ==================== */}
      <DeathSoundModal
        isOpen={deathSoundModalOpen}
        onClose={() => setDeathSoundModalOpen(false)}
        controller={deathSoundCtrl}
      />

      {/* ==================== 5. FLOATING MUSIC BOX WINDOW WHILE FLYING ==================== */}
      {shellState !== 'TITLE_MENU' && (
        <FloatingMusicBoxWindow controller={musicBox} />
      )}

      {/* ==================== 6. CHEAT MENU MODAL (PRESS K) ==================== */}
      <CheatMenuModal
        isOpen={cheatMenuOpen}
        onClose={() => setCheatMenuOpen(false)}
        cheats={cheats}
        onUpdateCheats={handleUpdateCheats}
        onTriggerAction={handleTriggerCheatAction}
        playerCount={hud.playerCount}
        droneCount={hud.droneCount}
        players={hud.leaderboard}
        selfId={selfIdRef.current}
        onCheatRenameShip={handleCheatRenameShip}
        musicBox={musicBox}
        spectateTargetId={spectateTargetId}
        onSelectSpectateTarget={handleSelectSpectateTarget}
        warpSpeedActive={warpSpeedActive}
        onToggleWarpSpeed={handleToggleWarpSpeed}
        selectedShipPng={selectedShipPng}
        onSelectShipPng={handleSelectShipPng}
      />
    </div>
  );
}
