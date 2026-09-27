import { Router } from 'express';

const router = Router();

// In-memory cache (5 min TTL) to limit calls to the public OSRM demo server
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// GET /api/routing/route?from=lon,lat&to=lon,lat
// Proxies OSRM public demo server and normalizes the response for the frontend
router.get('/route', async (req, res) => {
  try {
    const parse = (v) => {
      const parts = String(v || '').split(',').map(Number);
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
      return { lon: parts[0], lat: parts[1] };
    };
    const from = parse(req.query.from);
    const to = parse(req.query.to);
    if (!from || !to) return res.status(400).json({ error: 'Paramètres from/to invalides (lon,lat)' });

    // Cache key rounded to ~50m precision
    const key = `${from.lon.toFixed(4)},${from.lat.toFixed(4)}>${to.lon.toFixed(4)},${to.lat.toFixed(4)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(hit.data);
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': 'TricycleApp/1.0 (support@tricycle.local)' },
        signal: ac.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!resp.ok) {
      return res.status(502).json({ error: 'Service de routage indisponible' });
    }
    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route || !Array.isArray(route.geometry?.coordinates)) {
      return res.status(404).json({ error: 'Aucun itinéraire trouvé' });
    }

    const out = {
      // GeoJSON is [lon, lat] -> expose [lat, lon] pairs for Leaflet
      coordinates: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      distanceKm: Math.round((route.distance / 1000) * 100) / 100,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      source: 'osrm',
    };

    cache.set(key, { at: Date.now(), data: out });
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json(out);
  } catch (err) {
    console.error('Routing proxy error', err?.message || err);
    return res.status(500).json({ error: 'Erreur serveur routage' });
  }
});

export default router;
