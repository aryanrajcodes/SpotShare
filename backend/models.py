"""SpotShare request/response models (Pydantic v2). Owner: Member 2.

All field names are snake_case. Timestamps are naive IST ISO 8601 strings in responses
(see the timezone convention at the top of database.py).
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from database import to_local_naive

# Keep in sync with database.VEHICLE_TYPES
VehicleType = Literal["car", "bike", "van"]
SpotStatus = Literal["available", "reserved", "occupied"]
BookingStatus = Literal["confirmed", "checked_in", "cancelled"]


# ----------------------------- requests ------------------------------------ #
class SpotCreate(BaseModel):
    """Body for POST /api/spots. id, available_spaces and status are server-controlled
    and ignored if the client sends them."""

    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    price_per_hour: float = Field(gt=0, le=100000)
    vehicle_types: List[VehicleType] = Field(min_length=1)
    ev_charging: bool = False
    charger_power_kw: Optional[float] = Field(default=None, gt=0, le=1000)
    capacity: int = Field(ge=1, le=10000)
    rating: Optional[float] = Field(default=None, ge=0, le=5)
    amenities: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("name", "address")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("vehicle_types")
    @classmethod
    def _dedupe_vehicles(cls, value: List[str]) -> List[str]:
        return list(dict.fromkeys(value))

    @field_validator("amenities")
    @classmethod
    def _clean_amenities(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if any(len(item) > 40 for item in cleaned):
            raise ValueError("each amenity must be 40 characters or fewer")
        return list(dict.fromkeys(cleaned))

    @model_validator(mode="after")
    def _check_ev_fields(self) -> "SpotCreate":
        if self.ev_charging and self.charger_power_kw is None:
            raise ValueError("charger_power_kw is required when ev_charging is true")
        if not self.ev_charging and self.charger_power_kw is not None:
            raise ValueError("charger_power_kw must be null when ev_charging is false")
        return self


class BookingCreate(BaseModel):
    """Body for POST /api/bookings. Timestamps without an offset are treated as IST."""

    spot_id: str = Field(min_length=1, max_length=64)
    customer_name: str = Field(min_length=1, max_length=80)
    start_time: datetime
    end_time: datetime
    vehicle_type: VehicleType
    requires_ev_charging: bool = False

    @field_validator("customer_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def _to_ist(cls, value: datetime) -> datetime:
        return to_local_naive(value)


class CheckInRequest(BaseModel):
    """Body for POST /api/simulator/check-in (contract did not define it; see README notes)."""

    booking_id: str = Field(min_length=1, max_length=64)


# ----------------------------- responses ----------------------------------- #
class SpotOut(BaseModel):
    id: str
    name: str
    address: str
    latitude: float
    longitude: float
    price_per_hour: float
    vehicle_types: List[VehicleType]
    ev_charging: bool
    charger_power_kw: Optional[float] = None
    capacity: int
    available_spaces: int
    status: SpotStatus
    rating: Optional[float] = None
    amenities: List[str]
    distance_km: Optional[float] = None  # only filled when lat/lng were supplied


class BookingOut(BaseModel):
    id: str
    spot_id: str
    spot_name: str
    customer_name: str
    start_time: str
    end_time: str
    duration_minutes: float
    duration_hours: float
    total_price: float
    status: BookingStatus
    vehicle_type: VehicleType
    requires_ev_charging: bool
    created_at: str
    cancelled_at: Optional[str] = None
    checked_in_at: Optional[str] = None


class HealthOut(BaseModel):
    status: str
    service: str
    database: str
    timezone: str
    server_time: str


class CheckInOut(BaseModel):
    simulated: bool = True
    notice: str
    barrier: Literal["open"] = "open"
    booking: BookingOut
    spot: SpotOut


class ResetOut(BaseModel):
    simulated: bool = True
    notice: str
    barrier: Literal["closed"] = "closed"
    bookings_reset: int


class ErrorOut(BaseModel):
    """Shape of every error response (documented for the frontend)."""

    detail: str
    code: str
    errors: Optional[List[dict]] = None
