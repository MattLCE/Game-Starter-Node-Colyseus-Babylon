# Game Roadmap

## Overview

This is a drop in browser multiplayer game that revolves around surviving, looting, and tactical combat. It will be called Bountyfull and it's set on a planet with two suns and a bunch of moons and a space debris field around it that is crazy unstable (geology, weather, etc) and the life on it has evolved a unique 10x or 100x faster metabolism so they grow in minutes. This planet seems to have been interesting to many different civilizations as there are relics, and ruins, and alien tech scattered around. Humanity is here now to utilize the many unique things that can only be found here. Natural materials, biological materials, alien artifacts, etc. Additionally, humanity is dominated by AI which provides for and tolerates biological humans, but doesn't prioritize them at all. So humans tend to bifurcate into passive pleasure seeking or active self-advancement, testing themselves against the impossible standards of the AI and the universe. The primary draw to this world for humans is the chance to build a fortune in credit and fame. This is extremely deadly, but it's realtively light hearted because AI doesn't value human life so humans take a laze fare perspective on their own life too. The AI is establishing regular dropship runs to the surface full of droids which automatically collect bounties (rewards increase with the value and danger of the item). The AI allows humans to tag along because humans consistently prove their worth en mass. This is one of the only places humans have been able to out-perform the AI. Quite simply, the droids fight and collect because they are programmed to, the humans do it because they discover that they don't want to die. So some humans turn out ot be significantly more productive than any droid. But there's no way to know if that's you until you test yourself.
So the game play loop is to start on a space station splash screen where you can enter a name if you want, then you click drop in. You switch to a minimap of the terrain with the dropship moving across it and you can choose to parachute out before the landing site if you want. Then you swithc to in-game and spawn on the ground (next to the dropship if you rode all the way). The droids fan out from the dropship automatically, start collecting/fighting, and returning items to the dropship. The dropship landing sites are chosen in areas relatively free of hazards for a short time. Environmental hazards (poison gas, solar radiation, debris showers, parasite rain, ant swarms, fissures, etc) will gradually shrink the survivable ara of the map, tightening the circle around the dropship, until the dropship is forced to take off. The dropship does not take droids or humans back, only items. But it is possible for one person to hide in the airlock and make the return journey. Any bounties a human managed to store in the dropship belong to the AI corporation if they die or paid to them if they survive. The dropship has weapons and countermeasures on it so the area around the dropship is relatively safe. The rest of the planet is fantastically deadly. 95% of the droids and humans on any given trip are destroyed. The hazards force the players and dropship to relocate as the noose tightens until ultimately the dropship is forced to leave. If a player survives by being in the airlock when the dropship leaves (5-10 minutes after game start) then they get to return to the station with their bounties, gear, etc and drop again.

## Inbox

auto fire

- pacifist: never attacks
- defensive: attacks if attacked
- calculating: attacks anything weaker
- offensive: attacks anything armed
- rampage: attacks anything mortal

Initial dropship can take back one person in the airlock. Later dropships will be big enough that three people can squeeze into the airlock, but they have to split the bounties.

Initially the map will only be big enough for one dropship so hazards will squeeze the survivable area forcing the players and the dropship to move until the dropship is forced to leave.

## Working

blerg

## Planned

- Implement ECS: Biao Niu
- Implement ECS: Grabag

## Imagined

### New Fauna: Biao niu

#### Entity: Biao Niu

- **Description**: A ball-like herbivore covered in upward-pointing spikes. Eats grass, grows larger with more spikes over time. Defends by curling into a spiked ball. At maturity, develops a tethered spike-shooting organ (fires when open, not when balled up). Spawns in groups but acts individually for now, ignoring others of its kind.
- **Components**:
  - `Position`: `(x, y, z)` – Tracks location (e.g., on ground at `z = 0`).
  - `Velocity`: `(vx, vy, vz)` – Moves at 1/2 player speed when walking (tunable), 0 when balled up.
  - `Scale`: `{ size: 0.5 to 2, spikeCount: 5 to 20 }` – Starts small (0.5 units) with few spikes (5); grows to 2 units and 20 spikes at maturity.
  - `ActivityState`: `graze`, `move`, `defend`, `attack`, `die`, `rot` – Current behavior.
  - `LifeStage`: `{ health: 0–100, isAlive: true/false, maturity: 0–1 }` – Health, alive status, and growth (0 = juvenile, 1 = mature with spike organ).
- **Systems**:
  - `Graze`: Moves at 1/2 speed to grass patches, eats to increase `maturity` (+0.01 per tick, tunable), grows `size` and `spikeCount` proportionally.
  - `Move`: Wanders at 1/2 speed randomly or toward grass, avoids attacking other Biao Niu.
  - `Defend`: If threatened (e.g., player/enemy within 1 unit), curls into a ball (`Velocity = 0`), spikes deal damage on contact (e.g., 10 health).
  - `Attack`: If `maturity = 1` and open (not in `defend`), fires tethered spike at target within 5 units (tunable range), retracts after hit or miss; can’t fire when balled up.
  - `Die`: Falls, stops moving, switches to `rot` when `health <= 0`.
  - `Rot`: Corpse persists for 30 seconds (tunable), spawns loot (e.g., spikes), then despawns.

#### Entity: Biao Niu Spike

- **Description**: A detached spike dropped as loot when a Biao Niu dies or shed naturally (future growth mechanic). Collectible.
- **Components**:
  - `Position`: `(x, y, z)` – Spawns at Biao Niu’s location (e.g., `z = 0`).
  - `State`: `{ isLoot: true }` – Collectible by players.
  - `Durability`: `{ decayTime: 30 }` – Persists for 30 seconds before rotting.
- **Systems**:
  - `Spawn`: Created by Biao Niu’s `Rot` (or future shedding mechanic).
  - `Loot`: Players can collect within `decayTime` for crafting (e.g., arrows, armor).
  - `Decay`: Reduces `decayTime`; despawns at 0.

---

#### Notes

- **Group Spawning**: Multiple Biao Niu spawn at the same `Position` (e.g., 3–5 individuals), but act independently for now—no herd coordination.
- **Growth**: Starts at `size = 0.5`, `spikeCount = 5`; matures to `size = 2`, `spikeCount = 20` at `maturity = 1`, gaining the tethered spike organ.
- **Tactical Play**: Players can attack juveniles easily but face tougher, spikier adults. The tethered spike adds ranged threat, countered by forcing them into defensive balls.
- **Naming**: "Biao Niu" (镖牛) pronounced "byaw nyoo" means "Dart Cow" in Mandarin, combining "dart" (biao) and "cow" (niu) for a punchy, translatable name.

### New Fauna: Grabag

#### Entity: Grabag

- **Description**: A floating purple balloon-like scavenger with six prehensile tentacles. Dives onto any carcass to feed, using gas to scatter competition. Moves along the ground with tentacles when feeding/fighting; flees horizontally first, dropping tentacles to climb faster if still in combat, shedding more near death.
- **Components**:
  - `Position`: `(x, y, z)` – Tracks location (e.g., drifting at `z = 2`).
  - `Velocity`: `(vx, vy, vz)` – Drifts at 1/4 player speed, moves 1/2 when grounded, dives at 3x.
  - `Scale`: `{ bulbSize: 1, tentacleLength: 0.5 or 3, tentacleCount: 6 }` – Human-sized bulb; tentacles idle at 0.5, extend to 3 when diving; tracks remaining tentacles (starts at 6).
  - `ActivityState`: `idle`, `hunt`, `feed`, `flee`, `fight`, `die`, `rot` – Current behavior.
  - `LifeStage`: `{ health: 0–100, isAlive: true/false }` – Health and alive status.
- **Systems**:
  - `Idle`: Drifts at 1/4 speed, scans for carcasses within 3x player height, switches to `hunt`.
  - `Hunt`: Dives at 3x speed to carcass, extends tentacles to 3, releases gas (spawns Grabag Gas) on landing.
  - `Feed`: Moves along ground at 1/2 speed using tentacles (`z = 0`), eats slowly, switches to `idle` when done or `flee` if threatened.
  - `Flee`:
    - If `health < 30` (tunable), flees horizontally at 1/2 speed (`vz = 0`).
    - After moving 5 units and still in combat, drops 1 tentacle (spawns Grabag Tentacle), boosts `vz` to 0.5.
    - For each 10 health lost below 30 while fleeing and in combat, drops another tentacle, adding +0.5 to `vz` (max 3 tentacles dropped, `vz = 1.5`).
  - `Fight`: Stays grounded, moves at 1/2 speed with tentacles, uses gas; may detach a tentacle if damaged.
  - `Die`: Deflates, falls, releases gas (spawns Grabag Gas), switches to `rot`.
  - `Rot`: Corpse persists, spawns loot, despawns.

#### Entity: Grabag Gas

- **Description**: Hallucinogenic gas cloud released when a Grabag lands to feed or dies, scrambling player controls.
- **Components**:
  - `Position`: `(x, y, z)` – Spawns at Grabag’s landing/death spot (e.g., `z = 0`).
  - `Scale`: `{ radius: 2 }` – Affects a 2-unit radius (tunable).
  - `Duration`: `{ timeLeft: 5 }` – Lingers for 5 seconds (tunable).
  - `Effect`: `{ type: scrambleControls }` – Scrambles inputs; blocked by gas mask, cured by TBD plant.
- **Systems**:
  - `Spawn`: Created by Grabag’s `Hunt` (on landing) or `Die`.
  - `Affect`: Scrambles controls for players in `radius` without a mask.
  - `Dissipate`: Reduces `timeLeft`; despawns at 0.

#### Entity: Grabag Tentacle

- **Description**: Detached tentacle dropped when a Grabag flees (to climb), fights (if damaged), or rots. Lootable.
- **Components**:
  - `Position`: `(x, y, z)` – Spawns at Grabag’s location (e.g., `z = 0`).
  - `State`: `{ isLoot: true }` – Collectible by players.
  - `Durability`: `{ decayTime: 30 }` – Persists for 30 seconds before rotting.
- **Systems**:
  - `Spawn`: Created by Grabag’s `Flee` (to climb), `Fight` (if damaged), or `Rot`.
  - `Loot`: Players can collect within `decayTime` for crafting.
  - `Decay`: Reduces `decayTime`; despawns at 0.

#### Notes

- **Grounded Movement**: During `Feed` and `Fight`, stays at `z = 0`, scooting at 1/2 speed with tentacles—climbing is slow unless fleeing.
- **Flee Logic**:
  - Starts horizontal (1/2 speed) at `health < 30`.
  - After 5 units distance, if in combat, drops 1 tentacle (`vz = 0.5`).
  - At `health < 20`, drops 2nd tentacle (`vz = 1.0`); at `health < 10`, drops 3rd (`vz = 1.5`). Caps at 3 drops.
- **Tactical Play**: Players can chase fleeing Grabags to force more tentacle drops, balancing risk vs. reward.
