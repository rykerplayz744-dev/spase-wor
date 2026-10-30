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
      activePlayers.set(body.player.id, {
        player: body.player,
        updatedAt: now,
      });
    }

    // Relay outgoing combat / salvo / cheat / rename events to all other players in SECTOR-01
    if (Array.isArray(body.events)) {
      for (const pkt of body.events) {
        if (!pkt || typeof pkt.type !== 'string') continue;

        // Maintain shared target drones on the relay as well
        if (pkt.type === 'peer:cheat_action') {
          if (Array.isArray(pkt.spawnedDrones)) {
            for (const d of pkt.spawnedDrones) {
              if (d && typeof d.id === 'string') {
                sharedDrones.set(d.id, d);
              }
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

  const players = [];
  for (const entry of activePlayers.values()) {
    players.push(entry.player);
  }
  for (const drone of sharedDrones.values()) {
    players.push(drone);
  }

  const newEvents =
    sinceSeq > 0
      ? recentEvents.filter((e) => e.seq > sinceSeq).map((e) => e.packet)
      : [];

  res.status(200).json({
    roomId: 'SECTOR-01',
    latestSeq: eventSeq - 1,
    players,
    events: newEvents,
  });
}
