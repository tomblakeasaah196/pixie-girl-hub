/**
 * Stylist Partner Programme (V2.2 §6.26) — smart routing (Q13).
 *
 * "Nearest first, then weighted by certification tier, verified rating,
 * current availability, and specialty." The engine SCORES AND RANKS eligible
 * (certified, under-capacity) partners; a human offers to the top N — the
 * customer/admin always sees the match, the system never silently assigns.
 *
 * Weights live in stylist_programme_config.routing_weights and are relative
 * (normalised at read), so the admin RoutingConfigPanel can tune them without
 * worrying about a fixed sum.
 */

"use strict";

const programmeRepo = require("./programme.repo");

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Component scores, each 0..1. Geo falls back gracefully: coordinates →
 * haversine within the stylist's service radius; otherwise city / state /
 * country text match.
 */
function componentScores(candidate, target) {
  const scores = {};

  const hasGeo = (v) => v !== null && v !== undefined;
  if (
    hasGeo(target.latitude) &&
    hasGeo(target.longitude) &&
    hasGeo(candidate.latitude) &&
    hasGeo(candidate.longitude)
  ) {
    const km = haversineKm(
      Number(target.latitude),
      Number(target.longitude),
      Number(candidate.latitude),
      Number(candidate.longitude),
    );
    const radius = Number(candidate.service_radius_km || 25);
    scores.distance = km <= radius ? 1 - (km / radius) * 0.5 : Math.max(0, 1 - km / (radius * 4));
    scores.distance_km = Math.round(km * 10) / 10;
  } else if (target.city && candidate.city) {
    if (candidate.city.toLowerCase() === target.city.toLowerCase())
      scores.distance = 1;
    else if (
      target.state &&
      candidate.state &&
      candidate.state.toLowerCase() === target.state.toLowerCase()
    )
      scores.distance = 0.6;
    else if (
      target.country_code &&
      candidate.country_code === target.country_code
    )
      scores.distance = 0.3;
    else scores.distance = 0;
  } else if (
    target.country_code &&
    candidate.country_code === target.country_code
  ) {
    scores.distance = 0.3;
  } else {
    scores.distance = 0;
  }

  const maxRank = 3; // ranks are small integers; config seeds 1..3
  scores.tier = candidate.tier_rank
    ? Math.min(1, Number(candidate.tier_rank) / maxRank)
    : 0;

  scores.rating =
    candidate.rating_count > 0 ? Number(candidate.avg_rating || 0) / 5 : 0.5;

  const max = Number(candidate.max_active_assignments || 1);
  scores.capacity = Math.max(
    0,
    1 - Number(candidate.current_active_count || 0) / max,
  );

  scores.specialty = candidate.service_key ? 1 : 0;

  return scores;
}

function normaliseWeights(raw) {
  const keys = ["distance", "tier", "rating", "capacity", "specialty"];
  const w = {};
  let sum = 0;
  for (const k of keys) {
    w[k] = Math.max(0, Number((raw || {})[k] ?? 0));
    sum += w[k];
  }
  if (sum <= 0) {
    // Degenerate config: fall back to the seeded defaults.
    return { distance: 0.4, tier: 0.2, rating: 0.2, capacity: 0.1, specialty: 0.1 };
  }
  for (const k of keys) w[k] /= sum;
  return w;
}

/**
 * Rank eligible partners for a job. Target: { city, state, country_code,
 * latitude?, longitude? }. Returns candidates sorted by match_score desc,
 * each carrying its component breakdown for the suggest drawer.
 */
async function suggest({ business, service_key, target = {}, limit = 10 }) {
  const [cfg, candidates] = await Promise.all([
    programmeRepo.getConfig({ business }),
    programmeRepo.candidateStylists({ business, service_key }),
  ]);
  const weights = normaliseWeights(cfg ? cfg.routing_weights : null);

  const ranked = candidates
    .map((c) => {
      const parts = componentScores(c, target);
      const score =
        weights.distance * parts.distance +
        weights.tier * parts.tier +
        weights.rating * parts.rating +
        weights.capacity * parts.capacity +
        weights.specialty * parts.specialty;
      return {
        stylist_id: c.stylist_id,
        display_name: c.display_name,
        partner_code: c.partner_code,
        city: c.city,
        state: c.state,
        country_code: c.country_code,
        current_tier_key: c.current_tier_key,
        avg_rating: c.avg_rating,
        rating_count: c.rating_count,
        current_active_count: c.current_active_count,
        max_active_assignments: c.max_active_assignments,
        rate: c.rate,
        duration_minutes: c.duration_minutes,
        has_specialty: Boolean(c.service_key),
        match_score: Math.round(score * 1000) / 10, // 0..100, 1dp
        components: parts,
      };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, Math.min(limit, 50));

  return {
    weights,
    offer_top_n: cfg ? cfg.offer_top_n : 3,
    candidates: ranked.map((c, i) => ({ ...c, match_rank: i + 1 })),
  };
}

module.exports = { suggest, haversineKm, normaliseWeights, componentScores };
