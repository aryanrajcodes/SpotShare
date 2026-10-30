import React from 'react'

export default function SmartInsights({
  apiBaseUrl,
  userLocation,
  filters,
  onSelectSpot,
}) {
  return (
    <section className="panel" aria-labelledby="insights-title">
      <div className="panel-head">
        <h2 id="insights-title">Smart Insights (Member 4 Stub)</h2>
        <span className="badge badge-soft">AI Recs</span>
      </div>
      <p className="muted small">
        Explainable recommendations will load here once connected to Member 4's endpoint.
      </p>
    </section>
  )
}

