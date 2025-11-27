// Constants
const g = 9.81; // gravity (m/s^2)
const rho = 1.225; // air density (kg/m^3)
const Crr = 0.004; // rolling resistance coefficient

// State
let gpxData = null;
let map = null;
let mapPolyline = null;
let hoverMarker = null;
let simulationDataGlobal = null;
let selectedRange = null; // {start: index, end: index}
let selectionOverlay = null; // Visual overlay for selection on map
let isSelecting = false;
let selectionStart = null;
let charts = {
    elevation: null,
    slope: null,
    speed: null,
    power: null,
    progress: null
};

// DOM Elements
const fileInput = document.getElementById('gpx-file');
const resultsDiv = document.getElementById('results');

// Parameter inputs
const weightInput = document.getElementById('weight');
const weightSlider = document.getElementById('weight-slider');
const cdaInput = document.getElementById('cda');
const cdaSlider = document.getElementById('cda-slider');
const pmaxInput = document.getElementById('pmax');
const pmaxSlider = document.getElementById('pmax-slider');
const vmaxInput = document.getElementById('vmax');
const vmaxSlider = document.getElementById('vmax-slider');

// Event Listeners
fileInput.addEventListener('change', handleFileUpload);

// Sync inputs and sliders, and trigger auto-simulation
function setupParameterSync(input, slider) {
    // Sync slider to input
    input.addEventListener('input', (e) => {
        slider.value = e.target.value;
        autoSimulate();
    });
    
    // Sync input to slider
    slider.addEventListener('input', (e) => {
        input.value = e.target.value;
        autoSimulate();
    });
}

// Setup all parameter syncs
setupParameterSync(weightInput, weightSlider);
setupParameterSync(cdaInput, cdaSlider);
setupParameterSync(pmaxInput, pmaxSlider);
setupParameterSync(vmaxInput, vmaxSlider);

// Auto-simulate function with debounce
let simulateTimeout = null;
function autoSimulate() {
    if (!gpxData) return;
    
    // Debounce to avoid too many calculations while dragging slider
    clearTimeout(simulateTimeout);
    simulateTimeout = setTimeout(() => {
        runSimulation();
    }, 150);
}

// Load default GPX file on page load
async function loadDefaultGPX() {
    try {
        const response = await fetch('default-route.gpx');
        if (response.ok) {
            const text = await response.text();
            gpxData = parseGPX(text);
            
            if (gpxData && gpxData.points.length > 0) {
                console.log(`Loaded default route with ${gpxData.points.length} points`);
                // Auto-simulate after loading default GPX
                runSimulation();
            }
        }
    } catch (error) {
        console.log('No default GPX file found or error loading it:', error);
        // Silently fail - user can upload their own file
    }
}

// Reset zoom button and load default GPX on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const resetBtn = document.getElementById('reset-zoom');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetChartZoom();
            if (map && mapPolyline) {
                map.fitBounds(mapPolyline.getBounds());
            }
            resetBtn.style.display = 'none';
            document.getElementById('segment-indicator').textContent = '';
        });
    }
    
    // Modal functionality
    const modal = document.getElementById('physics-modal');
    const infoBtn = document.getElementById('info-btn');
    const closeBtn = modal ? modal.querySelector('.modal-close') : null;
    
    if (infoBtn && modal) {
        infoBtn.addEventListener('click', () => {
            modal.classList.add('active');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }
    
    if (modal) {
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
        
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                modal.classList.remove('active');
            }
        });
    }
    
    // Load default GPX file
    loadDefaultGPX();
});

// File Upload Handler
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        gpxData = parseGPX(text);
        
        if (gpxData && gpxData.points.length > 0) {
            console.log(`Loaded ${gpxData.points.length} points from GPX`);
            // Auto-simulate after loading GPX
            runSimulation();
        } else {
            alert('No valid track points found in GPX file');
        }
    } catch (error) {
        console.error('Error reading GPX file:', error);
        alert('Error reading GPX file: ' + error.message);
    }
}

// Parse GPX File
function parseGPX(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, 'text/xml');
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
        throw new Error('Invalid GPX file');
    }
    
    // Try to get track points from <trkpt> elements
    let trackPoints = xmlDoc.querySelectorAll('trkpt');
    
    // If no track points, try route points
    if (trackPoints.length === 0) {
        trackPoints = xmlDoc.querySelectorAll('rtept');
    }
    
    if (trackPoints.length === 0) {
        throw new Error('No track or route points found in GPX file');
    }
    
    const points = [];
    trackPoints.forEach(trkpt => {
        const lat = parseFloat(trkpt.getAttribute('lat'));
        const lon = parseFloat(trkpt.getAttribute('lon'));
        const eleElement = trkpt.querySelector('ele');
        const ele = eleElement ? parseFloat(eleElement.textContent) : 0;
        
        if (!isNaN(lat) && !isNaN(lon)) {
            points.push({ lat, lon, ele });
        }
    });
    
    return { points };
}

// Calculate distance between two lat/lon points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Distance in meters
}

// Calculate segment data (distances, grades, etc.)
function calculateSegmentData(points) {
    const segments = [];
    let totalDistance = 0;
    
    for (let i = 1; i < points.length; i++) {
        const p1 = points[i - 1];
        const p2 = points[i];
        
        const horizontalDist = calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
        const elevationChange = p2.ele - p1.ele;
        const distance = Math.sqrt(horizontalDist * horizontalDist + elevationChange * elevationChange);
        
        // Avoid division by zero
        const grade = horizontalDist > 0 ? elevationChange / horizontalDist : 0;
        
        totalDistance += distance;
        
        segments.push({
            distance: distance,
            grade: grade,
            elevation: p2.ele,
            cumulativeDistance: totalDistance,
            lat: p2.lat,
            lon: p2.lon
        });
    }
    
    return segments;
}

// Calculate power needed for a given speed and grade
function calculatePowerNeeded(speed_ms, grade, mass, CdA) {
    // Forces
    const theta = Math.atan(grade);
    const F_gravity = mass * g * Math.sin(theta);
    const F_rolling = mass * g * Math.cos(theta) * Crr;
    const F_air = 0.5 * rho * CdA * speed_ms * speed_ms;
    
    const totalForce = F_gravity + F_rolling + F_air;
    const power = totalForce * speed_ms;
    
    return power;
}

// Solve for speed given power limit and constraints
function calculateSpeed(grade, mass, CdA, Pmax, Vmax_ms) {
    // Check if we can reach Vmax with available power
    const powerAtVmax = calculatePowerNeeded(Vmax_ms, grade, mass, CdA);
    if (powerAtVmax <= Pmax) {
        return Vmax_ms; // Can reach max speed with available power
    }
    
    // We can't reach Vmax, so find the speed achievable with Pmax
    // Binary search for speed where power needed = Pmax
    let vMin = 0.1;
    let vMax = Vmax_ms;
    const tolerance = 0.001;
    const maxIterations = 100;
    let iterations = 0;
    
    while (vMax - vMin > tolerance && iterations < maxIterations) {
        const vMid = (vMin + vMax) / 2;
        const powerNeeded = calculatePowerNeeded(vMid, grade, mass, CdA);
        
        if (powerNeeded < Pmax) {
            vMin = vMid; // Can go faster with available power
        } else {
            vMax = vMid; // Need more power than available
        }
        iterations++;
    }
    
    return (vMin + vMax) / 2;
}

// Run the simulation
function runSimulation() {
    if (!gpxData) return;
    
    // Get parameters
    const mass = parseFloat(document.getElementById('weight').value);
    const CdA = parseFloat(document.getElementById('cda').value);
    const Pmax = parseFloat(document.getElementById('pmax').value);
    const Vmax_kmh = parseFloat(document.getElementById('vmax').value);
    const Vmax_ms = Vmax_kmh / 3.6; // Convert to m/s
    
    // Calculate segment data
    const segments = calculateSegmentData(gpxData.points);
    
    if (segments.length === 0) {
        alert('Not enough data points to simulate');
        return;
    }
    
    // Calculate speed and power for each segment
    let totalTime = 0;
    const simulationData = [];
    let cumulativeElevationGain = 0;
    let previousElevation = gpxData.points[0].ele;
    
    // Add starting point
    simulationData.push({
        distance: 0,
        elevation: gpxData.points[0].ele,
        speed: 0,
        power: 0,
        time: 0,
        grade: 0,
        elevationGain: 0
    });
    
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const speed_ms = calculateSpeed(segment.grade, mass, CdA, Pmax, Vmax_ms);
        const speed_kmh = speed_ms * 3.6;
        
        // Calculate time for this segment
        const time = segment.distance / speed_ms;
        totalTime += time;
        
        // Calculate cumulative elevation gain (only positive changes)
        const elevationChange = segment.elevation - previousElevation;
        if (elevationChange > 0) {
            cumulativeElevationGain += elevationChange;
        }
        previousElevation = segment.elevation;
        
        // Calculate actual power output
        // - If at Vmax: we're speed-limited, output only what's needed (can be less than Pmax)
        // - If below Vmax: we're power-limited, always output Pmax
        let power;
        if (speed_ms >= Vmax_ms - 0.01) {
            // Speed-limited: at Vmax, only use power needed to maintain it
            const powerNeeded = calculatePowerNeeded(speed_ms, segment.grade, mass, CdA);
            power = Math.max(0, powerNeeded);
        } else {
            // Power-limited: using full power but can't reach Vmax
            power = Pmax;
        }
        
        simulationData.push({
            distance: segment.cumulativeDistance,
            elevation: segment.elevation,
            speed: speed_kmh,
            power: power,
            time: totalTime,
            grade: segment.grade * 100, // Convert to percentage
            lat: segment.lat,
            lon: segment.lon,
            elevationGain: cumulativeElevationGain
        });
    }
    
    // Calculate averages
    const totalDistance = segments[segments.length - 1].cumulativeDistance;
    const avgSpeed = totalDistance / totalTime * 3.6; // km/h
    
    // Calculate average power (weighted by time)
    let totalPower = 0;
    for (let i = 1; i < simulationData.length; i++) {
        const timeDiff = simulationData[i].time - simulationData[i - 1].time;
        totalPower += simulationData[i].power * timeDiff;
    }
    const avgPower = totalPower / totalTime;
    
    // Display results
    displayResults(simulationData, totalTime, totalDistance, avgSpeed, avgPower);
}

// Display results
function displayResults(data, totalTime, totalDistance, avgSpeed, avgPower) {
    // Store data globally for interaction
    simulationDataGlobal = data;
    selectedRange = null; // Reset selection
    
    // Show results sections
    resultsDiv.style.display = 'block';
    const sidebarResults = document.getElementById('sidebar-results');
    if (sidebarResults) {
        sidebarResults.style.display = 'block';
    }
    
    // Update summary cards
    updateSummaryCards(data);
    
    // Display map
    displayMap(data);
    
    // Display charts
    displayCharts(data);
    
    // Scroll to results
    resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

// Update summary cards based on data range
function updateSummaryCards(data, startIdx = 0, endIdx = null) {
    if (!endIdx) endIdx = data.length - 1;
    
    const rangeData = data.slice(startIdx, endIdx + 1);
    
    // Calculate time and distance for range
    const startTime = data[startIdx].time;
    const endTime = data[endIdx].time;
    const totalTime = endTime - startTime;
    
    const startDist = data[startIdx].distance;
    const endDist = data[endIdx].distance;
    const totalDistance = endDist - startDist;
    
    // Calculate averages
    const avgSpeed = totalTime > 0 ? (totalDistance / totalTime) * 3.6 : 0;
    
    let totalPower = 0;
    for (let i = startIdx + 1; i <= endIdx; i++) {
        const timeDiff = data[i].time - data[i - 1].time;
        totalPower += data[i].power * timeDiff;
    }
    const avgPower = totalTime > 0 ? totalPower / totalTime : 0;
    
    // Update display
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    const seconds = Math.floor(totalTime % 60);
    
    document.getElementById('total-time').textContent = 
        `${hours}h ${minutes}m ${seconds}s`;
    document.getElementById('total-distance').textContent = 
        `${(totalDistance / 1000).toFixed(2)} km`;
    document.getElementById('avg-speed').textContent = 
        `${avgSpeed.toFixed(1)} km/h`;
    document.getElementById('avg-power').textContent = 
        `${avgPower.toFixed(0)} W`;
    
    // Show/hide reset button and segment indicator
    const resetBtn = document.getElementById('reset-zoom');
    const segmentIndicator = document.getElementById('segment-indicator');
    
    if (startIdx !== 0 || endIdx !== data.length - 1) {
        if (resetBtn) resetBtn.style.display = 'block';
        if (segmentIndicator) {
            segmentIndicator.textContent = `(${(startDist / 1000).toFixed(1)} - ${(endDist / 1000).toFixed(1)} km)`;
        }
    } else {
        if (resetBtn) resetBtn.style.display = 'none';
        if (segmentIndicator) segmentIndicator.textContent = '';
    }
}

// Display map using Leaflet
function displayMap(data) {
    const mapElement = document.getElementById('map');
    
    // Clear existing map
    if (map) {
        map.remove();
    }
    
    // Create new map
    map = L.map('map');
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Create polyline from data points
    const latLngs = data.slice(1).map(point => [point.lat, point.lon]);
    
    if (latLngs.length > 0) {
        mapPolyline = L.polyline(latLngs, {
            color: '#667eea',
            weight: 4,
            opacity: 0.8
        }).addTo(map);
        
        // Create hover marker (initially hidden)
        hoverMarker = L.circleMarker([0, 0], {
            radius: 8,
            fillColor: '#ef4444',
            color: '#fff',
            weight: 2,
            opacity: 0,
            fillOpacity: 0
        }).addTo(map);
        
        // Add start marker with custom icon
        const startIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div class="marker-pin start-marker"><span>START</span></div>',
            iconSize: [60, 40],
            iconAnchor: [30, 40]
        });
        
        L.marker(latLngs[0], {
            icon: startIcon,
            title: 'Start'
        }).addTo(map).bindPopup('<strong>START</strong><br>Beginning of route');
        
        // Add end marker with custom icon
        const endIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div class="marker-pin end-marker"><span>FINISH</span></div>',
            iconSize: [60, 40],
            iconAnchor: [30, 40]
        });
        
        L.marker(latLngs[latLngs.length - 1], {
            icon: endIcon,
            title: 'End'
        }).addTo(map).bindPopup('<strong>FINISH</strong><br>End of route');
        
        // Add mousemove event to polyline
        mapPolyline.on('mousemove', function(e) {
            const latlng = e.latlng;
            const closestPoint = findClosestPoint(data, latlng.lat, latlng.lng);
            if (closestPoint) {
                showHoverPoint(closestPoint.index);
            }
        });
        
        mapPolyline.on('mouseout', function() {
            hideHoverPoint();
        });
        
        // Fit map to polyline bounds
        map.fitBounds(mapPolyline.getBounds());
        
        // Add selection drawing capability
        enableMapSelection();
    }
}

// Enable rectangle selection on map
function enableMapSelection() {
    let selectionRect = null;
    let startLatLng = null;
    const mapContainer = map.getContainer();
    
    // Change cursor on shift key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift' && mapContainer) {
            mapContainer.style.cursor = 'crosshair';
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift' && mapContainer) {
            mapContainer.style.cursor = '';
        }
    });
    
    map.on('mousedown', function(e) {
        if (e.originalEvent.shiftKey) {
            isSelecting = true;
            startLatLng = e.latlng;
            
            // Create temporary rectangle
            selectionRect = L.rectangle([startLatLng, startLatLng], {
                color: '#ef4444',
                weight: 2,
                fillColor: '#ef4444',
                fillOpacity: 0.15,
                dashArray: '5, 5'
            }).addTo(map);
            
            map.dragging.disable();
        }
    });
    
    map.on('mousemove', function(e) {
        if (isSelecting && selectionRect && startLatLng) {
            // Update rectangle bounds
            selectionRect.setBounds([startLatLng, e.latlng]);
        }
    });
    
    map.on('mouseup', function(e) {
        if (isSelecting && selectionRect && startLatLng) {
            const bounds = L.latLngBounds(startLatLng, e.latlng);
            
            // Find points within selection
            selectPointsInBounds(bounds);
            
            // Remove temporary rectangle
            map.removeLayer(selectionRect);
            selectionRect = null;
            startLatLng = null;
            isSelecting = false;
            map.dragging.enable();
        }
    });
}

// Select data points within map bounds
function selectPointsInBounds(bounds) {
    if (!simulationDataGlobal) return;
    
    let startIdx = null;
    let endIdx = null;
    
    for (let i = 1; i < simulationDataGlobal.length; i++) {
        const point = simulationDataGlobal[i];
        if (point.lat && point.lon) {
            const inBounds = bounds.contains([point.lat, point.lon]);
            if (inBounds) {
                if (startIdx === null) startIdx = i;
                endIdx = i;
            }
        }
    }
    
    if (startIdx !== null && endIdx !== null) {
        selectedRange = { start: startIdx, end: endIdx };
        updateSummaryCards(simulationDataGlobal, startIdx, endIdx);
        highlightSelectionOnCharts(startIdx, endIdx);
        highlightSelectionOnMap(startIdx, endIdx);
    }
}

// Highlight selected segment on map
function highlightSelectionOnMap(startIdx, endIdx) {
    if (!map || !simulationDataGlobal) return;
    
    // Remove existing selection overlay
    if (selectionOverlay) {
        map.removeLayer(selectionOverlay);
    }
    
    // Create array of lat/lng for selected segment
    const selectedLatLngs = [];
    for (let i = startIdx; i <= endIdx; i++) {
        const point = simulationDataGlobal[i];
        if (point.lat && point.lon) {
            selectedLatLngs.push([point.lat, point.lon]);
        }
    }
    
    if (selectedLatLngs.length > 0) {
        // Create highlighted polyline for selected segment
        selectionOverlay = L.polyline(selectedLatLngs, {
            color: '#ef4444',
            weight: 6,
            opacity: 0.9
        }).addTo(map);
        
        // Bring to front
        selectionOverlay.bringToFront();
    }
}

// Find closest point in data to given lat/lng
function findClosestPoint(data, lat, lng) {
    let minDist = Infinity;
    let closestIdx = -1;
    
    for (let i = 1; i < data.length; i++) {
        if (data[i].lat && data[i].lon) {
            const dist = Math.sqrt(
                Math.pow(data[i].lat - lat, 2) + 
                Math.pow(data[i].lon - lng, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }
    }
    
    return closestIdx >= 0 ? { index: closestIdx, data: data[closestIdx] } : null;
}

// Show hover point on map and charts
function showHoverPoint(dataIndex) {
    const point = simulationDataGlobal[dataIndex];
    if (!point || !point.lat || !point.lon) return;
    
    // Show marker on map
    hoverMarker.setLatLng([point.lat, point.lon]);
    hoverMarker.setStyle({ opacity: 1, fillOpacity: 0.8 });
    
    // Highlight point on charts
    highlightChartPoint(dataIndex);
}

// Hide hover point
function hideHoverPoint() {
    if (hoverMarker) {
        hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    }
}

// Highlight point on all charts
function highlightChartPoint(dataIndex) {
    const downsampledData = downsampleData(simulationDataGlobal);
    
    // Find corresponding index in downsampled data
    const originalDistance = simulationDataGlobal[dataIndex].distance;
    let downsampledIdx = 0;
    let minDiff = Infinity;
    
    for (let i = 0; i < downsampledData.length; i++) {
        const diff = Math.abs(downsampledData[i].distance - originalDistance);
        if (diff < minDiff) {
            minDiff = diff;
            downsampledIdx = i;
        }
    }
    
    // Trigger tooltip on all charts
    Object.values(charts).forEach(chart => {
        if (chart && chart.tooltip) {
            chart.tooltip.setActiveElements([{
                datasetIndex: 0,
                index: downsampledIdx
            }]);
            chart.update('none');
        }
    });
}


// Downsample data for cleaner charts
function downsampleData(data, maxPoints = 150) {
    if (data.length <= maxPoints) return data;
    
    const step = Math.ceil(data.length / maxPoints);
    const downsampled = [];
    
    for (let i = 0; i < data.length; i += step) {
        // Take average of points in this window
        const windowEnd = Math.min(i + step, data.length);
        const window = data.slice(i, windowEnd);
        
        const avg = {
            distance: window.reduce((sum, p) => sum + p.distance, 0) / window.length,
            elevation: window.reduce((sum, p) => sum + p.elevation, 0) / window.length,
            speed: window.reduce((sum, p) => sum + p.speed, 0) / window.length,
            power: window.reduce((sum, p) => sum + p.power, 0) / window.length,
            grade: window.reduce((sum, p) => sum + (p.grade || 0), 0) / window.length,
            time: window.reduce((sum, p) => sum + (p.time || 0), 0) / window.length,
            elevationGain: window.reduce((sum, p) => sum + (p.elevationGain || 0), 0) / window.length
        };
        
        downsampled.push(avg);
    }
    
    return downsampled;
}

// Highlight selection on all charts
function highlightSelectionOnCharts(startIdx, endIdx) {
    const downsampledData = downsampleData(simulationDataGlobal);
    
    // Find corresponding indices in downsampled data
    const startDist = simulationDataGlobal[startIdx].distance;
    const endDist = simulationDataGlobal[endIdx].distance;
    
    let downsampledStart = 0;
    let downsampledEnd = downsampledData.length - 1;
    
    for (let i = 0; i < downsampledData.length; i++) {
        if (downsampledData[i].distance >= startDist && downsampledStart === 0) {
            downsampledStart = i;
        }
        if (downsampledData[i].distance <= endDist) {
            downsampledEnd = i;
        }
    }
    
    // Add selection overlay to each chart
    Object.entries(charts).forEach(([key, chart]) => {
        if (chart) {
            // Remove existing selection dataset if any
            if (chart.data.datasets.length > 1) {
                chart.data.datasets.splice(1);
            }
            
            // Create selection highlight
            const selectionData = chart.data.datasets[0].data.map((_, idx) => {
                if (idx >= downsampledStart && idx <= downsampledEnd) {
                    return chart.data.datasets[0].data[idx];
                }
                return null;
            });
            
            chart.data.datasets.push({
                label: 'Selected',
                data: selectionData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.3)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 0,
                spanGaps: false
            });
            
            chart.update();
        }
    });
}

// Reset selection
function resetChartZoom() {
    selectedRange = null;
    updateSummaryCards(simulationDataGlobal);
    
    // Remove selection highlight from all charts
    Object.values(charts).forEach(chart => {
        if (chart) {
            // Remove selection dataset
            if (chart.data.datasets.length > 1) {
                chart.data.datasets.splice(1);
            }
            chart.resetZoom();
            chart.update();
        }
    });
    
    // Clear map selection overlay if exists
    if (selectionOverlay && map) {
        map.removeLayer(selectionOverlay);
        selectionOverlay = null;
    }
}

// Display charts using Chart.js
function displayCharts(data) {
    // Downsample data for cleaner visualization
    const downsampledData = downsampleData(data);
    const distances = downsampledData.map(d => (d.distance / 1000).toFixed(1)); // km
    
    // Destroy existing charts
    Object.values(charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    
    // Common zoom options (no auto-update on zoom)
    const zoomOptions = {
        zoom: {
            wheel: {
                enabled: true,
                speed: 0.05
            },
            pinch: {
                enabled: true
            },
            mode: 'x'
        },
        pan: {
            enabled: true,
            mode: 'x'
        },
        limits: {
            x: { min: 'original', max: 'original' }
        }
    };
    
    // Chart selection handler
    let chartSelectionStart = null;
    let isChartSelecting = false;
    
    // Elevation chart
    const elevationCtx = document.getElementById('elevation-chart').getContext('2d');
    charts.elevation = new Chart(elevationCtx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Elevation (m)',
                data: downsampledData.map(d => d.elevation.toFixed(1)),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                zoom: zoomOptions
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km) - Scroll to zoom, drag to pan, SHIFT+drag to select',
                        font: {
                            size: 11,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Elevation (m)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        font: {
                            size: 12
                        }
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    handleChartHover(index);
                }
            }
        }
    });
    
    // Slope chart
    const slopeCtx = document.getElementById('slope-chart').getContext('2d');
    charts.slope = new Chart(slopeCtx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Grade (%)',
                data: downsampledData.map(d => d.grade.toFixed(1)),
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += context.parsed.y.toFixed(1) + '%';
                            return label;
                        }
                    }
                },
                zoom: zoomOptions
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Grade (%)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    handleChartHover(index);
                }
            }
        }
    });
    
    // Speed chart
    const speedCtx = document.getElementById('speed-chart').getContext('2d');
    charts.speed = new Chart(speedCtx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Speed (km/h)',
                data: downsampledData.map(d => d.speed.toFixed(1)),
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                zoom: zoomOptions
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Speed (km/h)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    beginAtZero: true,
                    ticks: {
                        font: {
                            size: 12
                        }
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    handleChartHover(index);
                }
            }
        }
    });
    
    // Power chart
    const powerCtx = document.getElementById('power-chart').getContext('2d');
    charts.power = new Chart(powerCtx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Power (W)',
                data: downsampledData.map(d => d.power.toFixed(0)),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                zoom: zoomOptions
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Power (W)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    beginAtZero: true,
                    ticks: {
                        font: {
                            size: 12
                        }
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    handleChartHover(index);
                }
            }
        }
    });
    
    // Progress chart (Distance and Elevation Gain vs Time)
    const timeLabels = downsampledData.map(d => {
        const hours = Math.floor(d.time / 3600);
        const minutes = Math.floor((d.time % 3600) / 60);
        return `${hours}h${minutes.toString().padStart(2, '0')}`;
    });
    
    const progressCtx = document.getElementById('progress-chart').getContext('2d');
    charts.progress = new Chart(progressCtx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [
                {
                    label: 'Distance (km)',
                    data: downsampledData.map(d => (d.distance / 1000).toFixed(2)),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: 'Elevation Gain (m)',
                    data: downsampledData.map(d => (d.elevationGain || 0).toFixed(0)),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.datasetIndex === 0) {
                                label += context.parsed.y.toFixed(1) + ' km';
                            } else {
                                label += context.parsed.y.toFixed(0) + ' m';
                            }
                            return label;
                        }
                    }
                },
                zoom: zoomOptions
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Elapsed Time',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#3b82f6'
                    },
                    beginAtZero: true,
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#3b82f6'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Elevation Gain (m)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#10b981'
                    },
                    beginAtZero: true,
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#10b981'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    handleChartHover(index);
                }
            }
        }
    });
    
    // Enable selection on all charts
    enableChartSelection();
}

// Handle chart hover to show point on map
function handleChartHover(downsampledIndex) {
    if (!simulationDataGlobal) return;
    
    const downsampledData = downsampleData(simulationDataGlobal);
    if (downsampledIndex >= downsampledData.length) return;
    
    const hoveredDistance = downsampledData[downsampledIndex].distance;
    
    // Find closest point in original data
    let closestIdx = 0;
    let minDiff = Infinity;
    
    for (let i = 0; i < simulationDataGlobal.length; i++) {
        const diff = Math.abs(simulationDataGlobal[i].distance - hoveredDistance);
        if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
        }
    }
    
    const point = simulationDataGlobal[closestIdx];
    if (point && point.lat && point.lon && hoverMarker) {
        hoverMarker.setLatLng([point.lat, point.lon]);
        hoverMarker.setStyle({ opacity: 1, fillOpacity: 0.8 });
    }
}

// Enable chart selection with shift+drag
function enableChartSelection() {
    Object.values(charts).forEach(chart => {
        if (!chart || !chart.canvas) return;
        
        const canvas = chart.canvas;
        let selectionStartX = null;
        let selectionBox = null;
        
        canvas.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
                isChartSelecting = true;
                const rect = canvas.getBoundingClientRect();
                selectionStartX = e.clientX - rect.left;
                
                // Disable pan during selection
                chart.options.plugins.zoom.pan.enabled = false;
                chart.update('none');
            }
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (isChartSelecting && selectionStartX !== null) {
                const rect = canvas.getBoundingClientRect();
                const currentX = e.clientX - rect.left;
                
                // Visual feedback would go here (Chart.js doesn't have built-in selection overlay)
                // We'll handle this in mouseup
            }
        });
        
        canvas.addEventListener('mouseup', (e) => {
            if (isChartSelecting && selectionStartX !== null) {
                const rect = canvas.getBoundingClientRect();
                const endX = e.clientX - rect.left;
                
                // Convert pixel positions to data indices
                const xScale = chart.scales.x;
                const startValue = xScale.getValueForPixel(Math.min(selectionStartX, endX));
                const endValue = xScale.getValueForPixel(Math.max(selectionStartX, endX));
                
                // Select range based on distance values
                selectChartRange(startValue, endValue);
                
                // Re-enable pan
                chart.options.plugins.zoom.pan.enabled = true;
                chart.update('none');
                
                selectionStartX = null;
                isChartSelecting = false;
            }
        });
    });
}

// Select data range based on chart distance values
function selectChartRange(startDistKm, endDistKm) {
    if (!simulationDataGlobal) return;
    
    const startDistM = startDistKm * 1000;
    const endDistM = endDistKm * 1000;
    
    let startIdx = 0;
    let endIdx = simulationDataGlobal.length - 1;
    
    for (let i = 0; i < simulationDataGlobal.length; i++) {
        if (simulationDataGlobal[i].distance >= startDistM && startIdx === 0) {
            startIdx = i;
        }
        if (simulationDataGlobal[i].distance <= endDistM) {
            endIdx = i;
        }
    }
    
    if (startIdx < endIdx) {
        selectedRange = { start: startIdx, end: endIdx };
        updateSummaryCards(simulationDataGlobal, startIdx, endIdx);
        highlightSelectionOnCharts(startIdx, endIdx);
        highlightSelectionOnMap(startIdx, endIdx);
    }
}

