"""SpotShare FastAPI backend. Owner: Member 2.

Run from the backend/ directory:   uvicorn main:app --reload --port 8000
Interactive docs:                  http://localhost:8000/docs

Every error response has the same shape:
    {"detail": "<human readable message>", "code": "<machine_code>", "errors": [...optional]}
"""
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import database
from database import ServiceError, to_local_naive
from models import (
    BookingCreate,
    BookingOut,
    BookingStatus,
    CheckInOut,
    CheckInRequest,
    ErrorOut,
    HealthOut,
    ResetOut,
    SpotCreate,
    SpotOut,
    VehicleType,
)

logger = logging.getLogger("spotshare")

# Member 4 owns backend/recommendations.py. Import it defensively so the rest of the API
# still works while that file does not exist yet.
try:
    import recommendations  # type: ignore
except ModuleNotFoundError as exc:  # only swallow "recommendations itself is missing"
    if exc.name != "recommendations":
        raise
    recommendations = None
    logger.warning("backend/recommendations.py not found: /api/recommendations returns 503")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database.init_db()
    yield


app = FastAPI(
    title="SpotShare API",
    version="1.0.0",
    description="Hyperlocal parking and EV charging marketplace. "
                "All timestamps are naive IST (Asia/Kolkata, UTC+05:30) ISO 8601.",
    lifespan=lifespan,
)

_origins = os.getenv(
    "SPOTSHARE_CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8080",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Error handling (one consistent JSON shape)
# --------------------------------------------------------------------------- #
@app.exception_handler(ServiceError)
async def handle_service_error(_request: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status_code,
                        content={"detail": exc.message, "code": exc.code, **exc.extra})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        field = ".".join(str(part) for part in err.get("loc", ()))
        message = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
        errors.append({"field": field, "message": message})
    first = errors[0] if errors else {"field": "request", "message": "Invalid request"}
    return JSONResponse(
        status_code=422,
        content={"detail": f"{first['field']}: {first['message']}",
                 "code": "validation_error", "errors": errors},
    )


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(_request: Request, exc: StarletteHTTPException):
    codes = {404: "not_found", 405: "method_not_allowed"}
    return JSONResponse(status_code=exc.status_code,
                        content={"detail": str(exc.detail),
                                 "code": codes.get(exc.status_code, "http_error")})


@app.exception_handler(Exception)
async def handle_unexpected_error(_request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500,
                        content={"detail": "Internal server error.", "code": "internal_error"})


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _origin(lat: Optional[float], lng: Optional[float]):
    if (lat is None) != (lng is None):
        raise ServiceError(422, "missing_location", "lat and lng must be provided together.")
    return None if lat is None else (lat, lng)


def _norm(value: Optional[datetime]) -> Optional[datetime]:
    return None if value is None else to_local_naive(value)


ERRORS = {422: {"model": ErrorOut}, 404: {"model": ErrorOut}, 409: {"model": ErrorOut}}


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
@app.get("/api/health", response_model=HealthOut)
def health():
    ok = database.check_database()
    body = {
        "status": "ok" if ok else "degraded",
        "service": "spotshare-backend",
        "database": "ok" if ok else "unavailable",
        "timezone": database.TIMEZONE_LABEL,
        "server_time": database.iso(database.now_local()),
    }
    return JSONResponse(status_code=200 if ok else 503, content=body)


# --------------------------------------------------------------------------- #
# Spots
# --------------------------------------------------------------------------- #
@app.get("/api/spots", response_model=List[SpotOut], responses=ERRORS)
def list_spots(
    q: Optional[str] = Query(None, max_length=100, description="Text search on name/address"),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    max_distance_km: Optional[float] = Query(None, gt=0),
    min_price: Optional[float] = Query(None, ge=0),
    max_price: Optional[float] = Query(None, ge=0),
    ev_charging: Optional[bool] = Query(None),
    vehicle_type: Optional[VehicleType] = Query(None),
    available_only: bool = Query(False),
    start_time: Optional[datetime] = Query(None, description="Check availability for this window"),
    end_time: Optional[datetime] = Query(None),
    sort: Optional[Literal["distance", "price", "rating", "name"]] = Query(None),
):
    origin = _origin(lat, lng)
    with database.db_session() as conn:
        return database.list_spots(
            conn, q=q, origin=origin, max_distance_km=max_distance_km, min_price=min_price,
            max_price=max_price, ev_charging=ev_charging, vehicle_type=vehicle_type,
            available_only=available_only, start=_norm(start_time), end=_norm(end_time), sort=sort)


@app.get("/api/spots/{spot_id}", response_model=SpotOut, responses=ERRORS)
def get_spot(
    spot_id: str,
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
):
    origin = _origin(lat, lng)
    with database.db_session() as conn:
        return database.get_spot(conn, spot_id, start=_norm(start_time),
                                 end=_norm(end_time), origin=origin)


@app.post("/api/spots", response_model=SpotOut, status_code=201, responses=ERRORS)
def create_spot(body: SpotCreate):
    with database.db_session() as conn:
        return database.create_spot(conn, body.model_dump())


# --------------------------------------------------------------------------- #
# Bookings
# --------------------------------------------------------------------------- #
@app.get("/api/bookings", response_model=List[BookingOut], responses=ERRORS)
def list_bookings(
    spot_id: Optional[str] = Query(None),
    status: Optional[BookingStatus] = Query(None),
    customer_name: Optional[str] = Query(None, max_length=80),
):
    with database.db_session() as conn:
        return database.list_bookings(conn, spot_id=spot_id, status=status,
                                      customer_name=customer_name)


@app.post("/api/bookings", response_model=BookingOut, status_code=201, responses=ERRORS)
def create_booking(body: BookingCreate):
    with database.db_session() as conn:
        return database.create_booking(
            conn, spot_id=body.spot_id, customer_name=body.customer_name,
            start=body.start_time, end=body.end_time, vehicle_type=body.vehicle_type,
            requires_ev_charging=body.requires_ev_charging)


@app.delete("/api/bookings/{booking_id}", response_model=BookingOut, responses=ERRORS)
def cancel_booking(booking_id: str):
    """Cancels (soft delete) and returns the booking with status 'cancelled'."""
    with database.db_session() as conn:
        return database.cancel_booking(conn, booking_id)


# --------------------------------------------------------------------------- #
# Recommendations (ranking logic lives in Member 4's recommendations.py)
# --------------------------------------------------------------------------- #
@app.get("/api/recommendations", responses={**ERRORS, 503: {"model": ErrorOut}})
def get_recommendations(
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    max_price: Optional[float] = Query(None, ge=0),
    max_distance_km: Optional[float] = Query(None, gt=0),
    vehicle_type: Optional[VehicleType] = Query(None),
    requires_ev_charging: bool = Query(False),
    limit: int = Query(5, ge=1, le=20),
):
    if recommendations is None or not hasattr(recommendations, "recommend_spots"):
        raise ServiceError(503, "recommendations_unavailable",
                           "Recommendation engine is not installed yet "
                           "(backend/recommendations.py must define recommend_spots).")
    origin = _origin(lat, lng)
    start, end = _norm(start_time), _norm(end_time)
    with database.db_session() as conn:
        spots = database.list_spots(conn, origin=origin, start=start, end=end)
    preferences = {
        "latitude": lat,
        "longitude": lng,
        "start_time": database.iso(start) if start else None,
        "end_time": database.iso(end) if end else None,
        "max_price": max_price,
        "max_distance_km": max_distance_km,
        "vehicle_type": vehicle_type,
        "requires_ev_charging": requires_ev_charging,
        "limit": limit,
    }
    return recommendations.recommend_spots(spots, preferences)


# --------------------------------------------------------------------------- #
# Insights
# --------------------------------------------------------------------------- #
@app.get("/api/insights")
def get_insights():
    with database.db_session() as conn:
        return database.get_insights(conn)


# --------------------------------------------------------------------------- #
# Simulator (software only; never claims to control real hardware)
# --------------------------------------------------------------------------- #
@app.post("/api/simulator/check-in", response_model=CheckInOut, responses=ERRORS)
def simulator_check_in(body: CheckInRequest):
    with database.db_session() as conn:
        booking = database.simulator_check_in(conn, body.booking_id)
        spot = database.get_spot(conn, booking["spot_id"])
    return {"simulated": True, "notice": database.SIMULATOR_NOTICE, "barrier": "open",
            "booking": booking, "spot": spot}


@app.post("/api/simulator/reset", response_model=ResetOut)
def simulator_reset():
    with database.db_session() as conn:
        count = database.simulator_reset(conn)
    return {"simulated": True, "notice": database.SIMULATOR_NOTICE, "barrier": "closed",
            "bookings_reset": count}
