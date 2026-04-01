#!/usr/bin/env node

import { rollWithSalt, searchSync, STAT_NAMES, RARITY_STARS, ORIGINAL_SALT } from './companion.mjs';
import { getUserId, getCurrentSalt, patch, restore } from './patcher.mjs';
import { createInterface } from 'readline';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const UNDERLINE = '\x1b[4m';
const INVERSE = '\x1b[7m';
const CLEAR = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const RARITY_COLORS = {
  common: '\x1b[90m',
  uncommon: '\x1b[32m',
  rare: '\x1b[36m',
  epic: '\x1b[35m',
  legendary: '\x1b[33m',
};

const SPRITES = {
  duck:     ['   __   ', ' <({E})__ ', '  ( ._> ', '   `--\' '],
  goose:    ['  ({E}>   ', '  ||    ', ' _(__)_ ', '  ^^^^  '],
  blob:     ['  .---.  ', ' ({E}  {E}) ', ' (     ) ', '  `---\'  '],
  cat:      ['  /\\_/\\  ', ' ({E}   {E}) ', ' (  w  ) ', ' (")_(") '],
  dragon:   [' /^\\  /^\\ ', '<  {E}  {E}  >', '(   ~~   )', ' `-vvvv-\' '],
  octopus:  ['  .----.  ', ' ( {E}  {E} ) ', ' (______) ', ' /\\/\\/\\/\\ '],
  owl:      ['  /\\  /\\  ', ' (({E})({E})) ', ' (  ><  ) ', '  `----\'  '],
  penguin:  ['  .---.  ', '  ({E}>{E})  ', ' /(   )\\ ', '  `---\'  '],
  turtle:   ['  _,--._  ', ' ( {E}  {E} ) ', '/[______]\\', ' ``    `` '],
  snail:    ['{E}   .--. ', ' \\  ( @ ) ', '  \\_`--\'  ', ' ~~~~~~~  '],
  ghost:    ['  .----.  ', ' / {E}  {E} \\ ', ' |      | ', ' ~`~``~`~ '],
  axolotl:  ['}~(_____)~{', '}~({E} ..{E})~{', ' ( .--. ) ', ' (_/  \\_) '],
  capybara: [' n______n ', '( {E}    {E} )', '(   oo   )', ' `------\' '],
  cactus:   [' n  __  n ', ' | |{E} {E}| | ', ' |_|  |_| ', '   |  |   '],
  robot:    ['  .[||].  ', ' [ {E}  {E} ] ', ' [ ==== ] ', ' `------\' '],
  rabbit:   ['  (\\__/)  ', ' ( {E}  {E} ) ', '=(  ..  )=', ' (")__(") '],
  mushroom: ['.-o-OO-o-.', '(_________)', '  |{E}  {E}|  ', '  |____|  '],
  chonk:    [' /\\    /\\ ', '( {E}    {E} )', '(   ..   )', ' `------\' '],
};

const HAT_LINES = {
  none: '',
  crown: '  \\^^^/  ',
  tophat: '  [___]  ',
  propeller: '   -+-   ',
  halo: '  (   )  ',
  wizard: '   /^\\   ',
  beanie: '  (___)  ',
  tinyduck: '   ,>    ',
};

// --- Curated legendary collection (one per species, pre-searched) ---
// These are universal salts that produce legendaries for ANY user
// (the actual species/stats vary per user, but rarity stays high)
// We generate them on-the-fly for the current user.
function generateShowcase(userId) {
  const picks = [];
  const seen = new Set();

  // First: find one legendary per species (up to 10)
  const targetSpecies = ['dragon', 'penguin', 'cat', 'ghost', 'axolotl', 'robot', 'owl', 'mushroom', 'duck', 'chonk'];
  for (const species of targetSpecies) {
    if (picks.length >= 10) break;
    const results = searchSync(userId, `legendary ${species}`, 1, 2_000_000);
    if (results.length > 0 && !seen.has(results[0].salt)) {
      seen.add(results[0].salt);
      picks.push(results[0]);
    }
  }

  // Fill remaining slots with any legendary
  if (picks.length < 10) {
    const fill = searchSync(userId, 'legendary', 10 - picks.length, 2_000_000);
    for (const r of fill) {
      if (!seen.has(r.salt)) {
        seen.add(r.salt);
        picks.push(r);
        if (picks.length >= 10) break;
      }
    }
  }

  return picks;
}

// --- Rendering ---

function renderSprite(roll) {
  const frames = SPRITES[roll.species] || SPRITES.blob;
  const lines = frames.map(l => l.replaceAll('{E}', roll.eye));
  if (roll.hat !== 'none') {
    lines.unshift(HAT_LINES[roll.hat] || '');
  }
  return lines;
}

function statBar(value) {
  const filled = Math.round(value / 10);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
}

function renderCard(roll) {
  const color = RARITY_COLORS[roll.rarity] || '';
  const stars = RARITY_STARS[roll.rarity] || '';
  const shinyTag = roll.shiny ? ` \x1b[33m\u2728 SHINY\u2728${RESET}` : '';
  const sprite = renderSprite(roll);
  const lines = [];

  lines.push(`  ${color}${BOLD}${stars} ${roll.rarity.toUpperCase()}${RESET}  ${BOLD}${roll.species.toUpperCase()}${RESET}${shinyTag}`);
  lines.push('');
  for (const line of sprite) {
    lines.push(`      ${line}`);
  }
  lines.push('');
  for (const name of STAT_NAMES) {
    const v = roll.stats[name];
    const bar = statBar(v);
    const padded = name.padEnd(10);
    lines.push(`      ${DIM}${padded}${RESET} ${bar} ${v}`);
  }
  return lines;
}

function renderCurrentCard(roll, salt, patched) {
  const lines = renderCard(roll);
  lines.push(`      ${DIM}salt: ${salt}${patched ? ' (patched)' : ' (original)'}${RESET}`);
  return lines;
}

// --- Interactive menu ---

function enableRawMode() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }
}

function disableRawMode() {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function interactiveMenu() {
  const userId = getUserId();
  if (!userId) {
    console.error('  Could not read ~/.claude.json');
    console.error('  Make sure Claude Code is installed and you\'ve logged in.');
    process.exit(1);
  }

  let state = 'main'; // 'main' | 'picking' | 'loading' | 'done'
  let cursor = 0;
  let showcase = null;
  let message = null;

  const salt = getCurrentSalt();
  const currentRoll = rollWithSalt(userId, salt);
  const isPatched = salt !== ORIGINAL_SALT;

  const mainOptions = [
    { label: `\x1b[33m\u2605 ${BOLD}Pick a new companion\x1b[0m \x1b[33m\u2605\x1b[0m`, action: 'pick' },
    { label: 'Restore original', action: 'restore' },
    { label: 'Exit', action: 'exit' },
  ];

  function draw() {
    process.stdout.write(CLEAR);
    process.stdout.write(HIDE_CURSOR);

    // Banner
    process.stdout.write(`\n${BOLD}  \u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n`);
    process.stdout.write(`  \u2502  EPIC BUDDY                        \u2502\n`);
    process.stdout.write(`  \u2502  Force your Claude Code companion   \u2502\n`);
    process.stdout.write(`  \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f${RESET}\n\n`);

    if (state === 'main') {
      // Show current companion
      process.stdout.write(`  ${BOLD}Your current companion:${RESET}\n`);
      const cardLines = renderCurrentCard(currentRoll, salt, isPatched);
      for (const line of cardLines) process.stdout.write(line + '\n');

      process.stdout.write('\n');

      // Menu
      for (let i = 0; i < mainOptions.length; i++) {
        const selected = i === cursor;
        const prefix = selected ? `${BOLD}  \u25b6 ` : `    `;
        const suffix = selected ? RESET : '';
        process.stdout.write(`${prefix}${mainOptions[i].label}${suffix}\n`);
      }

      process.stdout.write(`\n  ${DIM}Use \u2191\u2193 arrows to navigate, Enter to select, q to quit${RESET}\n`);

    } else if (state === 'loading') {
      process.stdout.write(`  ${BOLD}Searching for legendary companions...${RESET}\n`);
      process.stdout.write(`  ${DIM}This takes a few seconds${RESET}\n`);

    } else if (state === 'picking' && showcase) {
      process.stdout.write(`  ${BOLD}Pick your new companion:${RESET}  ${DIM}(\u2191\u2193 navigate, Enter to apply, q to go back)${RESET}\n\n`);

      for (let i = 0; i < showcase.length; i++) {
        const selected = i === cursor;
        const roll = showcase[i];
        const color = RARITY_COLORS[roll.rarity] || '';
        const stars = RARITY_STARS[roll.rarity] || '';
        const shinyTag = roll.shiny ? ` \x1b[33m\u2728${RESET}` : '';
        const sprite = renderSprite(roll);
        const topStat = STAT_NAMES.reduce((a, b) => roll.stats[a] > roll.stats[b] ? a : b);

        if (selected) {
          // Full card for selected item
          process.stdout.write(`  ${INVERSE} ${(i + 1).toString().padStart(2)} ${RESET} `);
          process.stdout.write(`${color}${BOLD}${stars} ${roll.rarity.toUpperCase()}${RESET} ${BOLD}${roll.species.toUpperCase()}${RESET}${shinyTag}\n`);
          for (const line of sprite) {
            process.stdout.write(`       ${line}\n`);
          }
          process.stdout.write('\n');
          for (const name of STAT_NAMES) {
            const v = roll.stats[name];
            process.stdout.write(`       ${DIM}${name.padEnd(10)}${RESET} ${statBar(v)} ${v}\n`);
          }
          process.stdout.write(`       ${DIM}hat: ${roll.hat}  eyes: ${roll.eye}${RESET}\n\n`);
        } else {
          // Compact line for non-selected
          const hatInfo = roll.hat !== 'none' ? ` [${roll.hat}]` : '';
          process.stdout.write(`  ${DIM} ${(i + 1).toString().padStart(2)} ${RESET} `);
          process.stdout.write(`${color}${stars}${RESET} ${roll.species}${hatInfo} ${DIM}${topStat}:${roll.stats[topStat]}${RESET}${shinyTag}\n`);
        }
      }

    } else if (state === 'done') {
      if (message) {
        for (const line of message) process.stdout.write(line + '\n');
      }
    }
  }

  return new Promise((resolve) => {
    enableRawMode();
    draw();

    process.stdin.on('data', async (key) => {
      // Ctrl+C or q
      if (key === '\x03' || (key === 'q' && state !== 'done')) {
        if (state === 'picking') {
          state = 'main';
          cursor = 0;
          draw();
          return;
        }
        process.stdout.write(SHOW_CURSOR);
        disableRawMode();
        resolve();
        return;
      }

      const maxItems = state === 'main' ? mainOptions.length : (showcase ? showcase.length : 0);

      // Arrow up
      if (key === '\x1b[A' || key === 'k') {
        cursor = Math.max(0, cursor - 1);
        draw();
        return;
      }
      // Arrow down
      if (key === '\x1b[B' || key === 'j') {
        cursor = Math.min(maxItems - 1, cursor + 1);
        draw();
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (state === 'main') {
          const action = mainOptions[cursor].action;

          if (action === 'exit') {
            process.stdout.write(SHOW_CURSOR);
            disableRawMode();
            resolve();
            return;
          }

          if (action === 'restore') {
            try {
              restore();
              state = 'done';
              message = [
                '',
                `  ${BOLD}Restored to original!${RESET}`,
                '',
                `  ${BOLD}Restart Claude Code${RESET} and run ${BOLD}/buddy${RESET} to see your companion.`,
                '',
              ];
            } catch (err) {
              state = 'done';
              message = [`  Error: ${err.message}`];
            }
            draw();
            process.stdout.write(SHOW_CURSOR);
            disableRawMode();
            resolve();
            return;
          }

          if (action === 'pick') {
            state = 'loading';
            cursor = 0;
            draw();

            // Generate showcase (blocking but shows loading screen)
            setTimeout(() => {
              showcase = generateShowcase(userId);
              state = 'picking';
              draw();
            }, 50);
            return;
          }
        }

        if (state === 'picking' && showcase) {
          const chosen = showcase[cursor];
          try {
            patch(chosen.salt);
            state = 'done';
            const cardLines = renderCard(chosen);
            message = [
              '',
              `  ${BOLD}Patched!${RESET}`,
              '',
              ...cardLines,
              '',
              `  ${BOLD}Now restart Claude Code${RESET} and run ${BOLD}/buddy${RESET}`,
              `  ${DIM}to meet your new ${chosen.rarity} ${chosen.species}!${RESET}`,
              '',
              `  ${DIM}To undo later: npx epic-buddy restore${RESET}`,
              '',
            ];
          } catch (err) {
            state = 'done';
            message = [`  Error: ${err.message}`];
          }
          draw();
          process.stdout.write(SHOW_CURSOR);
          disableRawMode();
          resolve();
          return;
        }
      }
    });
  });
}

// --- Non-interactive commands (kept for --seed, search, etc.) ---

function printCard2(roll, index) {
  const lines = renderCard(roll);
  console.log();
  console.log(`  ${DIM}[${index}]${RESET}`);
  for (const line of lines) console.log(line);
  console.log(`      ${DIM}salt: ${roll.salt}${RESET}`);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function cmdSearch(query) {
  const userId = getUserId();
  if (!userId) { console.error('  Could not read ~/.claude.json'); process.exit(1); }

  console.log(`\n  ${DIM}Searching for: ${query}${RESET}\n`);
  const results = searchSync(userId, query, 10);
  if (results.length === 0) { console.log('  No matches found.'); process.exit(1); }
  results.forEach((r, i) => printCard2(r, i + 1));

  console.log();
  const answer = await ask(`  Pick one to apply (1-${results.length}) or 'n' to skip: `);
  if (answer.toLowerCase() === 'n' || answer === '') return;
  const idx = parseInt(answer) - 1;
  if (idx < 0 || idx >= results.length) { console.log('  Invalid.'); return; }

  const chosen = results[idx];
  const result = patch(chosen.salt);
  console.log(`\n  ${BOLD}Patched!${RESET} Restart Claude Code and run ${BOLD}/buddy${RESET}`);
}

async function cmdSeed(salt) {
  const userId = getUserId();
  if (!userId) { console.error('  Could not read ~/.claude.json'); process.exit(1); }

  const roll = rollWithSalt(userId, salt);
  printCard2(roll, 1);
  patch(salt);
  console.log(`\n  ${BOLD}Patched!${RESET} Restart Claude Code and run ${BOLD}/buddy${RESET}`);
}

// --- Entry point ---

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'search' && args[1]) {
  await cmdSearch(args.slice(1).join(' '));
} else if (cmd === '--seed' && args[1]) {
  await cmdSeed(args[1]);
} else if (cmd === 'current') {
  const userId = getUserId();
  const salt = getCurrentSalt();
  const roll = rollWithSalt(userId, salt);
  const lines = renderCurrentCard(roll, salt, salt !== ORIGINAL_SALT);
  console.log();
  for (const line of lines) console.log(line);
  console.log();
} else if (cmd === 'restore') {
  restore();
  console.log(`  ${BOLD}Restored.${RESET} Restart Claude Code and run ${BOLD}/buddy${RESET}`);
} else {
  // Default: interactive menu
  await interactiveMenu();
}
