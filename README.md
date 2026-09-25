# Setpoint

A self-hosted nutrition and training tracker that **measures** your energy expenditure instead of guessing it, then sets weekly calorie and macro targets from what your scale and food log actually did.

No subscription. Static files on GitHub Pages, and your data stays in your browser. Optional encrypted sync and Apple Health import run through a free Cloudflare Worker that you own.

## Features

| | |
|---|---|
| **Dashboard** | Weekly nutrition grid (calories, protein, fat, carbs × 7 days) with a Consumed / Remaining toggle. Insight cards for expenditure, weight trend, energy balance, goal progress, body metrics, streak. |
| **Food Log** | Hour-by-hour timeline, week strip, macro bar. Search 170+ built-in foods: Singapore hawker dishes (56 with Health Promotion Board calorie figures), drinks and basics. Saved meals logged in one tap, small / regular / large / upsized portions, recent and frequent foods, quick add, custom foods, barcode scan via Open Food Facts. Copy a day, mark fasting days. |
| **What fits now** | On today's Food Log (or the + menu): 4 things to eat next that fit what's left of your calories and protein, sized for the meal you pick (breakfast, lunch, snack, dinner or the rest of the day), each with calories, protein, fat and carbs and what it leaves you. *Show different options* reshuffles without repeats. Draws on the hawker list, your foods and saved meals, favours what you eat often, adds a protein side (eggs, tofu, soy milk) when a dish is light on protein, and never suggests something that blows the day. One tap logs it. |
| **Train** | Plan builder (goal, 2–5 days, bodyweight / pull-up bar / dumbbells / gym, beginner or intermediate) picks exercises by movement pattern. Workout logger with weight, reps and reps-in-reserve per set, rest timer, swap to alternatives. Double progression tells you when to add weight or move to a harder variation. Rating each session nudges next time's volume. **Freestyle:** tap muscles on a body diagram, pick the equipment you have today, and get a session from 740 exercises. **Recovery map:** each muscle shows ready / nearly ready / recovering from the hard sets you logged in the last few days, with hours to go. Freestyle can suggest fresh muscles, steers exercise picks away from tired helper muscles, and the next plan workout flags any muscles that are still recovering and suggests a fresher plan day if one exists. Weekly hard-set view per muscle. Demo images and step-by-step form cues, loaded online so the repo stays small. |
| **Conditioning** | HIIT interval timer: low impact, intermediate, advanced and Tabata presets, all adjustable. Countdown ring, voice cues, beeps, and the screen stays awake. |
| **Strategy** | Weekly check-in that recalculates targets and shows exactly what moved them. Program with optional weekend calorie bump. Goal with rate, progress and arrival date. Check-in history. |
| **Charts** | Every metric has a detail view with 1W / 1M / 3M / 6M / 1Y / All ranges. Press and drag to read any day. |
| **Body** | Weigh-ins with body fat and muscle, lean-mass breakdown, and a goal-weight check that flags goals you can't reach without losing muscle. |
| **Sync & Apple Health** | Optional. End-to-end encrypted sync between devices, with a record-level merge so logging on two devices never loses an entry. A Shortcut sends each morning's weigh-in, body fat and steps from Apple Health (e.g. Mi scale → Zepp Life → Health). See `worker/README.md`. |
| **AI plan import** | The coach report asks the AI to end with a `SETPOINT PLAN` block. Paste it into Train → ⋯ → *Import plan from AI*: each exercise is matched to the 740-exercise library (loose matches and equipment you don't have are flagged, with alternatives one tap away), then it replaces your plan. History and per-exercise progression carry over; *Restore previous plan* undoes it. |
| **AI coach report** | Pick a date range (7/14/30/90 days or custom) and copy or share a plain-text report: profile, goal, weight trend, measured expenditure, targets, a daily table, every food item, every set (kg × reps @ reps in reserve), weekly sets per muscle and check-ins. It starts with a personal-trainer prompt for ChatGPT, Claude or Gemini. |
| **Data** | One-tap backup through the share sheet (Save to Files / iCloud Drive on iPhone) with a reminder every 3, 7 or 14 days. JSON import, download and copy-as-text fallbacks. Offline support, light and dark themes. |

## What it does differently

1. **Expenditure with an error bar.** A two-state Kalman filter tracks your weight and expenditure together and reports its own uncertainty, so every expenditure figure comes with an honest ±1σ band. Days you didn't log are treated as unknown rather than ignored.
2. **Energy per kilo that depends on you.** With a body-fat reading, the lean share of any weight change follows the Forbes curve, and fat and lean tissue are priced separately (Hall 2008) instead of a flat 7700 kcal/kg.
3. **Goal feasibility.** With a body-fat reading, Setpoint works out your lean mass and tells you what body-fat percentage your goal weight implies. It flags a goal you can't reach without losing muscle.
4. **A hard floor.** Targets never drop below your estimated resting metabolic rate. If your requested rate would go below it, the target holds at the floor and the app tells you the rate you'll actually get.
5. **Explained check-ins.** Each check-in splits the change into expenditure movement, goal-rate effect and trend-weight change.
6. **Exercise calories are never added back.** Your workouts are already inside the measured expenditure, so the app shows a MET estimate for interest and leaves your food budget alone.

## First launch

With no saved data, Setpoint opens a welcome screen instead of the dashboard: **Set me up** (age, height, activity, weight and optional body fat, goal and pace, training days, equipment and experience, then a summary with calories, macros, arrival date and a training plan), **Restore from a backup**, **Sync from my other device**, or **Just look around** with example data. Clearing the example data takes you into the same setup.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (public, for free Pages).
2. Upload every file in this folder, keeping the folder structure (about 25 files, one drag-and-drop). Include `.nojekyll` and `.github/`.
3. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute the app is live at `https://<username>.github.io/<repo>/`.

**On iPhone:** open that URL in Safari → Share → **Add to Home Screen**. It then opens full-screen and works offline.

**Shipping an update:** change the files, bump `VERSION` in `sw.js`, push. `sw.js` is the single source of the version number. The app checks it a few seconds after launch (and every 6 hours while open), shows an *Update* banner when the server has a newer version, and More → Version has a manual *Check* button. Tapping *Update* installs the new files past every cache and reloads, so there's no need to clear Safari's cache. Forget to bump `VERSION` and phones won't see the change.

## Your data

Everything lives in `localStorage` in the browser you use. That's private, but fragile:

- Safari can clear storage for sites you haven't opened in a while. Installing to the Home Screen and opening it regularly helps.
- "Clear History and Website Data" wipes it instantly.

**Back up with More → Back up now.** On iPhone this opens the share sheet; choose *Save to Files* and pick iCloud Drive. Import the file to restore it or move to another device. The dashboard reminds you on the schedule you choose in More → Your data.

## How the estimate works

**Kalman filter (default).** The state is today's true weight and your daily expenditure. Each morning the weigh-in corrects both; each day's intake predicts tomorrow's weight:

```
weight(tomorrow) = weight(today) + (intake − expenditure) / energy-per-kg
```

- The filter starts from a formula estimate (Mifflin-St Jeor, or Katch-McArdle with a body-fat reading) with a ±350 kcal prior, and the measurement takes over as data arrives.
- An unlogged day is assumed to be eaten at maintenance, with ±600 kcal uncertainty. In testing, that halved the error from skipping heavy days compared with the window fit.
- Noise settings: scale ±0.55 kg, expenditure drift 22 kcal/day.

**Window fit (option).** A least-squares line through the last 14–35 days of weigh-ins, compared with mean intake over the same days. Simpler to reason about; its error band ignores intake noise, so it reads more confident than it should.

Both clamp results to 0.95×–2.8× your resting rate and flag anything outside.

**What throws it off:** under-logging (the estimate reads low by the same amount), and logging only the clean days. If a day can't be logged properly, log a rough guess.

## How training progresses

- **Plans** follow movement patterns (squat, hinge, lunge, horizontal and vertical push and pull, core, plus arms, shoulders and calves for a muscle goal). Two or three days a week alternate Full Body A and B; four or more run Upper/Lower. The plan picks the best exercise your equipment allows, and a vertical pull falls back to a row if you don't have a bar.
- **Double progression:** hit the top of the rep range on every set with at least one rep in reserve → add one weight step (2 kg dumbbells, 2.5 kg gym) and restart at the bottom of the range. Two steps if every set was easy (3+ in reserve). Fell short of the range at failure → drop about 10%. Otherwise keep the weight and aim for one more rep.
- **Bodyweight** moves progress to harder variations (incline push-up → push-up → feet-elevated), and holds add 5 s per session up to 90 s.
- **Session rating:** "way too easy" adds a set to every exercise that day, "way too hard" removes one (always 2–5 sets).

## How recovery is estimated

Each hard set loads its muscle group (helper muscles count half; sets stopped 4+ reps short count half, sets to within one rep of failure count fully). That load fades to zero over 72 h for big groups (legs, back, chest) and 48 h for smaller ones, in line with the usual 48–72 h guidance between hard sessions for the same muscle (ACSM position stand, *Med Sci Sports Exerc* 2009;41:687-708). About six hard sets just done reads as fully fatigued; a muscle is "ready" once it's back under a quarter of that. It's a rule of thumb built from your log, not a measurement: sleep, food, soreness and how hard the sets really were all matter, and the app can't see them. Treat it as a reminder, and trust how you feel over it.

## Known limits

- **Scale sync goes through Apple Health.** Safari has no Web Bluetooth, so the scale can't talk to the app directly. Zepp Life writes to Health, and the Shortcut forwards it when Zepp Life closes. Health can't be read while the phone is locked, so a fixed-time automation won't work.
- **Exercise images need a connection the first time.** They come from free-exercise-db via jsDelivr and are cached once you've seen them. Seven custom moves have no image and show an icon.
- **The equipment filter is coarse.** "Dumbbell" includes moves that also need a bench, and some "Bodyweight" moves (dips) need bars. Swap anything you can't do.
- **AI photo estimates go through your own chatbot.** A static site can't keep an AI API key secret, so the AI Photo tab gives you a prompt to use in ChatGPT (or Claude, Gemini) with your photo, and reads back the answer you paste in. Expect ±20–40% on mixed plates; hidden oil is the usual miss. Consistency matters more than accuracy here, because the expenditure estimate calibrates against whatever you log.
- **Hawker values.** Dishes tagged HPB use Health Promotion Board calories for a standard portion (HPB published calories only, so their macros are Setpoint's split scaled to match). Others are Setpoint's estimates. Check your regulars against [HPB SG FoodID](https://www.hpb.gov.sg/healthy-living/food-and-beverage/sgfoodid/) and save your own versions under My Foods; they rank first in search.
- **HIIT voice cues** need the phone's ringer on, and they pause if you lock the screen or switch apps. The timer catches up when you return.
- **Barcode camera scanning** uses the browser's built-in BarcodeDetector where available and loads ZXing from jsDelivr on iOS. You can always type the barcode by hand.

## Development

```
index.html              shell, loads everything below
css/app.css             all styles; light and dark tokens at the top
js/engine.js            pure maths (Kalman filter, targets, training progression), runs in Node too
js/foods.js             built-in food list with sources
js/exercises.js         exercise library by movement pattern
js/charts.js            SVG charts with draw-in animation and scrubbing
js/exlib-full.js        full 740-exercise library, loaded on demand
js/train.js             training views, body map, freestyle, workout logger, HIIT timer
js/sync.js              encryption, record-level merge, Worker client
js/app.js               nutrition views, sheets, state, sync screens, barcode
worker/                 Cloudflare Worker for sync and the Health inbox
sw.js                   offline cache
test/                   engine, sync and worker tests (node test/<file>)
```

No build step and no dependencies. Serve the folder with any static server, e.g. `python3 -m http.server`, and open `http://localhost:8000`. The service worker only registers over HTTPS, so local development is never cached.

Tests run on every push via GitHub Actions.

## Sources

- Mifflin MD et al. *Am J Clin Nutr* 1990;51:241-7.
- Katch-McArdle: RMR = 370 + 21.6 × fat-free mass (kg).
- Morton RW et al. *Br J Sports Med* 2018;52:376-84. Helms ER et al. *JISSN* 2014;11:20.
- Forbes GB. *Ann N Y Acad Sci* 2000;904:359-65. Hall KD. *Int J Obes* 2008;32:573-6.
- Schoenfeld BJ et al. *J Sports Sci* 2017;35:1073-82 (weekly sets and hypertrophy).
- Ainsworth BE et al. *Med Sci Sports Exerc* 2011;43:1575-81 (Compendium of Physical Activities, MET values).
- Hawker calories: Health Promotion Board, via the iDAT app, as compiled at [danielfooddiary.com](https://danielfooddiary.com/2015/09/28/calories/).
- Exercises and images: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain).
- Barcode data: [Open Food Facts](https://world.openfoodfacts.org) (ODbL).

## Disclaimer

Not medical advice. Setpoint is a calculator whose source you can read. If it disagrees with your doctor or dietitian, go with them.

MIT licensed.
