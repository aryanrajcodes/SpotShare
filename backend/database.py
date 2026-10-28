"""SpotShare data layer: SQLite schema, demo seed data and all business rules.

Owner: Member 2.  Uses only the Python standard library (sqlite3), so it can be
imported and tested without FastAPI or Pydantic installed.

TIMEZONE CONVENTION (documented for the whole team)
---------------------------------------------------
All timestamps are *naive local time* in Asia/Kolkata (IST, UTC+05:30), written as
ISO 8601 "YYYY-MM-DDTHH:MM:SS" (no offset, no microseconds).
If a client sends a timestamp WITH an offset (e.g. "...Z" or "+05:30"), the backend
converts it to IST first, so the stored value is always IST.
Booking intervals are half-open [start, end): a booking ending at 12:00 does not
conflict with one starting at 12:00.
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
DB_PATH = Path(
    os.getenv("SPOTSHARE_DB_PATH", str(Path(__file__).resolve().parent / "spotshare.db"))
)

LOCAL_TZ = timezone(timedelta(hours=5, minutes=30))
TIMEZONE_LABEL = "Asia/Kolkata (UTC+05:30)"
ISO_FORMAT = "%Y-%m-%dT%H:%M:%S"

VEHICLE_TYPES = ("car", "bike", "van")  # keep in sync with models.VehicleType
ACTIVE_STATUSES = ("confirmed", "checked_in")

MIN_BOOKING_MINUTES = 30
MAX_BOOKING_MINUTES = 24 * 60
PAST_GRACE_MINUTES = 5  # start_time may be at most this far in the past
CHECKIN_EARLY_MINUTES = int(os.getenv("SPOTSHARE_CHECKIN_EARLY_MINUTES", "15"))
ALLOW_PAST_BOOKINGS = os.getenv("SPOTSHARE_ALLOW_PAST", "0") == "1"  # for automated tests

SIMULATOR_NOTICE = (
    "SIMULATED: this is a software demo. No physical barrier or hardware is controlled."
)


class ServiceError(Exception):
    """A business-rule failure that maps to an HTTP error response."""

    def __init__(self, status_code: int, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra


# --------------------------------------------------------------------------- #
# Time + geo helpers
# --------------------------------------------------------------------------- #
def now_local() -> datetime:
    return datetime.now(LOCAL_TZ).replace(tzinfo=None, microsecond=0)


def to_local_naive(value: datetime) -> datetime:
    """Convert any datetime to naive IST without microseconds."""
    if value.tzinfo is not None:
        value = value.astimezone(LOCAL_TZ).replace(tzinfo=None)
    return value.replace(microsecond=0)


def iso(value: datetime) -> str:
    return value.strftime(ISO_FORMAT)


def parse_iso(text: str) -> datetime:
    return datetime.strptime(text, ISO_FORMAT)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres (Member 4 may import this)."""
    radius = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def _num(value: Optional[float]) -> Optional[float]:
    """Round to 2 dp and drop a trailing .0 so 30.0 is serialised as 30."""
    if value is None:
        return None
    value = round(float(value), 2)
    return int(value) if value.is_integer() else value


# --------------------------------------------------------------------------- #
# Connections / transactions
# --------------------------------------------------------------------------- #
def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session():
    """One short-lived connection per request (safe with FastAPI's thread pool)."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_tx(conn: sqlite3.Connection):
    """BEGIN IMMEDIATE takes the write lock up front, so check-then-insert is atomic."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


SCHEMA = """
CREATE TABLE IF NOT EXISTS spots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    price_per_hour REAL NOT NULL CHECK (price_per_hour >= 0),
    vehicle_types TEXT NOT NULL,
    ev_charging INTEGER NOT NULL DEFAULT 0,
    charger_power_kw REAL,
    capacity INTEGER NOT NULL CHECK (capacity >= 1),
    rating REAL,
    amenities TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    spot_id TEXT NOT NULL REFERENCES spots(id),
    customer_name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    requires_ev_charging INTEGER NOT NULL DEFAULT 0,
    duration_minutes REAL NOT NULL,
    total_price REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'checked_in', 'cancelled')),
    created_at TEXT NOT NULL,
    cancelled_at TEXT,
    checked_in_at TEXT,
    CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_bookings_spot_time ON bookings (spot_id, start_time, end_time);
"""


def init_db() -> None:
    """Create tables and seed the demo dataset when the spots table is empty."""
    with db_session() as conn:
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) FROM spots").fetchone()[0]
        if count == 0:
            with write_tx(conn):
                _seed_demo(conn)


def check_database() -> bool:
    try:
        with db_session() as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except sqlite3.Error:
        return False


# --------------------------------------------------------------------------- #
# Demo data (ILLUSTRATIVE: invented listings, coordinates approximate around Mysuru)
# --------------------------------------------------------------------------- #
DEMO_SPOTS: List[Dict[str, Any]] = [
    dict(id="spot101", name="Campus Parking", address="Demo Street, Mysuru",
         latitude=12.2958, longitude=76.6394, price_per_hour=30,
         vehicle_types=["car", "bike"], ev_charging=False, charger_power_kw=None,
         capacity=10, rating=4.5, amenities=["CCTV", "Lighting"]),
    dict(id="spot102", name="Palace North Gate Parking", address="Palace area, Mysuru",
         latitude=12.3068, longitude=76.6540, price_per_hour=60,
         vehicle_types=["car", "bike", "van"], ev_charging=True, charger_power_kw=7.4,
         capacity=20, rating=4.2, amenities=["CCTV", "Attendant", "Lighting"]),
    dict(id="spot103", name="Railway Station Multi-level", address="Station Road, Mysuru",
         latitude=12.3135, longitude=76.6428, price_per_hour=40,
         vehicle_types=["car", "bike"], ev_charging=False, charger_power_kw=None,
         capacity=40, rating=4.0, amenities=["CCTV", "Covered", "Lighting"]),
    dict(id="spot104", name="Devaraja Market Lot", address="Market area, Mysuru",
         latitude=12.3085, longitude=76.6527, price_per_hour=50,
         vehicle_types=["car", "bike"], ev_charging=False, charger_power_kw=None,
         capacity=6, rating=3.8, amenities=["Attendant"]),
    dict(id="spot105", name="Zoo Visitors Parking", address="Zoo Road, Mysuru",
         latitude=12.3010, longitude=76.6652, price_per_hour=25,
         vehicle_types=["car", "bike", "van"], ev_charging=False, charger_power_kw=None,
         capacity=30, rating=4.1, amenities=["Lighting", "Restrooms"]),
    dict(id="spot106", name="Chamundi Hill Base Lot", address="Hill base, Mysuru",
         latitude=12.2755, longitude=76.6690, price_per_hour=20,
         vehicle_types=["car", "bike"], ev_charging=False, charger_power_kw=None,
         capacity=25, rating=3.9, amenities=["Lighting"]),
    dict(id="spot107", name="Vijayanagar EV Hub", address="Vijayanagar, Mysuru",
         latitude=12.3330, longitude=76.6160, price_per_hour=70,
         vehicle_types=["car"], ev_charging=True, charger_power_kw=22,
         capacity=8, rating=4.8, amenities=["CCTV", "Lighting", "Fast charging"]),
    dict(id="spot108", name="Gokulam Shared Driveway", address="Gokulam, Mysuru",
         latitude=12.3215, longitude=76.6340, price_per_hour=35,
         vehicle_types=["car", "bike"], ev_charging=False, charger_power_kw=None,
         capacity=2, rating=4.6, amenities=["CCTV"]),
    dict(id="spot109", name="Hebbal Tech Park EV Bays", address="Hebbal, Mysuru",
         latitude=12.3520, longitude=76.6180, price_per_hour=45,
         vehicle_types=["car"], ev_charging=True, charger_power_kw=11,
         capacity=12, rating=4.4, amenities=["CCTV", "Security guard"]),
    dict(id="spot110", name="Lalitha Mahal Road Lot", address="Lalitha Mahal Road, Mysuru",
         latitude=12.2980, longitude=76.6840, price_per_hour=30,
         vehicle_types=["car", "van"], ev_charging=False, charger_power_kw=None,
         capacity=15, rating=4.0, amenities=["Lighting"]),
    dict(id="spot111", name="Central Bike Bay", address="City centre, Mysuru",
         latitude=12.3150, longitude=76.6560, price_per_hour=10,
         vehicle_types=["bike"], ev_charging=False, charger_power_kw=None,
         capacity=30, rating=4.3, amenities=["Covered"]),
    dict(id="spot112", name="Old Town Micro Lot", address="Old Town, Mysuru",
         latitude=12.3040, longitude=76.6490, price_per_hour=55,
         vehicle_types=["car"], ev_charging=False, charger_power_kw=None,
         capacity=1, rating=3.7, amenities=["CCTV"]),
]


def _insert_spot(conn: sqlite3.Connection, spot_id: str, data: Dict[str, Any]) -> None:
    conn.execute(
        """INSERT INTO spots (id, name, address, latitude, longitude, price_per_hour,
               vehicle_types, ev_charging, charger_power_kw, capacity, rating, amenities, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            spot_id, data["name"], data["address"], data["latitude"], data["longitude"],
            data["price_per_hour"], json.dumps(list(data["vehicle_types"])),
            1 if data["ev_charging"] else 0, data.get("charger_power_kw"), data["capacity"],
            data.get("rating"), json.dumps(list(data.get("amenities", []))), iso(now_local()),
        ),
    )


def _insert_booking(conn: sqlite3.Connection, *, booking_id: str, spot_id: str,
                    customer_name: str, start: datetime, end: datetime, vehicle_type: str,
                    requires_ev: bool, total_price: float, status: str = "confirmed") -> None:
    now = iso(now_local())
    seconds = (end - start).total_seconds()
    conn.execute(
        """INSERT INTO bookings (id, spot_id, customer_name, start_time, end_time, vehicle_type,
               requires_ev_charging, duration_minutes, total_price, status, created_at, checked_in_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (booking_id, spot_id, customer_name, iso(start), iso(end), vehicle_type,
         1 if requires_ev else 0, seconds / 60, total_price, status, now,
         now if status == "checked_in" else None),
    )


def _seed_demo(conn: sqlite3.Connection) -> None:
    for spot in DEMO_SPOTS:
        _insert_spot(conn, spot["id"], spot)
    now = now_local().replace(second=0)
    hour = timedelta(hours=1)
    # spot112 (capacity 1): fully reserved but nobody has arrived -> status "reserved"
    _insert_booking(conn, booking_id="bk_demo0001", spot_id="spot112",
                    customer_name="Demo Booking", start=now - timedelta(minutes=30),
                    end=now + timedelta(minutes=90), vehicle_type="car",
                    requires_ev=False, total_price=110)
    # spot108 (capacity 2): one car already inside, one reserved -> full + occupied
    _insert_booking(conn, booking_id="bk_demo0002", spot_id="spot108",
                    customer_name="Demo Booking", start=now - hour, end=now + hour,
                    vehicle_type="car", requires_ev=False, total_price=70, status="checked_in")
    _insert_booking(conn, booking_id="bk_demo0003", spot_id="spot108",
                    customer_name="Demo Booking", start=now - timedelta(minutes=15),
                    end=now + timedelta(hours=2), vehicle_type="bike",
                    requires_ev=False, total_price=78.75)
    # spot102: an upcoming booking tomorrow 10:00-12:00 so the bookings list is not empty
    tomorrow = (now + timedelta(days=1)).replace(hour=10, minute=0)
    _insert_booking(conn, booking_id="bk_demo0004", spot_id="spot102",
                    customer_name="Demo Booking", start=tomorrow,
                    end=tomorrow + timedelta(hours=2), vehicle_type="car",
                    requires_ev=True, total_price=120)


def reset_demo_data() -> None:
    """Wipe spots + bookings and re-seed. Only used from the command line."""
    with db_session() as conn:
        conn.executescript(SCHEMA)
        with write_tx(conn):
            conn.execute("DELETE FROM bookings")
            conn.execute("DELETE FROM spots")
            _seed_demo(conn)


# --------------------------------------------------------------------------- #
# Availability
# --------------------------------------------------------------------------- #
Interval = Tuple[datetime, datetime, str]


def _active_intervals(conn: sqlite3.Connection, ws: datetime, we: datetime,
                      spot_id: Optional[str] = None) -> Dict[str, List[Interval]]:
    sql = ("SELECT spot_id, start_time, end_time, status FROM bookings "
           "WHERE status IN ('confirmed', 'checked_in') AND start_time < ? AND end_time > ?")
    params: List[Any] = [iso(we), iso(ws)]
    if spot_id is not None:
        sql += " AND spot_id = ?"
        params.append(spot_id)
    grouped: Dict[str, List[Interval]] = {}
    for row in conn.execute(sql, params):
        grouped.setdefault(row["spot_id"], []).append(
            (parse_iso(row["start_time"]), parse_iso(row["end_time"]), row["status"])
        )
    return grouped


def peak_concurrency(intervals: Iterable[Interval], ws: datetime, we: datetime) -> int:
    """Largest number of bookings that overlap each other inside [ws, we)."""
    events: List[Tuple[datetime, int]] = []
    for start, end, _status in intervals:
        start, end = max(start, ws), min(end, we)
        if start < end:
            events.append((start, 1))
            events.append((end, -1))
    events.sort()  # at equal times -1 sorts before +1, i.e. half-open intervals
    current = peak = 0
    for _t, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def _window(start: Optional[datetime], end: Optional[datetime]) -> Tuple[datetime, datetime]:
    if start is None and end is None:
        now = now_local()
        return now, now + timedelta(seconds=1)  # "right now"
    if start is None or end is None:
        raise ServiceError(422, "invalid_window",
                           "start_time and end_time must be provided together.")
    if end <= start:
        raise ServiceError(422, "invalid_window", "end_time must be after start_time.")
    return start, end


def _spot_view(row: sqlite3.Row, intervals: List[Interval], ws: datetime, we: datetime,
               origin: Optional[Tuple[float, float]]) -> Dict[str, Any]:
    capacity = row["capacity"]
    free = max(0, capacity - peak_concurrency(intervals, ws, we))
    if free > 0:
        status = "available"
    elif any(s == "checked_in" for _a, _b, s in intervals):
        status = "occupied"
    else:
        status = "reserved"
    distance = None
    if origin is not None:
        distance = round(haversine_km(origin[0], origin[1], row["latitude"], row["longitude"]), 2)
    return {
        "id": row["id"],
        "name": row["name"],
        "address": row["address"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "price_per_hour": _num(row["price_per_hour"]),
        "vehicle_types": json.loads(row["vehicle_types"]),
        "ev_charging": bool(row["ev_charging"]),
        "charger_power_kw": _num(row["charger_power_kw"]),
        "capacity": capacity,
        "available_spaces": free,
        "status": status,
        "rating": _num(row["rating"]),
        "amenities": json.loads(row["amenities"]),
        "distance_km": distance,
    }


# --------------------------------------------------------------------------- #
# Spots
# --------------------------------------------------------------------------- #
def list_spots(conn: sqlite3.Connection, *, q: Optional[str] = None,
               origin: Optional[Tuple[float, float]] = None,
               max_distance_km: Optional[float] = None,
               min_price: Optional[float] = None, max_price: Optional[float] = None,
               ev_charging: Optional[bool] = None, vehicle_type: Optional[str] = None,
               available_only: bool = False, start: Optional[datetime] = None,
               end: Optional[datetime] = None, sort: Optional[str] = None) -> List[Dict[str, Any]]:
    if (max_distance_km is not None or sort == "distance") and origin is None:
        raise ServiceError(422, "missing_location",
                           "lat and lng are required for distance filtering or sorting.")
    ws, we = _window(start, end)
    grouped = _active_intervals(conn, ws, we)
    needle = q.strip().lower() if q else ""
    result: List[Dict[str, Any]] = []
    for row in conn.execute("SELECT * FROM spots ORDER BY rowid").fetchall():
        spot = _spot_view(row, grouped.get(row["id"], []), ws, we, origin)
        if needle and needle not in f"{spot['name']} {spot['address']}".lower():
            continue
        if max_distance_km is not None and spot["distance_km"] > max_distance_km:
            continue
        if min_price is not None and spot["price_per_hour"] < min_price:
            continue
        if max_price is not None and spot["price_per_hour"] > max_price:
            continue
        if ev_charging is not None and spot["ev_charging"] != ev_charging:
            continue
        if vehicle_type is not None and vehicle_type not in spot["vehicle_types"]:
            continue
        if available_only and spot["available_spaces"] <= 0:
            continue
        result.append(spot)
    if sort == "distance":
        result.sort(key=lambda s: s["distance_km"])
    elif sort == "price":
        result.sort(key=lambda s: s["price_per_hour"])
    elif sort == "rating":
        result.sort(key=lambda s: (s["rating"] is None, -(s["rating"] or 0)))
    elif sort == "name":
        result.sort(key=lambda s: s["name"].lower())
    return result


def get_spot(conn: sqlite3.Connection, spot_id: str, *, start: Optional[datetime] = None,
             end: Optional[datetime] = None,
             origin: Optional[Tuple[float, float]] = None) -> Dict[str, Any]:
    row = conn.execute("SELECT * FROM spots WHERE id = ?", (spot_id,)).fetchone()
    if row is None:
        raise ServiceError(404, "spot_not_found", f"Parking spot '{spot_id}' does not exist.")
    ws, we = _window(start, end)
    intervals = _active_intervals(conn, ws, we, spot_id).get(spot_id, [])
    return _spot_view(row, intervals, ws, we, origin)


def create_spot(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    with write_tx(conn):
        numbers = [int(m.group(1)) for (sid,) in conn.execute("SELECT id FROM spots")
                   if (m := re.fullmatch(r"spot(\d+)", sid))]
        new_id = f"spot{max(numbers) + 1 if numbers else 101}"
        _insert_spot(conn, new_id, data)
    return get_spot(conn, new_id)


# --------------------------------------------------------------------------- #
# Bookings
# --------------------------------------------------------------------------- #
_BOOKING_SELECT = ("SELECT b.*, s.name AS spot_name FROM bookings b "
                   "JOIN spots s ON s.id = b.spot_id")


def _booking_dict(row: sqlite3.Row) -> Dict[str, Any]:
    minutes = row["duration_minutes"]
    return {
        "id": row["id"],
        "spot_id": row["spot_id"],
        "spot_name": row["spot_name"],
        "customer_name": row["customer_name"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "duration_minutes": _num(minutes),
        "duration_hours": _num(minutes / 60),
        "total_price": _num(row["total_price"]),
        "status": row["status"],
        "vehicle_type": row["vehicle_type"],
        "requires_ev_charging": bool(row["requires_ev_charging"]),
        "created_at": row["created_at"],
        "cancelled_at": row["cancelled_at"],
        "checked_in_at": row["checked_in_at"],
    }


def _fetch_booking(conn: sqlite3.Connection, booking_id: str) -> sqlite3.Row:
    row = conn.execute(_BOOKING_SELECT + " WHERE b.id = ?", (booking_id,)).fetchone()
    if row is None:
        raise ServiceError(404, "booking_not_found", f"Booking '{booking_id}' does not exist.")
    return row


def get_booking(conn: sqlite3.Connection, booking_id: str) -> Dict[str, Any]:
    return _booking_dict(_fetch_booking(conn, booking_id))


def list_bookings(conn: sqlite3.Connection, *, spot_id: Optional[str] = None,
                  status: Optional[str] = None,
                  customer_name: Optional[str] = None) -> List[Dict[str, Any]]:
    sql, params, clauses = _BOOKING_SELECT, [], []
    if spot_id:
        clauses.append("b.spot_id = ?")
        params.append(spot_id)
    if status:
        clauses.append("b.status = ?")
        params.append(status)
    if customer_name:
        clauses.append("LOWER(b.customer_name) = LOWER(?)")
        params.append(customer_name.strip())
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY b.start_time DESC, b.rowid DESC"
    return [_booking_dict(r) for r in conn.execute(sql, params)]


def create_booking(conn: sqlite3.Connection, *, spot_id: str, customer_name: str,
                   start: datetime, end: datetime, vehicle_type: str,
                   requires_ev_charging: bool) -> Dict[str, Any]:
    seconds = (end - start).total_seconds()
    if seconds <= 0:
        raise ServiceError(422, "invalid_duration", "end_time must be after start_time.")
    minutes = seconds / 60
    if minutes < MIN_BOOKING_MINUTES:
        raise ServiceError(422, "invalid_duration",
                           f"Minimum booking duration is {MIN_BOOKING_MINUTES} minutes.")
    if minutes > MAX_BOOKING_MINUTES:
        raise ServiceError(422, "invalid_duration",
                           f"Maximum booking duration is {MAX_BOOKING_MINUTES // 60} hours.")
    if not ALLOW_PAST_BOOKINGS and start < now_local() - timedelta(minutes=PAST_GRACE_MINUTES):
        raise ServiceError(422, "start_in_past", "start_time cannot be in the past.")

    booking_id = f"bk_{uuid.uuid4().hex[:10]}"
    with write_tx(conn):
        spot = conn.execute("SELECT * FROM spots WHERE id = ?", (spot_id,)).fetchone()
        if spot is None:
            raise ServiceError(404, "spot_not_found", f"Parking spot '{spot_id}' does not exist.")
        if vehicle_type not in json.loads(spot["vehicle_types"]):
            raise ServiceError(422, "vehicle_not_supported",
                               f"'{spot['name']}' does not accept vehicle type '{vehicle_type}'.")
        if requires_ev_charging and not spot["ev_charging"]:
            raise ServiceError(422, "ev_charging_unavailable",
                               f"'{spot['name']}' does not offer EV charging.")
        intervals = _active_intervals(conn, start, end, spot_id).get(spot_id, [])
        if peak_concurrency(intervals, start, end) >= spot["capacity"]:
            raise ServiceError(409, "booking_conflict",
                               "No free space at this spot for the selected time. "
                               "Choose different times or another spot.")
        total_price = round(spot["price_per_hour"] * seconds / 3600, 2)
        _insert_booking(conn, booking_id=booking_id, spot_id=spot_id,
                        customer_name=customer_name, start=start, end=end,
                        vehicle_type=vehicle_type, requires_ev=requires_ev_charging,
                        total_price=total_price)
    return get_booking(conn, booking_id)


def cancel_booking(conn: sqlite3.Connection, booking_id: str) -> Dict[str, Any]:
    with write_tx(conn):
        row = _fetch_booking(conn, booking_id)
        if row["status"] == "cancelled":
            raise ServiceError(409, "already_cancelled", "This booking is already cancelled.")
        if row["status"] == "checked_in":
            raise ServiceError(409, "cannot_cancel_checked_in",
                               "A booking that has been checked in cannot be cancelled.")
        if parse_iso(row["end_time"]) <= now_local():
            raise ServiceError(409, "booking_already_ended",
                               "This booking has already ended and cannot be cancelled.")
        conn.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?",
                     (iso(now_local()), booking_id))
    return get_booking(conn, booking_id)


# --------------------------------------------------------------------------- #
# Simulator (software only)
# --------------------------------------------------------------------------- #
def simulator_check_in(conn: sqlite3.Connection, booking_id: str) -> Dict[str, Any]:
    with write_tx(conn):
        row = _fetch_booking(conn, booking_id)
        now = now_local()
        start, end = parse_iso(row["start_time"]), parse_iso(row["end_time"])
        if row["status"] == "cancelled":
            raise ServiceError(409, "checkin_not_allowed", "A cancelled booking cannot check in.")
        if row["status"] == "checked_in":
            raise ServiceError(409, "already_checked_in", "This booking is already checked in.")
        if now >= end:
            raise ServiceError(409, "checkin_not_allowed", "This booking has already ended.")
        opens = start - timedelta(minutes=CHECKIN_EARLY_MINUTES)
        if now < opens:
            raise ServiceError(409, "too_early",
                               f"Check-in opens at {iso(opens)} "
                               f"({CHECKIN_EARLY_MINUTES} minutes before the booking starts).")
        conn.execute("UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ?",
                     (iso(now), booking_id))
    return get_booking(conn, booking_id)


def simulator_reset(conn: sqlite3.Connection) -> int:
    """Return every checked-in booking to 'confirmed' (non-destructive). Returns the count."""
    with write_tx(conn):
        cur = conn.execute("UPDATE bookings SET status = 'confirmed', checked_in_at = NULL "
                           "WHERE status = 'checked_in'")
        return cur.rowcount


# --------------------------------------------------------------------------- #
# Insights (plain aggregates computed from the live data)
# --------------------------------------------------------------------------- #
def get_insights(conn: sqlite3.Connection) -> Dict[str, Any]:
    now = now_local()
    spots = list_spots(conn)
    total_capacity = sum(s["capacity"] for s in spots)
    free = sum(s["available_spaces"] for s in spots)
    used = total_capacity - free
    status_counts = {"available": 0, "reserved": 0, "occupied": 0}
    for s in spots:
        status_counts[s["status"]] += 1

    booking_rows = conn.execute(
        "SELECT status, COUNT(*) AS n, COALESCE(SUM(total_price), 0) AS value "
        "FROM bookings GROUP BY status").fetchall()
    by_status = {r["status"]: (r["n"], r["value"]) for r in booking_rows}
    upcoming = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' AND start_time > ?",
        (iso(now),)).fetchone()[0]
    booked_value = sum(v for st, (_n, v) in by_status.items() if st in ACTIVE_STATUSES)

    available = [s for s in spots if s["available_spaces"] > 0]
    cheapest = min(available, key=lambda s: s["price_per_hour"]) if available else None
    ev_spots = [s for s in spots if s["ev_charging"]]
    ev_free = sum(s["available_spaces"] for s in ev_spots)
    busiest = sorted((s for s in spots if s["capacity"] - s["available_spaces"] > 0),
                     key=lambda s: ((s["capacity"] - s["available_spaces"]) / s["capacity"],
                                    s["capacity"]), reverse=True)[:3]

    highlights = [f"{free} of {total_capacity} parking spaces are free right now."]
    if cheapest:
        highlights.append(f"Cheapest space with room: {cheapest['name']} at "
                          f"{cheapest['price_per_hour']}/hour.")
    if ev_spots:
        highlights.append(f"{ev_free} EV-charging spaces are free across {len(ev_spots)} charging spots.")
    if status_counts["occupied"] + status_counts["reserved"]:
        highlights.append(f"{status_counts['occupied']} spots are full with cars present and "
                          f"{status_counts['reserved']} are fully reserved.")

    return {
        "generated_at": iso(now),
        "timezone": TIMEZONE_LABEL,
        "summary": {
            "total_spots": len(spots),
            "total_capacity": total_capacity,
            "available_spaces": free,
            "occupied_or_reserved_spaces": used,
            "occupancy_rate": round(used / total_capacity, 3) if total_capacity else 0,
            "average_price_per_hour": (
                round(sum(s["price_per_hour"] for s in spots) / len(spots), 2) if spots else None),
        },
        "spot_status_counts": status_counts,
        "bookings": {
            "total": sum(n for n, _v in by_status.values()),
            "confirmed": by_status.get("confirmed", (0, 0))[0],
            "checked_in": by_status.get("checked_in", (0, 0))[0],
            "cancelled": by_status.get("cancelled", (0, 0))[0],
            "upcoming": upcoming,
            "booked_value": _num(booked_value),
        },
        "ev": {
            "charging_spots": len(ev_spots),
            "charging_spaces_total": sum(s["capacity"] for s in ev_spots),
            "charging_spaces_available": ev_free,
        },
        "cheapest_available_spot": (
            {"id": cheapest["id"], "name": cheapest["name"],
             "price_per_hour": cheapest["price_per_hour"]} if cheapest else None),
        "busiest_spots": [
            {"id": s["id"], "name": s["name"],
             "occupancy_rate": round((s["capacity"] - s["available_spaces"]) / s["capacity"], 3)}
            for s in busiest],
        "highlights": highlights,
    }


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "reset":
        reset_demo_data()
        print(f"Demo data reset in {DB_PATH}")
    elif command == "init":
        init_db()
        print(f"Database ready at {DB_PATH}")
    else:
        print("Usage: python database.py [init|reset]")
