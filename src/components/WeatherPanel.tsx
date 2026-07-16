import { useSimStore } from '../stores/simStore'

export function WeatherPanel() {
  const weather = useSimStore((s) => s.weather)
  const setWeather = useSimStore((s) => s.setWeather)
  const waterStatus = useSimStore((s) => s.waterStatus)

  return (
    <div className="panel weather-panel">
      <h3>Weather & Environment</h3>

      <div className="control">
        <label>
          Temperature
          <span className="val">{weather.temperature.toFixed(0)}°C</span>
        </label>
        <input
          type="range"
          min={-5}
          max={40}
          step={0.5}
          value={weather.temperature}
          onChange={(e) => setWeather({ temperature: +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Light (PAR)
          <span className="val">{(weather.light * 100).toFixed(0)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={weather.light}
          onChange={(e) => setWeather({ light: +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Humidity
          <span className="val">{(weather.humidity * 100).toFixed(0)}%</span>
        </label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.01}
          value={weather.humidity}
          onChange={(e) => setWeather({ humidity: +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Rain
          <span className="val">{weather.precipitation.toFixed(1)} mm/h</span>
        </label>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={weather.precipitation}
          onChange={(e) => setWeather({ precipitation: +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Wind
          <span className="val">{weather.wind.toFixed(1)} m/s</span>
        </label>
        <input
          type="range"
          min={0}
          max={15}
          step={0.2}
          value={weather.wind}
          onChange={(e) => setWeather({ wind: +e.target.value })}
        />
      </div>

      <div className="status-bar">
        <div className="status-label">Plant Water Status</div>
        <div className="bar-track">
          <div
            className="bar-fill"
            style={{
              width: `${waterStatus * 100}%`,
              background:
                waterStatus > 0.6
                  ? '#4ade80'
                  : waterStatus > 0.3
                    ? '#fbbf24'
                    : '#f87171',
            }}
          />
        </div>
        <div className="status-val">{(waterStatus * 100).toFixed(0)}%</div>
      </div>
    </div>
  )
}
