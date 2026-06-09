import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getUserAuthRole, ensureProfileRow } from '../lib/api';

type UserGuardProps = { children: React.ReactNode };

export const UserGuard: React.FC<UserGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'authorized'>('loading');
  const processedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const processSession = async (s: Session) => {
      if (processedRef.current || cancelled) return;
      processedRef.current = true;
      const authRole = await getUserAuthRole(s.user.id);
      if (cancelled) return;
      if (authRole === 'admin') { navigate('/admin/dashboard', { replace: true }); return; }
      try { await ensureProfileRow(s.user.id, s.user.email ?? null); }
      catch (err) { console.warn('[UserGuard] ensureProfileRow failed (non-fatal):', err); }
      if (cancelled) return;
      setSession(s);
      setStatus('authorized');
    };

    // Must register BEFORE getSession() so INITIAL_SESSION is never missed.
    // INITIAL_SESSION fires only after Supabase finishes reading from localStorage —
    // the reliable check after a fresh page load (e.g. post-OAuth redirect).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (cancelled) return;
      if (event === 'INITIAL_SESSION') {
        if (newSession?.user) { await processSession(newSession); }
        else if (!processedRef.current) { processedRef.current = true; setSession(null); }
        return;
      }
      if (!processedRef.current) return;
      if (event === 'SIGNED_OUT') setSession(null);
      else if (newSession?.user) setSession(newSession);
    });

    // Fast path for when the session is already in localStorage.
    void supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (cancelled || processedRef.current) return;
      if (s?.user) await processSession(s);
      // If null, don't redirect yet — wait for INITIAL_SESSION to confirm.
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    if (session === null) navigate('/auth', { replace: true });
  }, [session, navigate]);

  if (status === 'loading') return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-2">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      <div className="text-gray-600 text-sm">Loading...</div>
    </div>
  );

  return <React.Fragment key={session?.user.id}>{children}</React.Fragment>;
};