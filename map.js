// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
// Import D3 as an ES Module
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiYW1ydXRoYXBvdGx1cmkiLCJhIjoiY21oeTQwOTAyMDhmdzJqb2kyenhqZzMxeiJ9.XVLggrqPhgIKauPEJAkpKQ'; // <-- REPLACE THIS

// === GLOBAL HELPER FUNCTIONS & VARIABLES ===

// Pre-allocate buckets for performance optimization (Step 5.4)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Quantize scale for station flow color (Step 6.1)
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

/**
 * Converts longitude/latitude to pixel coordinates. (Step 3.3)
 * @param {object} station - A station object with {lon, lat}
 * @returns {object} - An object with {cx, cy} pixel coordinates
 */
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

/**
 * Formats minutes since midnight as HH:MM AM/PM. (Step 5.2)
 * @param {number} minutes - Minutes since midnight (0-1440)
 * @returns {string} - Formatted time string
 */
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

/**
 * Converts a Date object to minutes since midnight. (Step 5.3)
 * @param {Date} date - The date object
 * @returns {number} - Minutes since midnight
 */
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Efficiently filters trips from pre-computed buckets. (Step 5.4)
 * @param {Array} tripsByMinute - departuresByMinute or arrivalsByMinute
 * @param {number} minute - The selected time filter (-1 for all)
 * @returns {Array} - A flat array of filtered trips
 */
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

/**
 * Re-computes station traffic based on a time filter. (Step 5.4 Refactor)
 * @param {Array} stations - The base array of station objects
 * @param {number} timeFilter - The selected minute (-1 for all)
 * @returns {Array} - The stations array updated with new traffic counts
 */
function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with filtered counts
  return stations.map((station) => {
    let id = station.short_name;
    // We create new properties on the station object
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// === MAP INITIALIZATION ===

const map = new mapboxgl.Map({
  container: 'map', // ID of the div
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom
  minZoom: 10,
  maxZoom: 18,
});

// === MAIN DATA LOADING AND VISUALIZATION ===

map.on('load', async () => {
  // --- 1. Add Bike Lane Layers (Step 2) ---

  // Define a reusable paint style for bike lanes
  const bikeLanePaint = {
    'line-color': '#32D400', // Bright green
    'line-width': 3,
    'line-opacity': 0.6,
  };

  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  // --- 2. Load Station and Trip Data (Step 3 & 4) ---

  // Load station info
  const jsonData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );
  // Keep a copy of the original station data
  const originalStations = jsonData.data.stations;

  // Load trips, parse dates, and populate time buckets (Step 5.3 & 5.4)
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      // Parse dates
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      // Populate optimization buckets (Step 5.4)
      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);

      let endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    }
  );

  // --- 3. Initial Traffic Calculation & Scaling (Step 4 & 5.4) ---

  // Compute initial traffic for *all* trips (default timeFilter = -1)
  const stations = computeStationTraffic(originalStations);

  // Create the radius scale (Step 4.3)
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]); // Default range for "all time"

  // --- 4. Draw D3 SVG Circles (Step 3.3, 4.4, 6.1) ---

  // Select the SVG element
  const svg = d3.select('#map').select('svg');

  // Create circles
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // Key function (Step 5.3)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic)) // Size by traffic
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic)
    ) // Color by flow (Step 6.1)
    .each(function (d) {
      // Add <title> for browser tooltips (Step 4.4)
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // --- 5. Map & Circle Positioning (Step 3.3) ---

  // Function to update circle positions when the map moves/zooms
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  // Initial position update when map loads
  updatePositions();

  // Reposition markers on map interactions
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // --- 6. Slider Interactivity (Step 5) ---

  // Select DOM elements for the slider
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  /**
   * Updates the scatterplot circles based on the time filter. (Step 5.3 / 5.4 / 6.1)
   * @param {number} timeFilter - The selected minute (-1 for all)
   */
  function updateScatterPlot(timeFilter) {
    // Recompute station traffic based on the filtered trips
    const filteredStations = computeStationTraffic(originalStations, timeFilter);

    // Update the radius scale's range based on the filter (Step 5.3)
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius and color of circles
    circles
      .data(filteredStations, (d) => d.short_name) // Use key
      .join('circle') // D3's join handles enter/update/exit
      .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic)
      ); // Update colors
  }

  /**
   * Updates the time display and triggers the scatterplot update. (Step 5.2 / 5.3)
   */
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
  }

  // Bind the slider's input event
  timeSlider.addEventListener('input', updateTimeDisplay);
  // Initial call to set the display correctly on load
  updateTimeDisplay();
});