import { useEffect, useMemo, useState } from 'react'

function pad(n) {
  return String(n).padStart(2, '0')
}

// Local time formatted for <input type="datetime-local">: YYYY-MM-DDTHH:mm
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Naive local ISO 8601 with seconds, as the API expects: YYYY-MM-DDTHH:mm:00
const toApiTime = (v) => (v.length === 16 ? `${v}:00` : v)

// Default start is right now so booking begins immediately and updates space availability
function defaultStart() {
  const d = new Date()
  d.setSeconds(0, 0)
  return d
}

export default function BookingModal({
  spot,
  currentUser = null,
  onClose,
  onBook,
  formatMoney,
  formatDateTime,
}) {
  const start0 = useMemo(defaultStart, [])
  const vehicles = spot.vehicle_types?.length ? spot.vehicle_types : ['car']

  const [name, setName] = useState(currentUser?.name || 'Demo User')
  const [start, setStart] = useState(toLocalInput(start0))
  const [end, setEnd] = useState(toLocalInput(new Date(start0.getTime() + 2 * 3600000)))
  const [vehicle, setVehicle] = useState(
    currentUser?.vehicle && vehicles.includes(currentUser.vehicle)
      ? currentUser.vehicle
      : vehicles[0]
  )
  const [needsEv, setNeedsEv] = useState(Boolean(spot.ev_charging))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [booking, setBooking] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hours = (new Date(end) - new Date(start)) / 3600000
  const validRange = Number.isFinite(hours) && hours > 0
  const estimate = validRange
    ? Math.round(hours * spot.price_per_hour * 100) / 100
    : null

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Please enter your name.')
    if (!validRange) return setError('End time must be after the start time.')
    setBusy(true)
    try {
      const created = await onBook({
        spot_id: spot.id,
        customer_name: name.trim(),
        start_time: toApiTime(start),
        end_time: toApiTime(end),
        vehicle_type: vehicle,
        requires_ev_charging: needsEv,
      })
      setBooking(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {booking ? (
          <div className="modal-success">
            <div className="check-circle" aria-hidden="true">
              ✓
            </div>
            <h2 id="booking-title">Booking confirmed</h2>
            <dl className="summary">
              <dt>Booking ID</dt>
              <dd>{booking.id}</dd>
              <dt>Space</dt>
              <dd>{spot.name}</dd>
              <dt>From</dt>
              <dd>{formatDateTime(booking.start)}</dd>
              <dt>To</dt>
              <dd>{formatDateTime(booking.end)}</dd>
              <dt>Duration</dt>
              <dd>{booking.duration}</dd>
              <dt>Total (server)</dt>
              <dd>
                <strong>{formatMoney(booking.total)}</strong>
              </dd>
              <dt>Status</dt>
              <dd>{booking.status}</dd>
            </dl>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="booking-title">Book {spot.name}</h2>
            <p className="muted small">
              {spot.address} · {formatMoney(spot.price_per_hour)}/hr
            </p>

            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>

            <div className="two-col">
              <label className="field">
                <span>Start</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>End</span>
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>Vehicle type</span>
              <select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              >
                {vehicles.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className={`check ${spot.ev_charging ? '' : 'disabled'}`}>
              <input
                type="checkbox"
                checked={needsEv}
                disabled={!spot.ev_charging}
                onChange={(e) => setNeedsEv(e.target.checked)}
              />
              I need EV charging
              {!spot.ev_charging && (
                <em className="muted small"> (not available here)</em>
              )}
            </label>

            <div className="estimate">
              <span>Estimated total</span>
              <strong>{estimate != null ? formatMoney(estimate) : '—'}</strong>
            </div>
            <p className="muted small">
              Estimate only. The server calculates the final price and checks for
              conflicts. Times are local (Asia/Kolkata); a booking ending at 12:00
              doesn’t clash with one starting at 12:00.
            </p>

            {error && (
              <p className="alert alert-error" role="alert">
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Booking…' : 'Confirm booking'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
