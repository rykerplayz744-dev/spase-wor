// Vercel Serverless Function for cross-browser / cross-device Sector-01 & Couch Co-Op state & combat event relay
// Optimized for minimal bandwidth on Vercel Hobby Plan (no self-echo, deterministic drone batch seeds, compact keys)
const rooms = new Map();

function getRoom(roomId) {
  const cleanId = roomId === 'COUCH-COOP' ? 'COUCH-COOP' : 'SECTOR-01';
  let room = rooms.get(cleanId);
  if (!room) {
    room = {
      activePlayers: new Map(),
      droneBatches: [],
      deadDroneIds: new Set(),
      recentEvents: [],
      eventSeq: 1,
    };
    rooms.set(cleanId, room);
  }
  return room;
}

function upsertIncomingPlayer(activePlayers, incomingPlayer, now) {
  if (!incomingPlayer || typeof incomingPlayer.id !== 'string') return;

  const prevEntry = activePlayers.get(incomingPlayer.id);
  const incomingMusic = incomingPlayer.music;
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
    incomingPlayer.music = {
      ...incomingMusic,
      startedAtServerMs: authoritativeStartMs,
      trackTime: Math.max(0, Number(((now - authoritativeStartMs) / 1000).toFixed(2))),
      updatedAt: now,
    };
  } else {
    delete incomingPlayer.music;
  }

  activePlayers.set(incomingPlayer.id, {
    player: incomingPlayer,
    updatedAt: now,
  });
}

export default function handler(req, res) {
  const now = Date.now();
  const body =
    req.method === 'POST' && req.body
      ? typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body
      : null;

  const roomId = body && (body.r === 'COUCH-COOP' || body.roomId === 'COUCH-COOP')
    ? 'COUCH-COOP'
    : 'SECTOR-01';
  const room = getRoom(roomId);
  const { activePlayers, droneBatches, deadDroneIds, recentEvents } = room;

  // Evict stale human players (> 6 seconds without heartbeat)
  for (const [id, entry] of activePlayers.entries()) {
    if (now - entry.updatedAt > 6000) {
      activePlayers.delete(id);
    }
  }

  // Evict old events (> 7 seconds old)
  while (recentEvents.length > 0 && now - recentEvents[0].timestamp > 7000) {
    recentEvents.shift();
  }

  let sinceSeq = 0;
  let requesterId = '';
  let requesterP2Id = '';

  if (body) {
    if (typeof body.q === 'number') {
      sinceSeq = body.q;
    } else if (typeof body.sinceSeq === 'number') {
      sinceSeq = body.sinceSeq;
    }

    const incomingPlayer = body.p || body.player;
    const incomingPlayer2 = body.p2 || body.player2;

    if (typeof body.id === 'string') {
      requesterId = body.id;
    } else if (incomingPlayer && typeof incomingPlayer.id === 'string') {
      requesterId = incomingPlayer.id;
    }

    if (incomingPlayer2 && typeof incomingPlayer2.id === 'string') {
      requesterP2Id = incomingPlayer2.id;
    }

    upsertIncomingPlayer(activePlayers, incomingPlayer, now);
    upsertIncomingPlayer(activePlayers, incomingPlayer2, now);

    const incomingEvents = body.e || body.events;
    if (Array.isArray(incomingEvents)) {
      for (const pkt of incomingEvents) {
        if (!pkt || typeof pkt.type !== 'string') continue;

        if (pkt.type === 'peer:player_leave' && typeof pkt.playerId === 'string') {
          activePlayers.delete(pkt.playerId);
        }

        // Store compact 60-byte deterministic droneBatch seeds instead of 100s of full PlayerState objects
        if (pkt.type === 'peer:cheat_action') {
          if (pkt.droneBatch && typeof pkt.droneBatch.seed === 'number') {
            if (!droneBatches.some((b) => b.seed === pkt.droneBatch.seed)) {
              droneBatches.push(pkt.droneBatch);
            }
            // Strip any heavy spawnedDrones array before storing in recentEvents
            delete pkt.spawnedDrones;
          } else if (pkt.action === 'clear_drones') {
            droneBatches.length = 0;
            deadDroneIds.clear();
          }
        } else if (pkt.type === 'peer:combat_hit' && pkt.fatal && typeof pkt.targetId === 'string') {
          if (pkt.targetId.startsWith('drn_') || pkt.targetId.startsWith('drone_')) {
            deadDroneIds.add(pkt.targetId);
          }
        }

        recentEvents.push({
          seq: room.eventSeq++,
          timestamp: now,
          packet: pkt,
        });
        if (recentEvents.length > 160) {
          recentEvents.shift();
        }
      }
    }
  }

  // If no human players are active in the sector, clear leftover drone batches so fresh sessions start clean
  if (activePlayers.size === 0 && droneBatches.length > 0) {
    droneBatches.length = 0;
    deadDroneIds.clear();
  }

  // Never echo the requester's own player state (P1 or P2) back to them!
  const remotePlayers = [];
  for (const [id, entry] of activePlayers.entries()) {
    if (id === requesterId || (requesterP2Id && id === requesterP2Id)) continue;
    const p = entry.player;
    if (p && p.music && p.music.isPlaying && typeof p.music.startedAtServerMs === 'number') {
      p.music = {
        ...p.music,
        trackTime: Math.max(0, Number(((now - p.music.startedAtServerMs) / 1000).toFixed(2))),
        updatedAt: now,
      };
    }
    remotePlayers.push(p);
  }

  // Never echo the requester's own events back to them!
  const newEvents =
    sinceSeq > 0
      ? recentEvents
          .filter(
            (e) =>
              e.seq > sinceSeq &&
              e.packet.senderId !== requesterId &&
              (!requesterP2Id || e.packet.senderId !== requesterP2Id)
          )
          .map((e) => e.packet)
      : [];

  const responsePayload = {
    s: now,
    q: room.eventSeq - 1,
  };

  if (remotePlayers.length > 0) {
    responsePayload.p = remotePlayers;
  }
  if (newEvents.length > 0) {
    responsePayload.e = newEvents;
  }
  if (sinceSeq === 0 && droneBatches.length > 0) {
    responsePayload.b = droneBatches;
    if (deadDroneIds.size > 0) {
      responsePayload.d = Array.from(deadDroneIds);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(responsePayload);
}

