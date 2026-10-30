# SpotShare 🚗

### Smart Parking Discovery and Booking System

SpotShare is a smart parking application designed to help users discover
parking spaces, compare prices, and book parking conveniently. The
project aims to reduce the time spent searching for parking and make
parking management more efficient.

> **Project status:** Under development. The FastAPI backend and initial
> booking functionality have been implemented. Frontend and other
> integrations are being developed.

## Features

-   Discover and view parking spaces.
-   View parking spot details and prices.
-   Create and cancel parking bookings.
-   Prevent overlapping bookings when parking capacity is full.
-   Filter and sort parking spots.
-   Request parking recommendations.
-   View parking insights and statistics.
-   Simulate parking check-in and reset operations.

Some features depend on frontend and recommendations integration and may
not yet be complete.

## Technology Stack

  Technology                 Purpose
  -------------------------- -----------------------------------
  Python                     Backend programming
  FastAPI                    REST API development
  SQLite                     Local database
  Pydantic                   Request and response validation
  HTML, CSS and JavaScript   Frontend development
  Git and GitHub             Version control and collaboration
  Docker                     Containerization and deployment

## Project Structure

``` text
SpotShare/
├── README.md
├── .gitignore
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── requirements.txt
│   └── spotshare.db       # Created automatically at runtime
└── frontend/
    └── Frontend files
```

The exact frontend folder contents may change as development progresses.

## Setup and Installation

### 1. Clone the repository

``` bash
git clone https://github.com/aryanrajcodes/SpotShare.git
cd SpotShare
```

### 2. Open the backend folder

``` bash
cd backend
```

### 3. Create a Python virtual environment

``` bash
python -m venv venv
```

### 4. Activate the environment (Windows PowerShell)

``` powershell
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, allow scripts for the current terminal
session only:

``` powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run the activation command again.

### 5. Install dependencies

``` bash
python -m pip install -r requirements.txt
```

### 6. Start the backend server

``` bash
python -m uvicorn main:app --reload --port 8000
```

The API will be available at:

-   **API base URL:** http://127.0.0.1:8000
-   **Interactive API documentation:** http://127.0.0.1:8000/docs

Stop the development server with `Ctrl + C`.

## API Endpoints

The backend currently defines these main endpoints:

  Method   Endpoint                       Purpose
  -------- ------------------------------ ----------------------------------
  GET      `/api/health`                  Check backend status
  GET      `/api/spots`                   Retrieve parking spots
  GET      `/api/spots/{spot_id}`         Retrieve one parking spot
  POST     `/api/spots`                   Add a parking spot
  GET      `/api/bookings`                Retrieve bookings
  POST     `/api/bookings`                Create a booking
  DELETE   `/api/bookings/{booking_id}`   Cancel a booking
  GET      `/api/recommendations`         Retrieve parking recommendations
  GET      `/api/insights`                Retrieve parking insights
  POST     `/api/simulator/check-in`      Simulate a parking check-in
  POST     `/api/simulator/reset`         Reset simulator check-in state

For request parameters, required JSON fields, and example responses,
open the Swagger documentation at `http://127.0.0.1:8000/docs` while the
backend is running.

**Note:** The recommendations endpoint depends on the recommendations
module being added and integrated.

## Database

SpotShare currently uses SQLite for local development.

-   The database file is named `spotshare.db`.
-   It is created automatically when the backend initializes the
    database.
-   The database contains `spots` and `bookings` tables.
-   Each developer has a separate local database during development.
-   The local database file should not be committed to GitHub.

## Team Responsibilities

The project is being developed by a five-member team:

  Member     Responsibility
  ---------- --------------------------------------------------
  Member 1   Main application and frontend UI
  Member 2   FastAPI backend, SQLite, models and requirements
  Member 3   Parking map (Leaflet) and geographical utilities
  Member 4   Recommendations engine and SmartInsights
  Member 5   Docker, tests, README and integration

## Development Notes

-   Keep API field names and response formats consistent with the agreed
    integration contract.
-   Do not commit virtual environments, `.env` files, credentials, or
    local database files.
-   Pull the latest changes before starting work.
-   Test changes locally before committing and pushing them.

## Future Improvements

-   Complete the interactive frontend and map integration.
-   Integrate the recommendations engine.
-   Improve real-time parking availability.
-   Expand parking analytics and insights.
-   Containerize and deploy the application.
-   Configure a shared database for multi-user deployment.

------------------------------------------------------------------------

**SpotShare --- Making Parking Smarter and Easier.**
