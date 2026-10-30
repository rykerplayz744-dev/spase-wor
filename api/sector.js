// Vercel Serverless Function for cross-browser / cross-device Sector-01 state & combat event relay
const activePlayers = new Map();
const sharedDrones = new Map();
const recentEvents = [];
let eventSeq = 1;

export default function handler(req, res) {
  const now = Date.now();

  // Evict stale human players (> 6 seconds without heartbeat)
  for (const [id, entry] of activePlayers.entries()) {
    if (now - entry.updatedAt > 6000) {
      activePlayers.delete(id);
    }
  }

  // Evict old events (> 8 seconds old)
  while (recentEvents.length > 0 && now - recentEvents[0].timestamp > 8000) {
    recentEvents.shift();
  }

  let sinceSeq = 0;

  if (req.method === 'POST' && req.body) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (typeof body.sinceSeq === 'number') {
      sinceSeq = body.sinceSeq;
    }

    if (body.player && typeof body.player.id === 'string') {
      // If another stale entry (> 1.5s without heartbeat) has the exact same name (from a page reload), remove the ghost copy
      for (const [existingId, entry] of activePlayers.entries()) {
        if (
          existingId !== body.player.id &&
          entry.player &&
          entry.player.name === body.player.name &&
          now - entry.updatedAt > 1500
        ) {
          activePlayers.delete(existingId);
        }
      }

      const prevEntry = activePlayers.get(body.player.id);
      const incomingMusic = body.player.music;
      if (incomingMusic && incomingMusic.isPlaying) {
        const prevMusic = prevEntry?.player?.music;
        const reportedTrackTime = Math.max(0, Number(incomingMusic.trackTime) || 0);
        const computedStartMs = now - Math.round(reportedTrackTime * 1000);
        const isSameTrack =
          prevMusic &&
          prevMusic.isPlaying &&
          prevMusic.filename === incomingMusic.filename;
        const prevStartMs = prevMusic?.startedAtServerMs;
        const didSeekOrRestart =
          !isSameTrack ||
          typeof prevStartMs !== 'number' ||
          Math.abs(computedStartMs - prevStartMs) > 650;

        const authoritativeStartMs = didSeekOrRestart ? computedStartMs : prevStartMs;
        body.player.music = {
          ...incomingMusic,
          startedAtServerMs: authoritativeStartMs,
          trackTime: Math.max(0, Number(((now - authoritativeStartMs) / 1000).toFixed(3))),
          updatedAt: now,
        };
      } else {
        body.player.music = null;
      }

      activePlayers.set(body.player.id, {
        player: body.player,
        updatedAt: now,
      });
    }

    // Relay outgoing combat / salvo / cheat / rename events to all other players in SECTOR-01
    if (Array.isArray(body.events)) {
      for (const pkt of body.events) {
        if (!pkt || typeof pkt.type !== 'string') continue;

        if (pkt.type === 'peer:player_leave' && typeof pkt.playerId === 'string') {
          activePlayers.delete(pkt.playerId);
        }

        // Maintain shared target drones on the relay (capped at 100 so serverless polls stay fast on Chromebooks)
        if (pkt.type === 'peer:cheat_action') {
          if (Array.isArray(pkt.spawnedDrones)) {
            for (const d of pkt.spawnedDrones) {
              if (d && typeof d.id === 'string') {
                sharedDrones.set(d.id, d);
              }
            }
            while (sharedDrones.size > 100) {
              const oldestKey = sharedDrones.keys().next().value;
              if (!oldestKey) break;
              sharedDrones.delete(oldestKey);
            }
          } else if (pkt.action === 'clear_drones') {
            sharedDrones.clear();
          }
        } else if (pkt.type === 'peer:combat_hit' && pkt.targetId && sharedDrones.has(pkt.targetId)) {
          const drone = sharedDrones.get(pkt.targetId);
          if (drone) {
            drone.hp = Math.max(0, (drone.hp || 100) - (pkt.damage || 0));
            if (pkt.fatal || drone.hp <= 0) {
              sharedDrones.delete(pkt.targetId);
            }
          }
        }

        recentEvents.push({
          seq: eventSeq++,
          timestamp: now,
          packet: pkt,
        });
        if (recentEvents.length > 300) {
          recentEvents.shift();
        }
      }
    }
  }

  // If no human players are active in the sector, clear leftover drones so fresh sessions start clean
  if (activePlayers.size === 0 && sharedDrones.size > 0) {
    sharedDrones.clear();
  }

  const players = [];
  for (const entry of activePlayers.values()) {
    const p = entry.player;
    if (p && p.music && p.music.isPlaying && typeof p.music.startedAtServerMs === 'number') {
      p.music = {
        ...p.music,
        trackTime: Math.max(0, Number(((now - p.music.startedAtServerMs) / 1000).toFixed(3))),
        updatedAt: now,
      };
    }
    players.push(p);
  }
  // Only send the full sharedDrones list on initial join (sinceSeq === 0); subsequent polls receive drone spawns/clears via newEvents
  if (sinceSeq === 0) {
    for (const drone of sharedDrones.values()) {
      players.push(drone);
    }
  }

  const newEvents =
    sinceSeq > 0
      ? recentEvents.filter((e) => e.seq > sinceSeq).map((e) => e.packet)
      : [];

  res.status(200).json({
    roomId: 'SECTOR-01',
    serverTime: now,
    latestSeq: eventSeq - 1,
    players,
    events: newEvents,
  });
}
