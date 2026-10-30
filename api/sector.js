// Vercel Serverless Function for cross-browser / cross-device Sector-01 state relay
const activePlayers = new Map();

export default function handler(req, res) {
  const now = Date.now();

  // Evict stale players (> 6 seconds without heartbeat)
  for (const [id, entry] of activePlayers.entries()) {
    if (now - entry.updatedAt > 6000) {
      activePlayers.delete(id);
    }
  }

  if (req.method === 'POST' && req.body && req.body.player) {
    const p = req.body.player;
    if (p && typeof p.id === 'string') {
      activePlayers.set(p.id, {
        player: p,
        updatedAt: now,
      });
    }
  }

  const players = [];
  for (const entry of activePlayers.values()) {
    players.push(entry.player);
  }

  res.status(200).json({
    roomId: 'SECTOR-01',
    players,
  });
}
