# ccbuddyy

Force your Claude Code `/buddy` companion. Pick species, rarity, eyes, hat - no luck required.

![ccbuddyy demo](demo.gif)

Build your companion visually at [ccbuddy.dev](https://ccbuddy.dev)

```bash
npx ccbuddyy
```

## How it works

Claude Code assigns you a companion when you run `/buddy`. The companion is **deterministic** - it's derived from your user ID and a hardcoded salt string (`friend-2026-401`) embedded in the Claude Code binary.

The generation works like this:

1. **Hash**: `Bun.hash(userId + salt)` produces a 32-bit seed
2. **PRNG**: The seed feeds a [Mulberry32](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c) RNG
3. **Roll**: Sequential RNG calls determine rarity, species, eyes, hat, shiny, and stats

Since the output is fully deterministic, **changing the salt changes the companion**. ccbuddyy patches the salt in the Claude Code binary to produce the exact companion you want.

### Rarity odds

| Rarity | Weight | Chance |
|-----------|--------|--------|
| common | 60 | 60% |
| uncommon | 25 | 25% |
| rare | 10 | 10% |
| epic | 4 | 4% |
| legendary | 1 | 1% |

Common companions cannot have hats. Shiny is an independent 1% roll on top of everything else.

### The patching process

1. Finds the Claude Code binary (supports native install, npm, Homebrew, Volta, pnpm, yarn, mise, asdf, winget, and more)
2. Creates a `.bak` backup of the original binary
3. Replaces the salt string (`friend-2026-401`) with a new salt that produces your desired companion
4. Re-signs the binary on macOS (`codesign -s -`)
5. Clears stored companion data from `~/.claude.json` so Claude Code re-hatches on next `/buddy`

## Usage

### Interactive mode

```bash
npx ccbuddyy
```

Browse pre-searched legendaries with arrow keys, preview stats, and apply with Enter.

### Build mode

Specify exactly what you want:

```bash
npx ccbuddyy build -species dragon -rarity legendary
npx ccbuddyy build -species cat -rarity epic -eye star -hat crown
npx ccbuddyy build -species penguin -rarity legendary -shiny
```

The builder brute-forces random salts until it finds matches for your spec. Results are shown in a TUI picker.

**Options:**
- `-species` - duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk
- `-rarity` - common, uncommon, rare, epic, legendary
- `-eye` - dot, star, x, circle, at, degree
- `-hat` - none, crown, tophat, propeller, halo, wizard, beanie, tinyduck
- `-shiny` - require shiny (1% chance, makes searches ~100x slower)

### Other commands

```bash
npx ccbuddyy current          # show your current companion
npx ccbuddyy restore          # restore original binary
npx ccbuddyy search "legendary dragon"  # free-text search
npx ccbuddyy --seed <salt>    # apply a specific salt directly
```

## After Claude Code updates

Each update replaces the binary, resetting your companion. Just run ccbuddyy again to re-patch.

## Website

[ccbuddy.dev](https://ccbuddy.dev) - build your companion config visually and get the exact `npx` command.

## License

MIT
