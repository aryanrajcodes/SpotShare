export default function FilterBar({
  filters,
  onChange,
  onReset,
  onUseLocation,
  locationLabel,
  resultCount,
  totalCount,
  activeCategory = 'all',
}) {
  const set = (patch) => onChange({ ...filters, ...patch })

  const searchPlaceholder =
    activeCategory === 'parking'
      ? 'Search parking spaces by name or area…'
      : activeCategory === 'ev'
      ? 'Search EV charging stations by name or area…'
      : 'Search parking or EV spaces by name or area…'

  const countLabel =
    activeCategory === 'parking'
      ? `${resultCount} of ${totalCount} parking spaces`
      : activeCategory === 'ev'
      ? `${resultCount} of ${totalCount} EV charging hubs`
      : `${resultCount} of ${totalCount} spaces`

  return (
    <section className="panel filter-bar" aria-label="Search and filters">
      <div className="filter-row">
        <input
          type="search"
          className="search"
          placeholder={searchPlaceholder}
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          aria-label="Search spaces"
        />
        <button type="button" className="btn btn-ghost" onClick={onUseLocation}>
          Use my location
        </button>
      </div>
      <p className="muted small">Distances measured from: {locationLabel}</p>

      <div className="filter-grid">
        <label className="field">
          <span>
            Max distance: {filters.maxDistanceKm >= 20 ? 'Any (20 km)' : `${filters.maxDistanceKm} km`}
          </span>
          <input
            type="range"
            min="1"
            max="20"
            value={filters.maxDistanceKm}
            onChange={(e) => set({ maxDistanceKm: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>
            Max price: {filters.maxPrice >= 200 ? 'Any (₹200/hr)' : `₹${filters.maxPrice}/hr`}
          </span>
          <input
            type="range"
            min="10"
            max="200"
            step="5"
            value={filters.maxPrice}
            onChange={(e) => set({ maxPrice: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>Vehicle</span>
          <select
            value={filters.vehicleType}
            onChange={(e) => set({ vehicleType: e.target.value })}
          >
            <option value="all">All vehicles</option>
            <option value="car">Car</option>
            <option value="bike">Bike</option>
          </select>
        </label>

        <label className="field">
          <span>Sort by</span>
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="distance">Nearest</option>
            <option value="price">Cheapest</option>
            <option value="rating">Top rated</option>
          </select>
        </label>
      </div>

      <div className="filter-row filter-foot">
        <label className="check">
          <input
            type="checkbox"
            checked={filters.availableOnly}
            onChange={(e) => set({ availableOnly: e.target.checked })}
          />
          Available now
        </label>

        {activeCategory === 'all' && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={filters.evOnly}
                onChange={(e) =>
                  set({
                    evOnly: e.target.checked,
                    parkingOnly: e.target.checked ? false : filters.parkingOnly,
                  })
                }
              />
              ⚡ EV charging
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={filters.parkingOnly}
                onChange={(e) =>
                  set({
                    parkingOnly: e.target.checked,
                    evOnly: e.target.checked ? false : filters.evOnly,
                  })
                }
              />
              🅿️ Parking only
            </label>
          </>
        )}

        <span className="spacer" />
        <span className="muted small">{countLabel}</span>
        <button type="button" className="btn btn-link" onClick={onReset}>
          Reset
        </button>
      </div>
    </section>
  )
}
