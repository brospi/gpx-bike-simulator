# GPX Bike Speed Simulator

A physics-based bike speed simulator that analyzes GPX files and calculates realistic cycling speeds based on rider and bike parameters.

## Features

- 📁 Upload GPX files (tracks or routes)
- 🗺️ Interactive map display of your route
- 📊 Elevation, speed, and power profiles
- ⚙️ Customizable parameters:
  - Total weight (bike + cyclist)
  - Aerodynamic drag coefficient (CdA)
  - Maximum power output (Pmax) - with slider control
  - Maximum speed (Vmax) - with slider control
- 🔬 Physics-based simulation considering:
  - Gravity/climbing resistance
  - Rolling resistance
  - Air resistance
  - Power limitations
  - Downhill coasting (when gravity exceeds resistance)

## How It Works

The simulator uses realistic physics to calculate speed at each point along your route:

1. **Forces Calculation**: For each segment, it calculates:
   - Gravitational force based on grade
   - Rolling resistance based on weight and surface
   - Air resistance based on speed and CdA

2. **Power Constraint**: The cyclist outputs `min(Pmax, power needed to reach Vmax)`

3. **Speed Calculation**: Using binary search, it finds the speed where power output equals the sum of all resistive forces

## Physics Model

```
Power = (F_gravity + F_rolling + F_air) × velocity

Where:
- F_gravity = m × g × sin(arctan(grade))
- F_rolling = m × g × cos(arctan(grade)) × Crr
- F_air = 0.5 × ρ × CdA × v²
```

Constants used:
- g = 9.81 m/s² (gravity)
- ρ = 1.225 kg/m³ (air density at sea level)
- Crr = 0.004 (rolling resistance coefficient, typical for road bike on asphalt)

## Deployment to GitHub Pages

1. Create a new GitHub repository

2. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/your-repo-name.git
   cd your-repo-name
   ```

3. Copy all files to the repository:
   ```bash
   cp index.html style.css app.js README.md /path/to/your-repo/
   ```

4. Commit and push:
   ```bash
   git add .
   git commit -m "Initial commit: GPX bike simulator"
   git push origin main
   ```

5. Enable GitHub Pages:
   - Go to your repository on GitHub
   - Click "Settings" → "Pages"
   - Under "Source", select "main" branch
   - Click "Save"

6. Your site will be available at: `https://yourusername.github.io/your-repo-name/`

## Usage

1. Upload a GPX file from your cycling app (Strava, Garmin, etc.)
2. Adjust the cyclist parameters:
   - **Weight**: Total weight of bike + cyclist in kg
   - **CdA**: Aerodynamic drag coefficient in m² (typical values: 0.25-0.40)
   - **Pmax**: Maximum sustainable power in watts
   - **Vmax**: Maximum desired speed in km/h
3. Click "Simulate" to see the results
4. View the route map, elevation profile, speed profile, and power output

## Typical Parameter Values

### CdA (Coefficient of Drag × Frontal Area)
- Upright position: 0.40-0.45 m²
- Hoods position: 0.30-0.35 m²
- Drops position: 0.25-0.30 m²
- Aero position: 0.20-0.25 m²

### Power (FTP - Functional Threshold Power)
- Beginner: 100-150 W
- Recreational: 150-250 W
- Trained: 250-350 W
- Competitive: 350+ W

## Browser Compatibility

Works on all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

## Technologies Used

- HTML5
- CSS3
- Vanilla JavaScript
- [Leaflet.js](https://leafletjs.com/) for maps
- [Chart.js](https://www.chartjs.org/) for graphs

## License

Free to use and modify. No warranty provided.

## Contributing

Feel free to fork and submit pull requests!

