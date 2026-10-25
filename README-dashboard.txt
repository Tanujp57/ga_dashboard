Georgia Elections Dashboard

To run: open index.html in a web browser. No install, server, or internet connection is needed.

Tabs:
- Story (default): how Georgia flipped from Democratic to Republican, first for
  president (1964), then U.S. Senate (1980), then governor (2002).
- President: paired county maps (presidential margin and a demographic of your
  choice) with a shared election-year slider. Hover a county to outline it on both maps.
- President / Governor / U.S. Senate: statewide vote share and margin over time.

To update the data: edit files in data/, then run `python build_data.py`
(requires pandas). This regenerates data.js, which index.html loads.
