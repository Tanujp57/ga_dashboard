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
- Preserved the statewide winner-square timeline near the top of the story and kept only the Georgia-minus-national presidential margin chart (the duplicate raw presidential-margin chart was removed). The relative-margin chart includes annotated turning points and hover details for Georgia’s actual margin.
- Reworked office comparisons into three linked statewide margin charts with fixed legends and no confusing hide/show toggles. Senate races are grouped by seat; the runoff result supersedes the general-election result, while same-year seat decisions are offset for readability. The 1966 gubernatorial Democratic comparison includes Ellis Arnall’s write-in share, with the calculation disclosed in the tooltip and caption.
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

## Readability and legend update (November 2026)

- Increased body-copy, annotations, captions, control labels, tooltips and Plotly chart text, with mobile overrides.
- Added in-chart legends to the winner timeline and statewide margin charts, and preserved the party-series legend on vote-share plots. Legend clicks are disabled so comparing figures does not accidentally hide categories.
- Split Georgia-versus-U.S. bars into labeled red/blue series (more Republican/more Democratic relative to the nation). Added a separate red/blue D-versus-R margin legend for the Explore statewide chart.
- Added a labeled continuous D-minus-R color scale to the county scatterplot, plus a color legend to the opening map. The story and Explore county maps already have gradient legends.
- Gave charts more height and room for legible legends. No data changes were made.

## Linked charts and milestone timeline (November 2026)

- **Consolidation:** The raw presidential-margin graph in the three-office section was removed. The Georgia-versus-national presidential-margin chart is the sole presidential chart in that section. Hover its bars for Georgia's actual Democratic-minus-Republican margin, the national margin, and the difference between them. Major turning points (1964, the Carter years, 2020) are annotated.
- **Linked year comparison:** Hover a presidential, Senate, or gubernatorial bar to preview that election year in all three charts. A gold band marks the same year *only in panels that have a result for that year*. Click any bar to pin a year; select a year chip to pin one of the featured years (1964, 1980, 2002, 2020), or use **Clear**. The summary reports each office's available result and explicitly identifies years without a recorded race. Choosing a year also sets the Explore map to its nearest available **presidential county-election** year; it does not invent county Senate or governor results.
- **Animated milestones:** The three-stage timeline under “The change came in stages” advances from presidency (1964) through Senate (1980) to governor (2002). It automatically plays once when scrolled into view, can be replayed, and offers three clickable year milestones with their own explanatory text. Use **Compare [year] in the linked charts** to select that same year in the chart comparison and scroll back to it. When reduced-motion is requested, the automatic animation is disabled and the milestone buttons continue to work.
- All changes are in `index.html`, `styles.css`, and `app.js`. Original data scripts, geometry and survey CSV remain unchanged.

## Testing and limitations

- Verified JavaScript syntax and local asset references during implementation; the app contains no remote data dependencies. Google Fonts are an optional stylesheet import; local fallbacks are defined for offline/preview use.
- Tested with Chromium using local embedded scripts and styles: all seven Plotly graphs rendered, all office-chart legends appeared, the linked selection worked across charts, the stage controls updated their explanatory text, and the existing Explore graph still rendered. No page-level JavaScript errors were observed. The tested desktop (1440 px) and mobile (390 px) viewport widths had no horizontal overflow. Browser navigation via localhost was restricted in the test environment, so testing used an equivalent in-memory page with the same bundled assets and without the optional Google Fonts import.
- The county map displays **presidential** county results only. It intentionally does not imply county-level Senate or governor outcomes.
- Demographic snapshots are limited to 2000, 2010 and 2019. Survey CSV data is retained but not integrated into charts.
- A few historical outcomes have special context (third-party winners, runoffs, write-ins, unopposed races, or legislative selection). Hover text and the story explain key caveats, but a two-party margin does not fully represent every such contest.
