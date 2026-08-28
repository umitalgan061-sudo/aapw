# Westeros lore reference

Background research on *A Song of Ice and Fire* / *Game of Thrones*, kept in the repository so the
world can be built against sourced facts instead of half-memory. The owner asked for this
("Game of Thrones'ı arka planda araştır, bilgiler çekip bir yerde sakla"), and it has a second, more
practical job: every geographic number this project hard-codes should be traceable to either
`resimler/map.png` (the owner's canonical map, which always wins on *where*) or to a source named
here (which decides *what* and *how big*).

**Rule this file follows.** Text and measurements only. No HBO visual or audio assets are downloaded
into this repository — that is the single standing constraint on this work, and a lore note is not an
excuse to loosen it. Nothing here is copied at length; these are facts and figures with their source.

**How to use it.** When a module hard-codes a lore number — the Wall's height, a castle's tower count,
a lake's proportions — it should cite the section here, and this file should cite where the fact came
from. `src/3d/world/theWall.js` and `src/3d/world/nightsWatchCastles.js` both do.

---

## The Wall

| Fact | Value | Note |
| --- | --- | --- |
| Length | 300 miles | From the Gorge in the west to the Bay of Seals in the east. |
| Height | ~700 feet (213 m) | A rough figure: it runs higher and lower along its length, reaching 800–900 ft in places, with up to a third of that made of earth and stone rather than ice. |
| Width at the top | A dozen horsemen abreast | Thicker at the base than at the crown. |
| Castles | 19 | Garrisons for the Night's Watch, strung along its length. |
| Manned castles | 3 | The rest were abandoned as the Watch's numbers fell. |

**The three manned castles, west to east:**

- **The Shadow Tower** — near the western end of the Wall.
- **Castle Black** — the centre, at the northern end of the Kingsroad.
- **Eastwatch-by-the-Sea** — the eastern end, where the Wall meets the sea.

The full nineteen, east to west: Westwatch-by-the-Bridge, the Shadow Tower, Sentinel Stand, Greyguard,
Stonedoor, Hoarfrost Hill, Icemark, the Nightfort, Deep Lake, Queensgate, Castle Black, Oakenshield,
Woodswatch-by-the-Pool, Sable Hall, Rimegate, the Long Barrow, the Torches, Greenguard, and
Eastwatch-by-the-Sea.

*Used by:* `src/3d/world/theWall.js` (213 m height, coast-to-coast span),
`src/3d/world/nightsWatchCastles.js` (which three castles exist and where along the Wall they sit).

### Castle Black

**It is not a true castle, and this is the detail that decides how it must be built.** It has no walls
to defend it to the west, east, or south; only the Wall stands to the north. It is a cluster of stone
towers and timber keeps at the foot of the Wall, not a walled enclosure. Building it as a
conventional castle would be wrong in the one way most visible from the ground.

| Structure | Detail |
| --- | --- |
| **King's Tower** | A round tower a hundred feet (30 m) tall, merlons around its top, overlooking the gate and the foot of the wooden stair up the Wall. |
| **Lord Commander's Tower** | Also called the Lord Commander's Keep; his quarters. |
| **Common hall** | A great timbered keep where the brothers take their meals. |
| **Winch cage** | An iron cage on a winch, used to ride up and down the Wall's face. Holds ten men. Stands near the castle's well. |
| **Wooden stair** | Climbs the south face of the Wall; the King's Tower overlooks its foot. |
| **Underground passages** | Connect all the buildings beneath the keeps and towers; in winter they are the only way to move around the castle. Not modelled — there are no interiors yet. |

*Used by:* `src/3d/world/nightsWatchCastles.js`.

---

## Lakes and inland water

### The Gods Eye

The largest lake in Westeros south of the Wall. It sits on the south-eastern edge of the Riverlands
and the north-western edge of the Crownlands.

| Fact | Value |
| --- | --- |
| Extent | Over 100 miles north to south; 50 miles at its narrowest, over 80 at its widest. |
| Islands | Exactly one — the **Isle of Faces**, in the lake's *northern half*, which is what gives the lake its eye-like look and its name. |
| Isle of Faces | Several miles wide, heavily forested; one of the few places in southern Westeros where weirwoods still stand, most others having been cut down and burned. |
| Harrenhal | On the lake shore, north of the island. |
| Shores | The southern shore is heavily forested; the northern is more densely populated, especially near Harrenhal. |

Myth holds that the Pact between the Children of the Forest and the First Men was signed on the Isle
of Faces, ending centuries of war: the First Men took the open lands, the Children kept the deep woods.

**Measured on `resimler/map.png`** (run 378, full-resolution water detection, not eyeballed): the Gods
Eye is an enclosed water body centred at normalized **(0.1805, 0.4704)**, spanning nx 0.1771–0.1842
and ny 0.4619–0.4795 — about **97 m × 185 m** at this world's scale, a north-south oval, which matches
the book proportion (longer north-south than east-west) and the map drawing.

### Long Lake

In the North, north of Winterfell. Candidate body measured on the map at normalized (0.1733, 0.1885),
roughly 114 m × 123 m at world scale.

---

## Regions, for the geography audit

`scripts/checkRegionGeographyFidelity.js` scores eleven named regions against the map. The lore
expectations behind them:

- **The North** — Winterfell and the wolfswood; temperate forest, cold.
- **The Reach** — the richest farmland in Westeros; Highgarden.
- **Dorne** — desert and red mountains; the map paints it orange sand.
- **The Riverlands** — the Trident and its forks, the Gods Eye, Harrenhal.
- **Lands of Always Winter** — beyond the Wall; the map draws it white.
- **The Dothraki Sea** — open grassland, no forest, little relief.
- **The Red Waste** — desert east of Slaver's Bay.
- **Valyria** — the Doom; volcanic, barren, drowned. Nothing grows there.
- **Sothoryos** — dark jungle.

---

## Sources

- [Wall — A Wiki of Ice and Fire](https://awoiaf.westeros.org/index.php/Wall)
- [Castle Black — A Wiki of Ice and Fire](https://awoiaf.westeros.org/index.php/Castle_Black)
- [The Citadel: Concordance — The Wall and Night's Watch Castles](https://westeros.org/Citadel/Concordance/Entry/The_Wall_and_Nights_Watch_Castles)
- [Category:Castles of the Night's Watch — A Wiki of Ice and Fire](https://awoiaf.westeros.org/index.php/Category:Castles_of_the_Night%27s_Watch)
- [Gods Eye — A Wiki of Ice and Fire](https://awoiaf.westeros.org/index.php/Gods_Eye)
- [Isle of Faces — A Wiki of Ice and Fire](https://awoiaf.westeros.org/index.php/Isle_of_Faces)
- [Geographic Map 6: The Riverlands — Atlas of Ice and Fire](https://atlasoficeandfireblog.wordpress.com/2017/02/04/geographic-map-6-the-riverlands/)
- [World of A Song of Ice and Fire — Wikipedia](https://en.wikipedia.org/wiki/Castle_Black)
