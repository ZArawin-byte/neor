# Neor frontend: implementation spec

The frontend is React 18 + TypeScript + Vite, in `frontend/`. It talks to the FastAPI app in `app/` and uses no other services except Supabase (Google sign-in) and OpenStreetMap (map tiles).

```bash
# terminal 1, repo root
uvicorn app.main:app --reload --port 8000
# terminal 2
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Vite proxies `/api` and `/uploads` to `localhost:8000`. If the API isn't running, every page still works on a sample closet and shows a one-line "can't reach the API" note. That's deliberate, so the demo survives bad wifi.

---

## 1. Routes

| Route | Page | Opened from |
|---|---|---|
| `/` | Doors + Google sign-in | — |
| `/room` | Walk-in closet with clickable hotspots | Doors opening |
| `/closet` | Racks, then the studio (`?racks=sweaters,pants`) | Clothes rail |
| `/mirror` | Try-on + AI analysis | Mirror |
| `/window` | Minimap + outfits for a place | Diamond window |
| `/critique` | The lion's closet audit | Lion |
| `/archive` | Saved looks + favourites | Top shelf |
| `/profile` | Name, photo, sign out, forget me | Second shelf |

Everything except `/` is wrapped in `<Inside>` (`src/main.tsx`). Without a session it redirects to `/`.

---

## 2. Landing: the doors (`pages/Landing.tsx`, `styles/landing.css`)

**Layout.** A lamp-lit hallway, turned `rotateY(17deg)` so the left door faces the viewer and the right one recedes (the angle from the reference photo).
- **Wall:** ogee-patterned wallpaper (an SVG tile) above dark olive panelling with a chair rail and skirting.
- **Doorcase:** a cream doorcase with a cornice and a glowing transom window, with "Neor" gilded on the glass.
- **Lamps:** a brass wall lamp on each side of the doors, washing warm light over the wallpaper.
- **Floor:** chevron parquet laid in true 3D perspective, with a red runner rug that lines up under the doors. `--door-x` keeps it aligned.

The sign-in sits on a cream card pinned to the wall on the right. Feature notices, such as the bargain finder, are pinned beside it. On phones the doors move to the centre, the card sits on the rug at the bottom, and notices go top-right.

**Doors.** Two oak doors drawn as SVG, each with three panels.
- **Grain:** two stretched `feTurbulence` passes, one for long grain lines and one for fine pores.
- **Lamplight:** falls across each door from its own lamp.
- **Handles:** lever handles on brass backplates.
- **Light leaks:** from the centre seam and from under the doors onto the rug.

**Using real photos instead.** Put `public/doors/oak-left.jpg` and `public/doors/oak-right.jpg` in place (portrait, about 300×720, each cropped to one door leaf). They're laid over the SVG automatically. If the files are missing, the SVG shows.

**Sign-in.** `lib/auth.ts` reads `/api/config`:
- If Supabase is configured, `signInWithOAuth({ provider: "google" })` runs and redirects back to `/?entering=1`, which plays the doors automatically.
- In demo mode (no Supabase), clicking the button signs you in on the spot.
- A returning user sees **Step inside** instead of the Google button.

**Opening sequence** (2.8s; skipped when the user prefers reduced motion):

| t | Phase | What happens |
|---|---|---|
| 0 | `orient` | The wall swings square to the viewer, and the sign-in panel fades out |
| 0.7s | `open` | The doors swing open about 104° on their hinges, and the closet render shows through |
| 2.0s | `enter` | The scene scales ×3.2 into the doorway and fades to warm cream |
| 2.8s | — | `navigate("/room", { state: { fromDoors: true } })`; the room plays a short settle-in |

Google button: white, `#dadce0` border, the official four-colour G. Don't restyle it, because Google's brand rules require this look.

---

## 3. The walk-in room (`pages/Room.tsx`, `styles/room.css`)

The background is `public/room/walk-in.png`, the lion render (1671×941). It always covers the viewport at its own aspect ratio, so hotspots are plain percentages of the image. When the screen is narrower than the picture, it crops mostly from the right, so the logo and the clothes rail stay visible. On portrait phones the room scrolls sideways instead.

| Hotspot | Box (left, top, w, h, in %) | Shape | Goes to | Hover text |
|---|---|---|---|---|
| Top shelf | 14.2, 9.5, 14.4, 7 | rect | `/archive` | **Archival looks**: See your past history and favourites. |
| Second shelf | 14.2, 17, 14.4, 7 | rect | `/profile` | **Profile**: Your photo, your preferences, your data. |
| Clothes rail | 14.2, 25, 15.4, 36 | rect | `/closet` | **Closet**: Your creative space of uploaded clothes. |
| Window | 41.6, 10.2, 16.8, 32.5 | diamond | `/window` | **Window**: Outfits for the cafes and photo spots around you. |
| Lion + ottoman | 35.5, 42, 30, 47 | ellipse | `/critique` | **The lion**: Closet critique. Essentials you may be missing. |
| Mirror | 64.8, 11.5, 7.8, 49 | leaning quad | `/mirror` | **Mirror**: Try on your mood board. |

On hover or keyboard focus, a warm glow brightens the object (a screen-blended radial gradient clipped to its shape), and a cream card tag appears beside it. On touch screens, which can't hover, short labels stay visible all the time.

**If the render changes, re-measure these boxes.** They live in the `SPOTS` array.

---

## 4. The closet (`pages/Closet.tsx` + `components/`)

### 4.1 Racks

Racks are finer-grained than the backend's categories. Each one maps down to a backend category so the AI still understands it (`lib/racks.ts`):

| Rack | Backend category |
|---|---|
| Shirts, T-shirts, Tank tops, Sweaters | `top` |
| Jackets | `outerwear` |
| Pants, Shorts, Skirts | `bottom` |
| Dresses | `dress` |
| Shoes | `shoes` |
| Scarves, Accessories, Socks & underwear | `accessory` |
| Bags | `bag` |

An item's rack is stored as `rack` in its item data (`POST /api/items` meta, or `PATCH`). Older items without `rack` get one guessed from their name ("Gym Shorts" → shorts), with the category as a fallback.

**A rack only appears once it has at least one item.** That's `useRacks()` in `lib/closet.tsx`.

### 4.2 Landing view: round racks (`components/RackCarousel.tsx`)

- A horizontal strip of circular clothing racks with scroll-snap, so it swipes on touch and has arrow buttons on desktop.
- Card size depends on how many racks exist: 1–2 racks are large (about half the width each), 3–4 are medium, and more scroll.
- Each rack is a small 3D carousel. A brass ring sits on a pole, and up to 10 items hang from it as stickers. Pieces are spaced at least 360/7° apart and centred on the front, so a rack with two items doesn't hide one behind the other. The ring turns slowly on hover.
- Tap to pick a rack, up to **2**. Picking a third drops the oldest pick. Picked racks get a numbered brass tag.
- A sticky bar reads "Sweaters + Pants · **Open both racks**" and sets `?racks=sweaters,pants`.

### 4.3 Studio view (`components/Studio.tsx`)

The left side shows all items from the picked racks as stickers, grouped by rack. Under them is the laundry basket.

The right side holds the **bookmark table**, and below it **Neor suggests**.

Drag and drop uses `@dnd-kit/core` (pointer, touch with a 150ms hold, and keyboard):

| Drag | Drop on | Result |
|---|---|---|
| Closet sticker | Table | A copy is pinned where you drop it. The original stays in the closet. |
| Suggestion sticker | Table | Same, and shop items get a price tag. |
| Table sticker | Elsewhere on the table | Moves it. |
| Table sticker | Off the table | Removes it. The × on hover does the same. |
| Closet sticker | Laundry basket | `PATCH {laundry: true}`. The item stays in the closet, dimmed, and is never suggested. |

**Bookmark table.**
- An oak table with a linen top and a red ribbon bookmark.
- The name is editable ("Table no. 3").
- A live colour-harmony pill, for example "Single accent · 90".
- **Clear** and **Save table**.
- Every piece stores a *snapshot* (name, hex, rack, image), so saved boards survive deleted items.
- The unsaved table is kept as a draft, so it survives a refresh and the Mirror can show it.

**Laundry basket.** A wicker basket with a count. Click it to list what's inside, each with a **Put back** button.

**Neor suggests.** Its filters:
- Source: **Everything / My closet / To buy**
- Occasion
- Season
- Weather. Hot hides sweaters, jackets and scarves; cold hides shorts and tanks; rain hides shorts.

It shows two kinds of suggestion:
1. **Instant, rule-based** (`completeTheTable` in `lib/stylist.ts`). These are pieces in slots the table doesn't cover yet, ranked by how well each pairs with what's on the table, and each one says why ("Keeps the table single accent (90/100)").
2. **Ask for a full look** calls `POST /api/ai/outfit` with `{occasion, season, place: "<weather> weather"}`. It shows the backend's `title`, `why` and `styling_tip`, and makes `closet_ids` and `missing[]` catalog items draggable.

Laundry items are excluded from both.

### 4.4 Upload (`components/UploadSheet.tsx`)

A side sheet opened by **Add a piece**:

1. Drop a photo, pick one, or take one (`capture="environment"` on phones). JPG, PNG or WebP.
2. **Cut-out**: `@imgly/background-removal` runs in the browser (`lib/cutout.ts`), and the result is trimmed to the garment. The roughly 40MB model loads on first use. If it fails, the original photo is used.
3. **Tag**: `POST /api/items/analyze` with the cut-out. If the AI is offline or returns no colour, the colour is the average of the opaque pixels.
4. **Confirm**: "This item will go on the *sweaters* rack." → **Okay** / **No, somewhere else**. The second shows every rack as a chip, with the AI's guess marked *(suggested)*. The name is editable.
5. **Save**: `POST /api/items` (multipart: `meta` JSON including `rack` and `category`, plus `file` = the PNG cut-out). The sheet resets so you can add the next piece.

### 4.5 Stickers (`components/Sticker.tsx`)

Each sticker is a die-cut white border (four 2px white drop-shadows) plus a soft shadow and a stable tilt of ±4° based on the item id. Items without a photo (starter closet, shop items) are drawn as flat garment silhouettes in their own colour (`Silhouette.tsx`).

---

## 5. The mirror (`pages/Mirror.tsx`)

**Mirror.** A tall arched oak floor mirror with a glass sheen.
- Inside it is the user's full-length photo (`profile.mirror_url`).
- With no photo yet, it shows a prompt and an upload button (`POST /api/profile/mirror`).

**Beside it.** The most recently *saved* table, or the unsaved draft if nothing has been saved, laid out exactly as on the table. Below it is a link to edit it in the closet.

**Under the mirror: analysis.**

| Card | Source | What it says |
|---|---|---|
| Colour | `harmonyOf()`, local | A palette strip, the harmony type, a score out of 100, plain-English reasons, temperature and contrast |
| Fit & proportion | Local | Read from cut words in item names ("wide", "slim", "cropped"…), e.g. "Both halves are roomy. Mark the waist." Flags missing shoes. **Never comments on the body.** |
| Neor's read | `POST /api/ai/outfit` | Pick an occasion, then **Ask** → `why`, `styling_tip`, `scent` |
| Finish it with | Local + AI | Catalog accessories, bags and scarves (and shoes if missing) ranked by colour fit, plus the AI's `missing[]`. Each has **Add to table**. |

**Save this fit** (header button) archives the look. It stores a snapshot of the pieces, the photo, the occasion, a one-line verdict and the harmony result.

> Body-aware advice ("body size") has to come from the backend, using `profile.measurements` and only when `ai_consent` is on. The frontend deliberately reads proportion from the clothes only.

---

## 6. The window (`pages/Window.tsx`, `lib/places.ts`, `lib/color.ts`, `lib/stylist.ts`)

### 6.1 What the user sees

- **Left:** a city search, and a Leaflet minimap of OSM tiles (slightly sepia) inside a painted window frame. Each pin is filled with the *dominant colour of that place's backdrop*. Below the map is a list of spots, each with a strip of its palette.
- **Right:** the selected spot (name, type, why it's worth going, photo tip) and its **backdrop palette** as the camera sees it at the chosen time of day. Under that:
  - Controls: **Stand out / Blend in**, time of day, season.
  - **From your closet**: one sticker per piece, each with a 0–100 score and the reason it was picked.
  - **Worth buying for this spot**: shop pieces that clearly beat what you own.
  - **Put it on the table**, which adds the look to the bookmark table draft.
  - **How Neor picked this**, a collapsible explanation of the steps below.

**Data.** It opens on six hand-picked Seattle spots, so it works offline at DubHacks: Kerry Park, Gas Works, Suzzallo, Cafe Allegro, the Conservatory, Pike Place. **Look around** calls `POST /api/ai/places {city}`, which returns real OpenStreetMap cafes, viewpoints, parks and galleries chosen by the AI. If that fails, it falls back to the Seattle set with a note.

### 6.2 The logic

All of it runs in **OKLCH**, so lightness and hue distance match what eyes see. Everything is deterministic, and the reasons shown are the real reasons.

**1. Every place gets a backdrop palette.** OSM gives a *kind* but no photos. Each kind has a weighted palette of what typically fills the frame. For example, cafe = walnut 4, cream 3, espresso 2, amber 1, and park = leaf green 5, light green 2, sky 2, bark 1. The demo spots override this with their own palettes (Gas Works = rust towers + lawn + sky).

**2. Light changes the backdrop.** The palette is mixed in OKLab toward a light colour:

| Time | Tint | Amount |
|---|---|---|
| Morning | cool | 12% |
| Midday | white | 10% |
| Golden hour | amber | 28% |
| Evening | navy | 35% |

**3. Each garment is scored against the backdrop.** The **hue fit** depends on the mode. It's measured against the backdrop's main colour, and the main colour must have chroma above 0.03.

| Mode | Hue fit | Brightness fit | Saturation fit |
|---|---|---|---|
| Stand out | Peaks at 180° (complementary), second peak at 145° (split) | Bigger light/dark gap = better (full marks at ΔL ≥ 0.35) | Rewards saturated pieces |
| Blend in | Peaks at about 22° (analogous) | Best at ΔL ≈ 0.15 (close but not identical) | Rewards muted pieces |

The score combines them: `0.55 × hue + 0.35 × brightness + 0.10 × saturation`.

Neutrals score lower in Stand out mode (0.45) and higher in Blend in (0.78). In fashion, denim, navy, camel, olive and brown all count as neutrals.

**4. The look is built so it agrees with itself, not just with the wall.**
- The hero is the best-scoring top or dress.
- Each following slot (bottom, then shoes) scores `0.45 × backdrop + 0.55 × pairing with the pieces already chosen`.
- A layer (jacket) is only added if it *raises* the outfit's harmony score.
- Only in-season pieces are used, and nothing from the laundry basket.

**5. Shop pieces only appear when they're clearly better.** One is suggested when it beats your own best option for that slot by more than 10 points, or fills a slot you have nothing for. The card says by how much ("Scores 82 here vs 64 for your denim jacket").

### 6.3 Outfit harmony (`harmonyOf`, used by the table, mirror and window)

Neutrals are ignored, and the remaining coloured pieces are classified:

| Coloured pieces | Name | Score |
|---|---|---|
| 0 | Tonal neutrals | 84 (68 if all the same brightness) |
| 1 | Single accent | 90 |
| 2+, all within 40° | Analogous | 86 |
| 2, 150°+ apart | Complementary | 82 (with a tip to keep it 70/30) |
| 2, 100–150° apart | Split contrast | 76 |
| 3, evenly spaced | Triadic | 74 |
| Anything else | Competing colours | 52 or less |

Mixing warm and cool costs 4 points.

---

## 7. Critique, archive, profile

**The lion** (`/critique`)
- A portrait cropped from the room render, in an oval frame, with the lion's verdict in italics.
- `POST /api/ai/weak-spots` → a versatility score out of 100, a summary, and gaps. Each gap has a priority, roughly how many outfits it unlocks, and 1–2 catalog pieces with **Try it on the table**.
- A local **Essentials** checklist is always shown, and works with the AI off: a plain light top, dark bottoms, a neutral layer, walkable shoes, something warm, one dressy piece, a bag.

**Archive** (`/archive`)
- Polaroid-style cards: the mirror photo with stickers alongside, or stickers alone, plus date, occasion, harmony and verdict.
- A star toggles favourite. Filter between **All** and **Favourites**. Each card can be deleted.

**Profile** (`/profile`)
- Name (`PUT /api/profile`), piece count and points.
- **Sign out**.
- **Forget me** (`DELETE /api/me`, which also clears local storage).

---

## 8. Backend asks (for the API team)

The frontend already sends or expects all of these. Each is small.

1. **Exclude laundry from AI.** In `/api/ai/outfit`, `/weak-spots`, `/shop` and `/places`, filter `[i for i in items if not i.get("laundry")]` before building prompts. Right now laundry is only respected on the frontend.
2. **Boards and looks endpoints.** `lib/saved.ts` uses localStorage for now, with matching signatures. Suggested routes:
   - `GET|POST /api/boards`, `DELETE /api/boards/{id}`, body `{name, pieces: BoardPiece[]}`
   - `GET|POST /api/looks`, `PATCH /api/looks/{id}` `{favorite}`, `DELETE /api/looks/{id}`

   Store them like `orders` (jsonb `data`). Shapes are in `src/lib/types.ts`. Only `saved.ts` needs to change on the frontend.
3. **Finer tagging, optional.** Have `/api/items/analyze` also return `rack`, one of the 14 ids in §4.1. The frontend uses it if present and guesses from the name otherwise.
4. **Mirror context, optional.** `/api/ai/outfit` currently gets the outfit through `place: "wearing: …"`. A proper `pieces: [...]` field would give a better read.
5. **Place photos, optional.** If `/api/ai/places` passes through OSM `image` / `wikimedia_commons` tags, the frontend can sample a real palette from the photo instead of using the per-kind palette.

---

## 9. Design rules (so it doesn't look generated)

- **Materials, not gradients.** Oak, linen, walnut, brass, paper grain (an SVG noise data URI in `--grain`). No glassmorphism, no purple-blue gradients, no blob backgrounds.
- **Type.** *Cormorant Garamond* for display and names, matching the logo in the render. *Figtree* for UI. Headings are sentence case.
- **No emoji, no sparkle spam.** Icons are one hand-drawn 24px stroke set (`components/Icon.tsx`). The sparkle appears only on the AI button.
- **Objects over cards.** Racks look like racks, the table like a table, the basket like a basket, tags like paper tags. Use a plain card only where the content is text.
- **Copy has a voice but stays short.** "Drop things you're not wearing out. They stay yours; Neor just won't suggest them." Every AI claim comes with its reason.
- Tokens are in `styles/app.css` `:root`. Each page has its own stylesheet.

## 10. Known gaps

- The doors are procedural SVG. For photo-real doors, drop in the two JPGs (§2).
- Boards and looks are stored per browser until §8.2 lands.
- The background-removal model is AGPL-licensed (fine for a hackathon). Its WASM is about 24MB, but it's lazy-loaded only when someone uploads.
- OSM tile usage policy is fine for a demo. Switch to a keyed tile provider before any real launch.

---

## 11. Getting around: the tab rail

Every room page shares `PageFrame`. It has the brass **The room** plate, plus a tab rail: Closet · Mirror · Window · Lion · Archive · Profile. The current room is underlined in brass.
- **Tablets:** the rail shows icons only.
- **Phones:** it becomes a bottom tab bar, and sticky bars and toasts move up so they don't cover it.

The bookmark table also has a **Try it on** button that goes straight to the mirror. The mirror shows the table as it is right now, so there's no need to save first. If the table is empty, it shows the last saved board.

## 12. The mascot (`src/lib/mascot.ts`)

- **The lion is a real one:** an Asiatic lion at Tierpark Berlin. The photo is by A. Savin under the Free Art License, saved as `public/mascot/lion.jpg`.
- **Credit is required.** The licence requires credit, and it's shown on the lion's verdict page. Keep it if you swap the photo.
- **Where it appears:**
  - The lion's hover tag in the room.
  - The portrait on `/critique`.
- **Right-click** the lion in either place for a small menu:
  - **Watch a lion montage on YouTube**, which opens `MASCOT.montage`.
  - **Ask for a closet critique.**

  On Android, a long-press does the same.
- **To use your own lion:** set `name`, `zoo`, `photo`, `credit` and `montage` in `mascot.ts`. Nothing else changes.
- **The lion in the room render** is still the rendered one. Replacing it needs a new render or a composited photo of `public/room/walk-in.png`.

## 13. Profile (`/profile`)

Every field is optional and saves with `PUT /api/profile`. If the server is unreachable, it saves to the device instead.

| Section | Fields (profile key) |
|---|---|
| The basics | `name`, `age`, `gender` (list, "I'll describe it", or "Prefer not to say"), `pronouns` |
| Faith & dress guidelines | `tradition`, `modesty` (`none` / `modest` / `very modest`, the values the AI already understands), `dress_rules[]` (arms covered, head covering, no leather…), `modesty_notes` (free text) |
| Your style | `styles[]`, `colors_love[]`, `colors_avoid[]` (one colour can't be in both lists) |
| Fit & sizes | `measurements: {height_cm, top_size, bottom_size, shoe_size, fit}` |
| Life & budget | `budget`, `climate`, `ai_consent` |

A sticky save bar shows when there are unsaved changes. The profile page also has **Sign out** and **Forget me**.

**Backend change, already made:** `age`, `gender`, `pronouns`, `tradition` and `dress_rules` were added to the allow-list in `app/main.py`. All of them except pronouns are also passed to the AI in `_profile_brief` in `app/ai.py`.

## 14. Optional features (`src/features/`)

Optional features plug in through `src/features/index.ts`. Each feature declares its routes and an optional `HallwayNotice`. The router and the hallway render whatever is in that list, and nothing else in the app knows about the feature.

**Bargain finder** (`src/features/bargains/`)
- **In the hallway:** a kraft-paper notice pinned next to the sign-in card, linking to `/bargains`. That page is public, so no sign-in is needed to open it.
- **The page:** search a city and get a list of nearby thrift, vintage and boutique shops, each with a map link.
- **The data seam:** `source.ts` → `findBargains(city)`. It currently uses `/api/ai/places` and keeps the clothing shops. Plug the real bargain service in there, using the `Bargain` shape (`price` and `url` are supported).
- **To hide it:** set `VITE_FEATURE_BARGAINS=off` in `frontend/.env`.
- **To remove it:** delete `src/features/bargains/` and its line in `src/features/index.ts`.
