// Companion roll logic - matches Claude Code's src/buddy/companion.ts exactly

import { bunHash32 } from './wyhash.mjs';

const ORIGINAL_SALT = 'friend-2026-401';

const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
  'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
  'rabbit', 'mushroom', 'chonk',
];
const EYES = ['·', '\u2726', '\u00d7', '\u25c9', '@', '\u00b0'];
const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const STAT_NAMES = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'];
const RARITY_FLOOR = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 };
const RARITY_STARS = { common: '\u2605', uncommon: '\u2605\u2605', rare: '\u2605\u2605\u2605', epic: '\u2605\u2605\u2605\u2605', legendary: '\u2605\u2605\u2605\u2605\u2605' };

export { ORIGINAL_SALT, SPECIES, EYES, HATS, RARITIES, RARITY_WEIGHTS, STAT_NAMES, RARITY_STARS };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function rollRarity(rng) {
  let roll = rng() * 100;
  for (const r of RARITIES) {
    roll -= RARITY_WEIGHTS[r];
    if (roll < 0) return r;
  }
  return 'common';
}

function rollStats(rng, rarity) {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);
  const stats = {};
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }
  return stats;
}

export function rollWithSalt(userId, salt) {
  const rng = mulberry32(bunHash32(userId + salt));
  const rarity = rollRarity(rng);
  return {
    salt,
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  };
}

const EYE_NAMES = { '·': 'dot', '\u2726': 'star', '\u00d7': 'x', '\u25c9': 'circle', '@': 'at', '\u00b0': 'degree' };

export function matches(roll, terms) {
  const eyeName = EYE_NAMES[roll.eye] || '';
  const parts = [
    roll.rarity, roll.species, roll.hat, roll.eye, eyeName,
    roll.shiny ? 'shiny' : '',
    ...STAT_NAMES.map(n => n + ':' + roll.stats[n]),
  ];
  const haystack = ' ' + parts.join(' ').toLowerCase() + ' ';
  return terms.every(t => {
    if (['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle',
         'snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk'].includes(t)) {
      return haystack.includes(' ' + t + ' ');
    }
    // Match eye by name or character
    if (t.startsWith('eye:')) {
      const val = t.slice(4);
      return roll.eye === val || eyeName === val;
    }
    return haystack.includes(t);
  });
}

export function buildSearch(userId, spec, maxResults = 3, maxIterations = 50_000_000, onProgress = null) {
  const saltLen = ORIGINAL_SALT.length;
  const chars = '0123456789abcdef';
  const results = [];
  const start = Date.now();

  for (let i = 0; i < maxIterations && results.length < maxResults; i++) {
    let salt = '';
    for (let j = 0; j < saltLen; j++) {
      salt += chars[Math.floor(Math.random() * chars.length)];
    }
    const roll = rollWithSalt(userId, salt);

    if (spec.species && roll.species !== spec.species) continue;
    if (spec.rarity && roll.rarity !== spec.rarity) continue;
    if (spec.eye && roll.eye !== spec.eye) continue;
    if (spec.hat && roll.hat !== spec.hat) continue;
    if (spec.shiny && !roll.shiny) continue;

    results.push({ ...roll, iterations: i + 1, elapsed: Date.now() - start });

    if (onProgress) onProgress(results.length, i + 1, Date.now() - start);

    if (i > 0 && i % 500_000 === 0 && results.length < maxResults) {
      if (onProgress) onProgress(results.length, i + 1, Date.now() - start);
    }
  }

  return { results, totalIterations: results.length > 0 ? results[results.length - 1].iterations : maxIterations, elapsed: Date.now() - start };
}

export function estimateDifficulty(spec) {
  let odds = 1;
  if (spec.rarity) odds *= RARITY_WEIGHTS[spec.rarity] / 100;
  if (spec.species) odds *= 1 / SPECIES.length;
  if (spec.eye) odds *= 1 / EYES.length;
  if (spec.hat) {
    if (spec.rarity === 'common') odds *= spec.hat === 'none' ? 1 : 0;
    else odds *= 1 / HATS.length;
  }
  if (spec.shiny) odds *= 0.01;
  return { odds, expectedIterations: odds > 0 ? Math.round(1 / odds) : Infinity };
}

export function searchSync(userId, query, maxResults = 25, maxIterations = 50_000_000) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  const saltLen = ORIGINAL_SALT.length;
  const chars = '0123456789abcdef';

  for (let i = 0; i < maxIterations && results.length < maxResults; i++) {
    // Generate random salt of correct length
    let salt = '';
    for (let j = 0; j < saltLen; j++) {
      salt += chars[Math.floor(Math.random() * chars.length)];
    }
    const roll = rollWithSalt(userId, salt);
    if (matches(roll, terms)) {
      results.push(roll);
    }

    if (i > 0 && i % 1_000_000 === 0 && results.length < maxResults) {
      process.stderr.write(`  searched ${(i / 1_000_000).toFixed(0)}M so far (${results.length} found)...\n`);
    }
  }

  return results;
}
