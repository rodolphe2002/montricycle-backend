import { Router } from 'express';

const router = Router();

// Simple server-side proxy to Nominatim to avoid browser CORS issues
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
    const country = String(req.query.country || 'ci');
    const lang = String(req.query.lang || 'fr');

    const params = new URLSearchParams({
      q,
      format: 'json',
      addressdetails: '0',
      limit: String(limit),
      countrycodes: country,
    });

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'TricycleApp/1.0 (support@tricycle.local)',
        'Accept-Language': lang,
      },
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'Geocode upstream error' });
    }
    const data = await resp.json();
    // Normalize
    const results = (data || []).map((it) => ({
      name: it.display_name,
      lat: parseFloat(it.lat),
      lon: parseFloat(it.lon),
      source: 'nominatim',
    }));

    // CORS for frontend consumption
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json(results);
  } catch (err) {
    console.error('Geocode proxy error', err);
    return res.status(500).json({ error: 'Erreur serveur geocode' });
  }
});

export default router;
