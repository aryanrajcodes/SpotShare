import { useCallback, useEffect, useMemo, useState } from 'react'
import FilterBar from './components/FilterBar.jsx'
import SpotCard from './components/SpotCard.jsx'
import BookingModal from './components/BookingModal.jsx'
import ParkingMap from './components/ParkingMap.jsx'
import SmartInsights from './components/SmartInsights.jsx'

/* Timezone convention: all timestamps are naive local time (Asia/Kolkata),
   ISO 8601 without offset, e.g. 2026-10-29T10:00:00. Intervals are [start, end). */

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && window.location.hostname
    ? `http://${window.location.hostname}:8000`
    : 'http://localhost:8000')

const DEFAULT_LOCATION = {
  latitude: 12.2958,
  longitude: 76.6394,
  label: 'Mysuru centre (demo reference point)',
}

// Ranges updated: distance max 20 km, price max ₹200/hr
const DEFAULT_FILTERS = {
  query: '',
  maxDistanceKm: 20, // 20 = "any"
  maxPrice: 200, // 200 = "any"
  availableOnly: false,
  vehicleType: 'all',
  sort: 'distance',
}

// Seed default accounts so judges/users can test instantly or register new accounts
const INITIAL_REGISTERED_USERS = [
  {
    name: 'Ashish Kumar',
    email: 'ashish@example.com',
    password: 'password123',
    vehicle: 'car',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@example.com',
    password: 'password123',
    vehicle: 'car',
  },
  {
    name: 'Rahul Verma',
    email: 'rahul@example.com',
    password: 'password123',
    vehicle: 'bike',
  },
]

function getStoredUsers() {
  try {
    const raw = localStorage.getItem('spotshare_registered_users')
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return INITIAL_REGISTERED_USERS
}

function saveStoredUsers(users) {
  try {
    localStorage.setItem('spotshare_registered_users', JSON.stringify(users))
  } catch {
    /* ignore */
  }
}

/* ---------- helpers ---------- */

function extractError(data, status) {
  const d = data?.detail ?? data?.message
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((e) => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ')
  }
  return `Request failed (HTTP ${status})`
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE}. Is the backend running?`)
  }
  if (res.status === 204) return null
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw new Error(extractError(data, res.status))
  return data
}

const asList = (data, key) =>
  Array.isArray(data) ? data : data?.[key] ?? data?.items ?? []

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function formatMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `₹${Number(n).toFixed(2).replace(/\.00$/, '')}`
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeBooking(b) {
  const start = b.start_time
  const end = b.end_time
  let hours = b.duration_hours ?? (typeof b.duration === 'number' ? b.duration : null)
  if (hours == null && start && end) {
    const ms = new Date(end) - new Date(start)
    if (!Number.isNaN(ms)) hours = ms / 3600000
  }
  return {
    id: b.id ?? b.booking_id,
    spotId: b.spot_id,
    spotName: b.spot_name,
    start,
    end,
    duration:
      hours != null
        ? `${+Number(hours).toFixed(2)} h`
        : typeof b.duration === 'string'
          ? b.duration
          : '—',
    total: b.total_price ?? b.total,
    status: b.status ?? 'confirmed',
    createdAt: b.created_at,
    cancelledAt: b.cancelled_at,
    vehicleType: b.vehicle_type,
    requiresEv: b.requires_ev_charging,
  }
}

/* ---------- Auth Screen (Enforces Registration First + Persistent Accounts) ---------- */

function AuthScreen({ onLogin }) {
  const [tab, setTab] = useState('login') // 'login' | 'register'
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regVehicle, setRegVehicle] = useState('car')

  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Handle Customer Registration
  const handleRegister = (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    const name = regName.trim()
    const email = regEmail.trim().toLowerCase()
    const password = regPassword.trim()

    if (!name) return setError('Please enter your full name.')
    if (!email || !email.includes('@')) return setError('Please enter a valid email address.')
    if (password.length < 4) return setError('Password must be at least 4 characters long.')

    const users = getStoredUsers()
    const exists = users.find(
      (u) => u.email.toLowerCase() === email || u.name.toLowerCase() === name.toLowerCase()
    )

    if (exists) {
      setError('An account with this email/name already exists. Please login.')
      return
    }

    const newUser = {
      name,
      email,
      password,
      vehicle: regVehicle,
    }

    const updated = [...users, newUser]
    saveStoredUsers(updated)

    setSuccessMsg('Account registered successfully! Please sign in with your credentials below.')
    setLoginIdentifier(email)
    setLoginPassword(password)
    setTab('login')
  }

  // Handle Customer Login (Must match a registered user)
  const handleLogin = (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    const identifier = loginIdentifier.trim().toLowerCase()
    const password = loginPassword.trim()

    if (!identifier) return setError('Please enter your email or name.')
    if (!password) return setError('Please enter your password.')

    const users = getStoredUsers()
    const user = users.find(
      (u) =>
        u.email.toLowerCase() === identifier ||
        u.name.toLowerCase() === identifier
    )

    if (!user) {
      setError('No account found with this email/name. Please register first.')
      return
    }

    if (user.password && user.password !== password) {
      setError('Incorrect password. Please verify and try again.')
      return
    }

    onLogin(user)
  }

  // Quick 1-click test login for judges
  const handleDemoLogin = (demo) => {
    const users = getStoredUsers()
    let user = users.find((u) => u.email === demo.email)
    if (!user) {
      user = demo
      saveStoredUsers([...users, user])
    }
    onLogin(user)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand-mark" aria-hidden="true">P</div>
          <h2>Welcome to SpotShare</h2>
          <p className="muted small">Hyperlocal Parking &amp; EV Charging Marketplace</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => {
              setTab('login')
              setError('')
            }}
          >
            Customer Login
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => {
              setTab('register')
              setError('')
              setSuccessMsg('')
            }}
          >
            Register Account
          </button>
        </div>

        {successMsg && (
          <p className="alert alert-success" role="status">
            {successMsg}
          </p>
        )}

        {tab === 'login' ? (
          <form onSubmit={handleLogin} noValidate>
            <label className="field">
              <span>Registered Email or Name</span>
              <input
                type="text"
                placeholder="e.g. ashish@example.com"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                placeholder="Enter password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </label>

            {error && <p className="alert alert-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
              Sign In to Marketplace
            </button>
            <p className="muted small" style={{ textAlign: 'center', marginTop: '14px' }}>
              Don't have an account yet?{' '}
              <button
                type="button"
                className="btn-link"
                style={{ padding: 0, textDecoration: 'underline' }}
                onClick={() => setTab('register')}
              >
                Register here
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} noValidate>
            <label className="field">
              <span>Full Name</span>
              <input
                type="text"
                placeholder="e.g. Ashish Kumar"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Email Address</span>
              <input
                type="email"
                placeholder="e.g. ashish@example.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Primary Vehicle</span>
              <select value={regVehicle} onChange={(e) => setRegVehicle(e.target.value)}>
                <option value="car">Car (4-Wheeler)</option>
                <option value="bike">Bike (2-Wheeler)</option>
              </select>
            </label>
            <label className="field">
              <span>Create Password</span>
              <input
                type="password"
                placeholder="At least 4 characters"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
            </label>

            {error && <p className="alert alert-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
              Register &amp; Save Profile
            </button>
            <p className="muted small" style={{ textAlign: 'center', marginTop: '14px' }}>
              Already registered?{' '}
              <button
                type="button"
                className="btn-link"
                style={{ padding: 0, textDecoration: 'underline' }}
                onClick={() => setTab('login')}
              >
                Sign in here
              </button>
            </p>
          </form>
        )}

        <div className="auth-demo-box">
          <p className="muted small">Quick 1-Click Demo Login (Pre-registered accounts):</p>
          <div className="demo-chips">
            <button
              type="button"
              className="chip-btn"
              onClick={() =>
                handleDemoLogin({
                  name: 'Ashish Kumar',
                  email: 'ashish@example.com',
                  password: 'password123',
                  vehicle: 'car',
                })
              }
            >
              🚗 Ashish (Car)
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() =>
                handleDemoLogin({
                  name: 'Priya Sharma',
                  email: 'priya@example.com',
                  password: 'password123',
                  vehicle: 'car',
                })
              }
            >
              ⚡ Priya (EV Driver)
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() =>
                handleDemoLogin({
                  name: 'Rahul Verma',
                  email: 'rahul@example.com',
                  password: 'password123',
                  vehicle: 'bike',
                })
              }
            >
              🏍️ Rahul (Bike)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Category Selection Screen (Portal) ---------- */

function CategoryPortal({ user, spots, onSelectCategory }) {
  const parkingCount = useMemo(() => spots.filter((s) => !s.ev_charging).length, [spots])
  const evCount = useMemo(() => spots.filter((s) => s.ev_charging).length, [spots])

  return (
    <div className="portal-wrap">
      <div className="portal-hero">
        <h2>Hello, {user.name}!</h2>
        <p>Choose what you are looking for today to open that dedicated marketplace:</p>
      </div>

      <div className="portal-grid">
        <div
          className="portal-card card-parking"
          onClick={() => onSelectCategory('parking')}
          role="button"
          tabIndex={0}
        >
          <div className="portal-icon">🅿️</div>
          <div>
            <h3>Parking Spaces</h3>
            <p className="muted small">Standard parking lots, garages &amp; driveways</p>
          </div>
          <ul className="portal-features">
            <li>Standard &amp; covered parking spaces</li>
            <li>Available for Cars, Bikes &amp; Vans</li>
            <li>24/7 CCTV &amp; attendant monitoring</li>
            <li>Instant spot reservation from ₹10/hr</li>
          </ul>
          <div className="portal-foot">
            <span className="badge status-available">{parkingCount} Spaces Available</span>
            <button className="btn btn-primary btn-sm" type="button">
              Open Parking Spaces →
            </button>
          </div>
        </div>

        <div
          className="portal-card card-ev"
          onClick={() => onSelectCategory('ev')}
          role="button"
          tabIndex={0}
        >
          <div className="portal-icon">⚡</div>
          <div>
            <h3>EV Charging Hubs</h3>
            <p className="muted small">High-power charging stations &amp; dedicated EV bays</p>
          </div>
          <ul className="portal-features">
            <li>Fast AC &amp; DC charging up to 22 kW</li>
            <li>Dedicated electric vehicle bays</li>
            <li>Verified real-time charger availability</li>
            <li>Combined parking + charging rates</li>
          </ul>
          <div className="portal-foot">
            <span className="badge badge-ev">{evCount} EV Hubs Ready</span>
            <button
              className="btn btn-sm"
              type="button"
              style={{ background: 'var(--ev)', color: '#0b1220', fontWeight: 700 }}
            >
              Open EV Charging →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Simulator Panel ---------- */

function SimulatorPanel({ bookings, spotsById, onCheckIn, onReset }) {
  const [bookingId, setBookingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const active = bookings.filter((b) => b.status !== 'cancelled')

  useEffect(() => {
    if (!active.find((b) => b.id === bookingId)) setBookingId(active[0]?.id ?? '')
  }, [active, bookingId])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      setResult(await fn())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const barrier = String(result?.barrier_state ?? result?.barrier ?? '').toLowerCase()
  const isOpen = barrier.includes('open')

  const feedback =
    result?.bookings_reset != null
      ? `Reset complete: ${result.bookings_reset} bookings reset. Barrier closed.`
      : result?.booking
        ? `Check-in simulated for ${result.booking.spot_name || 'space'}. Barrier open.`
        : result?.message ?? result?.notice ?? result?.status ?? 'Simulator updated.'

  return (
    <section className="panel" aria-labelledby="sim-title">
      <div className="panel-head">
        <h2 id="sim-title">Occupancy simulator</h2>
        <span className="badge badge-sim">SIMULATED</span>
      </div>
      <p className="muted small">
        Demo only. This does not control any physical parking barrier.
      </p>

      <div className={`barrier ${isOpen ? 'open' : ''}`} aria-label="Simulated barrier">
        <div className="barrier-post" />
        <div className="barrier-arm" />
        <span className="barrier-label">
          Barrier:{' '}
          {barrier
            ? isOpen
              ? 'open (simulated)'
              : `${barrier} (simulated)`
            : 'closed (simulated)'}
        </span>
      </div>

      {active.length === 0 ? (
        <p className="muted small">Make a booking to try a simulated check-in.</p>
      ) : (
        <div className="row">
          <select
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            aria-label="Booking to check in"
          >
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {spotsById[b.spotId]?.name ?? b.spotName ?? b.spotId} · {formatDateTime(b.start)} ({b.status})
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            disabled={busy || !bookingId}
            onClick={() => run(() => onCheckIn(bookingId))}
          >
            Simulate check-in
          </button>
        </div>
      )}
      <button className="btn btn-ghost" disabled={busy} onClick={() => run(onReset)}>
        Reset simulation
      </button>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {result && !error && (
        <p className="alert alert-success" role="status">
          {feedback}
        </p>
      )}
    </section>
  )
}

/* ---------- Main App Component ---------- */

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('spotshare_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // 'auth' | 'portal' | 'marketplace'
  const [viewMode, setViewMode] = useState(() => (currentUser ? 'portal' : 'auth'))
  const [activeCategory, setActiveCategory] = useState('parking') // 'parking' | 'ev'
  const [bookingTab, setBookingTab] = useState('active') // 'active' | 'history'

  const [spots, setSpots] = useState([])
  const [bookings, setBookings] = useState([])
  const [loadState, setLoadState] = useState('loading') // loading | ready | error
  const [loadError, setLoadError] = useState('')
  const [apiOk, setApiOk] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [location, setLocation] = useState(DEFAULT_LOCATION)
  const [selectedId, setSelectedId] = useState(null)
  const [modalSpot, setModalSpot] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind })
    window.clearTimeout(showToast.t)
    showToast.t = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const loadSpots = useCallback(async (silent = false) => {
    if (!silent) setLoadState('loading')
    try {
      const data = await apiRequest('/api/spots')
      setSpots(asList(data, 'spots'))
      setLoadState('ready')
      setLoadError('')
    } catch (e) {
      if (!silent) setLoadState('error')
      setLoadError(e.message)
    }
  }, [])

  const loadBookings = useCallback(async () => {
    try {
      const data = await apiRequest('/api/bookings')
      setBookings(asList(data, 'bookings').map(normalizeBooking))
    } catch (e) {
      showToast(`Could not load bookings: ${e.message}`, 'error')
    }
  }, [showToast])

  useEffect(() => {
    loadSpots()
    loadBookings()
    apiRequest('/api/health')
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false))
  }, [loadSpots, loadBookings])

  const handleLogin = (user) => {
    setCurrentUser(user)
    try {
      localStorage.setItem('spotshare_user', JSON.stringify(user))
    } catch {
      /* ignore storage errors */
    }
    setViewMode('portal')
  }

  const handleLogout = () => {
    setCurrentUser(null)
    try {
      localStorage.removeItem('spotshare_user')
    } catch {
      /* ignore storage errors */
    }
    setViewMode('auth')
  }

  const handleSelectCategory = (cat) => {
    setActiveCategory(cat)
    setFilters(DEFAULT_FILTERS)
    setViewMode('marketplace')
  }

  const spotsById = useMemo(
    () => Object.fromEntries(spots.map((s) => [s.id, s])),
    [spots]
  )

  // STRICT category filtering:
  // Distance max 20 km, Price max 200/hr
  const visibleSpots = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    const withDistance = spots.map((s) => ({
      spot: s,
      distanceKm: haversineKm(location.latitude, location.longitude, s.latitude, s.longitude),
    }))

    const filtered = withDistance.filter(({ spot, distanceKm }) => {
      // 1. Strict Category Isolation:
      if (activeCategory === 'parking' && spot.ev_charging) return false
      if (activeCategory === 'ev' && !spot.ev_charging) return false

      // 2. Search text
      if (q && !`${spot.name} ${spot.address}`.toLowerCase().includes(q)) return false

      // 3. Sliders: Distance max 20 km, Price max 200/hr
      if (filters.maxDistanceKm < 20 && distanceKm > filters.maxDistanceKm) return false
      if (filters.maxPrice < 200 && spot.price_per_hour > filters.maxPrice) return false

      // 4. Availability
      if (filters.availableOnly && !(spot.status === 'available' && spot.available_spaces > 0)) {
        return false
      }

      // 5. Vehicle type
      if (
        filters.vehicleType !== 'all' &&
        !(spot.vehicle_types || []).includes(filters.vehicleType)
      ) {
        return false
      }
      return true
    })

    const sorters = {
      distance: (a, b) => a.distanceKm - b.distanceKm,
      price: (a, b) => a.spot.price_per_hour - b.spot.price_per_hour,
      rating: (a, b) => (b.spot.rating ?? 0) - (a.spot.rating ?? 0),
    }
    return filtered.sort(sorters[filters.sort] || sorters.distance)
  }, [spots, filters, location, activeCategory])

  const categoryTotalCount = useMemo(() => {
    if (activeCategory === 'parking') return spots.filter((s) => !s.ev_charging).length
    if (activeCategory === 'ev') return spots.filter((s) => s.ev_charging).length
    return spots.length
  }, [spots, activeCategory])

  // Active bookings (not cancelled)
  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled'),
    [bookings]
  )

  // Full history (all bookings, sorted by newest)
  const historyBookings = useMemo(
    () => [...bookings].sort((a, b) => new Date(b.createdAt || b.start) - new Date(a.createdAt || a.start)),
    [bookings]
  )

  const selectSpot = useCallback((id) => {
    setSelectedId(id)
    requestAnimationFrame(() =>
      document
        .getElementById(`spot-card-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    )
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported in this browser.', 'error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          label: 'Your current location',
        }),
      () => showToast('Could not get your location. Using the demo reference point.', 'error'),
      { timeout: 8000 }
    )
  }

  const handleBook = async (payload) => {
    const created = await apiRequest('/api/bookings', { method: 'POST', body: payload })
    await Promise.all([loadSpots(true), loadBookings()])
    return normalizeBooking(created)
  }

  // Cancel booking: updates backend, records cancellation time in history
  const handleCancel = async (id) => {
    try {
      await apiRequest(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await Promise.all([loadSpots(true), loadBookings()])
      showToast('Booking cancelled.')
    } catch (e) {
      showToast(`Cancel failed: ${e.message}`, 'error')
    }
  }

  const handleCheckIn = async (bookingId) => {
    const res = await apiRequest('/api/simulator/check-in', {
      method: 'POST',
      body: { booking_id: bookingId },
    })
    await Promise.all([loadSpots(true), loadBookings()])
    return res
  }

  const handleReset = async () => {
    const res = await apiRequest('/api/simulator/reset', { method: 'POST' })
    await Promise.all([loadSpots(true), loadBookings()])
    return res
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => currentUser && setViewMode('portal')}>
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <div>
            <h1>SpotShare</h1>
            <p>
              {viewMode === 'marketplace'
                ? activeCategory === 'parking'
                  ? '🅿️ Parking Spaces'
                  : '⚡ EV Charging Hubs'
                : 'Hyperlocal parking & EV charging'}
            </p>
          </div>
        </div>

        <div className="topbar-right">
          {currentUser && viewMode === 'marketplace' && (
            <div className="category-nav" role="tablist">
              <button
                type="button"
                className={`cat-btn cat-parking ${activeCategory === 'parking' ? 'active cat-parking' : ''}`}
                onClick={() => handleSelectCategory('parking')}
              >
                🅿️ Parking Spaces
              </button>
              <button
                type="button"
                className={`cat-btn cat-ev ${activeCategory === 'ev' ? 'active cat-ev' : ''}`}
                onClick={() => handleSelectCategory('ev')}
              >
                ⚡ EV Charging Hubs
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                onClick={() => setViewMode('portal')}
              >
                ← Categories
              </button>
            </div>
          )}

          {currentUser ? (
            <div className="user-badge">
              <span>👤 {currentUser.name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          ) : null}

          <span
            className={`pill ${apiOk === null ? '' : apiOk ? 'pill-ok' : 'pill-bad'}`}
            title={API_BASE}
          >
            {apiOk === null ? 'Checking API…' : apiOk ? 'API online' : 'API offline'}
          </span>
        </div>
      </header>

      {/* Screen 1: Auth Screen (Registration Enforced First) */}
      {!currentUser || viewMode === 'auth' ? (
        <AuthScreen onLogin={handleLogin} />
      ) : viewMode === 'portal' ? (
        /* Screen 2: Category Choice Portal */
        <CategoryPortal
          user={currentUser}
          spots={spots}
          onSelectCategory={handleSelectCategory}
        />
      ) : (
        /* Screen 3: Strict Dedicated Marketplace */
        <main className="layout">
          <div className="col-left">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
              onUseLocation={useMyLocation}
              locationLabel={location.label}
              resultCount={visibleSpots.length}
              totalCount={categoryTotalCount}
              activeCategory={activeCategory}
            />

            <section aria-live="polite">
              {loadState === 'loading' && (
                <div className="state-box" role="status">
                  <div className="spinner" />
                  <p>
                    Loading {activeCategory === 'parking' ? 'parking spaces' : 'EV charging hubs'}…
                  </p>
                </div>
              )}
              {loadState === 'error' && (
                <div className="state-box state-error" role="alert">
                  <p>
                    <strong>Couldn’t load spaces.</strong>
                  </p>
                  <p className="muted">{loadError}</p>
                  <button className="btn btn-primary" onClick={() => loadSpots()}>
                    Try again
                  </button>
                </div>
              )}
              {loadState === 'ready' && visibleSpots.length === 0 && (
                <div className="state-box">
                  <p>
                    <strong>
                      No {activeCategory === 'parking' ? 'parking spaces' : 'EV charging hubs'} match your filters.
                    </strong>
                  </p>
                  <p className="muted">
                    Try widening the distance (up to 20 km) or price (up to ₹200/hr), or reset the filters.
                  </p>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                  >
                    Reset filters
                  </button>
                </div>
              )}
              {loadState === 'ready' && visibleSpots.length > 0 && (
                <div className="spot-list">
                  {visibleSpots.map(({ spot, distanceKm }) => (
                    <SpotCard
                      key={spot.id}
                      spot={spot}
                      distanceKm={distanceKm}
                      selected={spot.id === selectedId}
                      onSelect={() => selectSpot(spot.id)}
                      onBook={() => setModalSpot(spot)}
                      activeCategory={activeCategory}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="col-right">
            <section className="panel map-panel" aria-label="Map">
              <ParkingMap
                spots={visibleSpots.map((v) => v.spot)}
                selectedSpotId={selectedId}
                onSelectSpot={selectSpot}
                userLocation={{
                  latitude: location.latitude,
                  longitude: location.longitude,
                }}
              />
            </section>

            <SmartInsights
              apiBaseUrl={API_BASE}
              userLocation={{
                latitude: location.latitude,
                longitude: location.longitude,
              }}
              filters={filters}
              onSelectSpot={selectSpot}
            />

            {/* Bookings & History Section */}
            <section className="panel" aria-labelledby="bookings-title">
              <div className="panel-head" style={{ marginBottom: '10px' }}>
                <h2 id="bookings-title">Bookings &amp; History</h2>
                <span className="badge badge-soft">
                  {activeBookings.length} Active · {historyBookings.length} Total
                </span>
              </div>

              <div className="booking-tabs" role="tablist">
                <button
                  type="button"
                  className={`b-tab-btn ${bookingTab === 'active' ? 'active' : ''}`}
                  onClick={() => setBookingTab('active')}
                >
                  Active Bookings ({activeBookings.length})
                </button>
                <button
                  type="button"
                  className={`b-tab-btn ${bookingTab === 'history' ? 'active' : ''}`}
                  onClick={() => setBookingTab('history')}
                >
                  📜 Booking History ({historyBookings.length})
                </button>
              </div>

              {bookingTab === 'active' ? (
                /* Tab 1: Active Bookings */
                activeBookings.length === 0 ? (
                  <p className="muted small">
                    No active bookings. Pick a space and hit “Book”.
                  </p>
                ) : (
                  <ul className="booking-list">
                    {activeBookings.map((b) => (
                      <li key={b.id}>
                        <div>
                          <strong>{spotsById[b.spotId]?.name ?? b.spotName ?? b.spotId}</strong>
                          <div className="muted small">
                            {formatDateTime(b.start)} → {formatDateTime(b.end)} · {b.duration}
                          </div>
                          <div className="small">
                            {formatMoney(b.total)} · <span className="status-text">{b.status}</span>
                          </div>
                        </div>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleCancel(b.id)}
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                /* Tab 2: Full History (Shows when booked & when cancelled) */
                historyBookings.length === 0 ? (
                  <p className="muted small">No booking history recorded yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {historyBookings.map((b) => {
                      const isCancelled = b.status === 'cancelled'
                      return (
                        <div key={b.id} className="history-item">
                          <div className="history-head">
                            <strong>{spotsById[b.spotId]?.name ?? b.spotName ?? b.spotId}</strong>
                            <span
                              className={
                                isCancelled
                                  ? 'history-badge-cancelled'
                                  : 'history-badge-confirmed'
                              }
                            >
                              {b.status}
                            </span>
                          </div>

                          <div className="small muted">
                            Slot: {formatDateTime(b.start)} → {formatDateTime(b.end)} ({b.duration})
                          </div>
                          <div className="small">
                            Amount: <strong>{formatMoney(b.total)}</strong>
                          </div>

                          <div className="history-timeline">
                            <div>
                              📅 <strong>Booked on:</strong> {formatDateTime(b.createdAt || b.start)}
                            </div>
                            {isCancelled && (
                              <div style={{ color: 'var(--bad)' }}>
                                ❌ <strong>Cancelled on:</strong> {formatDateTime(b.cancelledAt || new Date().toISOString())}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              )}
            </section>

            <SimulatorPanel
              bookings={activeBookings}
              spotsById={spotsById}
              onCheckIn={handleCheckIn}
              onReset={handleReset}
            />
          </aside>
        </main>
      )}

      {modalSpot && (
        <BookingModal
          spot={modalSpot}
          currentUser={currentUser}
          onClose={() => setModalSpot(null)}
          onBook={handleBook}
          formatMoney={formatMoney}
          formatDateTime={formatDateTime}
        />
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  )
}
