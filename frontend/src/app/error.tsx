'use client';

import { useEffect } from 'react';
import { RefreshCw, AlertTriangle, Home } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('DocMind Uncaught Application Error:', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#000000',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        backgroundColor: '#111111',
        border: '1px solid #222222',
        borderRadius: '16px',
        padding: '36px',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '12px',
          backgroundColor: '#1a1111',
          border: '1px solid #331515',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px auto',
        }}>
          <AlertTriangle size={28} color="#ff4444" />
        </div>
        
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '10px' }}>
          Application Encountered an Error
        </h2>
        
        <p style={{ fontSize: '14px', color: '#888888', marginBottom: '24px', lineHeight: 1.6 }}>
          {error.message || 'An unexpected client-side error occurred. Your sessions and data remain safe on the server.'}
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => reset()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#ffffff',
              color: '#000000',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            <span>Try Again</span>
          </button>
          
          <button
            onClick={() => window.location.href = '/'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#1c1c1c',
              color: '#ffffff',
              border: '1px solid #333333',
              borderRadius: '8px',
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Home size={14} />
            <span>Reload App</span>
          </button>
        </div>
      </div>
    </div>
  );
}
