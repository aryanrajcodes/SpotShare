const money = (n) => `₹${Number(n).toFixed(2).replace(/\.00$/, '')}`

export default function SpotCard({
  spot,
  distanceKm,
  selected,
  onSelect,
  onBook,
  activeCategory = 'all',
}) {
  const capacity = spot.capacity || 0
  const free = Math.max(0, spot.available_spaces ?? 0)
  const pct = capacity > 0 ? Math.min(100, Math.round((free / capacity) * 100)) : 0
  const full = free === 0
  const status = full && spot.status === 'available' ? 'full' : spot.status

  const formattedDistance =
    typeof distanceKm === 'number' && !Number.isNaN(distanceKm)
      ? `${distanceKm.toFixed(1)} km`
      : '—'

  const bookButtonText = spot.ev_charging ? 'Book & Charge' : 'Book Spot'

  return (
    <article
      id={`spot-card-${spot.id}`}
      className={`card ${selected ? 'card-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="card-top">
        <div>
          <h3>{spot.name}</h3>
          <p className="muted small">{spot.address}</p>
        </div>
        <div className="price">
          <strong>{money(spot.price_per_hour)}</strong>
          <span>/hr</span>
        </div>
      </div>

      <div className="badges">
        <span className={`badge badge-status status-${status}`}>{status}</span>

        {spot.ev_charging && activeCategory !== 'parking' && (
          <span className="badge badge-ev">
            ⚡ EV{spot.charger_power_kw ? ` · ${spot.charger_power_kw} kW Fast Charger` : ''}
          </span>
        )}

        {spot.rating != null && (
          <span className="badge">★ {Number(spot.rating).toFixed(1)}</span>
        )}
        <span className="badge">{formattedDistance}</span>
        {(spot.vehicle_types || []).map((v) => (
          <span key={v} className="badge badge-soft">{v}</span>
        ))}
      </div>

      <div className="avail">
        <div className="avail-bar" aria-hidden="true">
          <div
            className={`avail-fill ${full ? 'empty' : pct < 30 ? 'low' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="small">
          {free} of {capacity} {spot.ev_charging ? 'charging bays' : 'spaces'} free
        </span>
      </div>

      {(spot.amenities || []).length > 0 && (
        <p className="amenities small muted">{spot.amenities.join(' · ')}</p>
      )}

      <div className="card-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
        >
          View on map
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            onBook()
          }}
        >
          {bookButtonText}
        </button>
      </div>
    </article>
  )
}
