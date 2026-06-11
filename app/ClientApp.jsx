'use client';

import React, { useState, useEffect } from 'react';
import SpendTracker from '../src/SpendTracker.jsx';

class RootErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 40, fontFamily: 'monospace', color: '#dc2626', background: '#fff', height: '100vh', overflow: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>React crash: {this.state.err.message}</div>
        <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#555' }}>{this.state.err.stack}</pre>
        <button onClick={() => this.setState({ err: null })} style={{ marginTop: 20, padding: '8px 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

export default function ClientApp() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <RootErrorBoundary>
      <SpendTracker />
    </RootErrorBoundary>
  );
}
