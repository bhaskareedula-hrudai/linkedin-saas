import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSubscriptionStatus } from '../lib/api';
import { supabase } from '../lib/supabase';

type SubscriptionGuardProps = {
  children: React.ReactNode;
};

export const SubscriptionGuard: React.FC<SubscriptionGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const checkSubscription = async () => {
      const sessionId = searchParams.get('session_id');
      if (sessionId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const res = await fetch('/api/stripe/verify-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId, userId: user.id }),
            });
            const data = await res.json();
            if (data.status === 'active') {
              if (!cancelled) {
                initialCheckDone.current = true;
                setAllowed(true);
                setLoading(false);
              }
              return;
            }
          }
        } catch (e) {
          console.error('Session verification failed:', e);
        }
      }
      const subStatus = await getSubscriptionStatus();
      if (cancelled) return;
      initialCheckDone.current = true;
      const hasSubscription = subStatus.status === 'active' || subStatus.status === 'trialing';
      setAllowed(hasSubscription);
      setLoading(false);
    };
    checkSubscription();
  }, [searchParams]);

  useEffect(() => {
    if (!loading && !allowed) {
      navigate('/pricing', { replace: true });
    }
  }, [loading, allowed, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <>{children}</>;
};