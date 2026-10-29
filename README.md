To run: click index.html and it should load in your browser.

If you're having issues running this, please notify someone on the team immediately so we can resolve it. The person writing this README (Shahid) can be reached at shahidibrahim@gatech.edu.

# Georgia, one office at a time

An offline-friendly, no-build editorial scrollytelling redesign of the supplied Georgia Elections Dashboard. It keeps the original election records, county results, county geometry, Plotly charts, and survey CSV. Open `index.html` in a browser; no install, build step, or server is required.

## Run locally

1. Keep the files in this directory together.
2. Open `index.html` in a modern browser (double-click works; the project uses local classic scripts and bundled assets).
3. Scroll through the story. The county map responds to the active chapter. Use **Explore the elections** to change presidential years, map measures, statewide office, and county comparison.

If your browser blocks local files, use a simple static file server from this folder, for example `python3 -m http.server 8000`, then visit `http://localhost:8000`. A server is optional, not a project requirement.

## Files

- `index.html` — semantic page structure and narrative.
- `styles.css` — responsive editorial design, sticky scrollytelling layout, reduced-motion and focus styling.
- `app.js` — map rendering, county cross-highlighting, scroll states, controls, tooltips, and Plotly charts.
- `data.js` — unchanged supplied election and demographic data (`window.GA`).
- `georgia_counties.js` — unchanged bundled Georgia county geometry (`window.GEO`).
- `plotly.min.js` — unchanged supplied Plotly bundle; used for interactive charts.
- `georgia_exit_poll_data.csv` — supplied standardized survey/exit-poll file, retained as a project asset. It is not used for the narrative or to infer county-level voting behavior.

## What changed

- Reframed the opening as a long-form feature and the core story as five scroll-activated chapters.
- Added a persistent Georgia county map that changes year and measure with the active chapter, plus a 1960–64 county margin-swing view.
- Restored the statewide winner-square timeline near the top of the story, the Georgia-minus-national presidential margin chart, and the original chart captions and annotations.
- Reworked office comparisons into separate, aligned statewide margin charts with fixed legends and no confusing hide/show toggles. Senate races are grouped by seat; the runoff result supersedes the general-election result, while same-year seat decisions are offset for readability. The 1966 gubernatorial Democratic comparison includes Ellis Arnall’s write-in share, with the calculation disclosed in the tooltip and caption.
- Added linked county hover/focus highlighting, accessible county details, keyboard-operable year controls, responsive chapter navigation, and a direct exploration section.
- Preserved the original statewide vote-share and margin charts, county election data, demographic map measures, and county-versus-demographic scatterplot.
- Kept the source records intact. Margins and Goldwater's two-party share are calculated from supplied data at runtime; no new election results are introduced.

## Data notes and source context

The original dashboard's source descriptions are reflected in its data/UI notes and retained in `app.js`:

- Presidential statewide results: MIT Election Data + Science Lab (1976–2020), Wikipedia (1960–72), and project-compiled results (1948–56 and 2024).
- Presidential county results: Wikipedia (1960–2004) and tonmcg/GitHub (2008–2024).
- County demographic snapshots: Census Bureau population estimates (2000, 2010, 2019).
- Gubernatorial results: Wikipedia; Democratic-primary-only and uncontested general-election years (1962) are omitted from the main supplied race series.
- Senate: MIT Election Data + Science Lab (2004–2021), Wikipedia for other years, and project-compiled records for 1972, the 1992 general election, and the 2022 runoff. Some unopposed years are carried in the supplementary `GA.extra` records.

County presidential margin is `100 × (Democratic votes − Republican votes) ÷ total votes`. Democratic margins are blue; Republican margins are red. The demographic map uses the nearest supplied demographic snapshot and displays its year. Population and demographic patterns are presented descriptively, not as causal explanations. The supplied 1986–2022 survey CSV is retained but not analyzed here; the source project did not provide a documented weighting/mapping analysis suitable for adding demographic claims.

The project originally supplied only a short run instruction in `README.txt`; no separate process book was present among the attached files.

## Testing and limitations

- Verified JavaScript syntax and local asset references during implementation; the app contains no remote data dependencies. Google Fonts are an optional stylesheet import; local fallbacks are defined for offline/preview use.
- This environment did not provide an interactive real-browser session for end-to-end inspection. Scroll-trigger behavior, browser-specific local-file restrictions, and assistive-technology announcements therefore need final confirmation in the target browser.
- The county map displays **presidential** county results only. It intentionally does not imply county-level Senate or governor outcomes.
- Demographic snapshots are limited to 2000, 2010 and 2019. Survey CSV data is retained but not integrated into charts.
- A few historical outcomes have special context (third-party winners, runoffs, write-ins, unopposed races, or legislative selection). Hover text and the story explain key caveats, but a two-party margin does not fully represent every such contest.
