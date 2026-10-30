import React from 'react'

export default function ParkingMap({
  spots = [],
  selectedSpotId = null,
  onSelectSpot = () => {},
  userLocation = null,
}) {
  return (
    <div
      style={{
        padding: '24px',
        textAlign: 'center',
        background: 'var(--panel)',
        borderRadius: 'var(--radius)',
        minHeight: '340px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      <div style={{ fontSize: '2rem' }}>🗺️</div>
      <strong>Interactive Parking Map (Member 3 Stub)</strong>
      <p className="muted small">
        {spots.length} spaces available on map.
      </p>
      {selectedSpotId && (
        <span className="badge badge-soft">Selected: {selectedSpotId}</span>
      )}
    </div>
  )
}

