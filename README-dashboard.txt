Georgia Elections Dashboard — Paired County Maps

1. Extract this archive.
2. Open ga_dashboard/index.html in your browser. The maps and charts work directly from the files (no server required).
   Or, optionally, run `python dashboard.py` from the ga_dashboard folder.
3. Use the shared election-year slider for both maps.
4. Use the dropdown above the right map to choose a demographic variable.
5. Hover a county in either map to outline the same county in both maps.

The left map always shows presidential margin (Democratic minus Republican).
The demographic figures are Census estimates available for 2000, 2010, and 2019;
the closest available snapshot is displayed next to the current election year.

All resources are local, including Georgia county geometry in georgia_counties.js.
For manual updates to a previous version of the project, replace index.html
and add georgia_counties.js to the same directory.
