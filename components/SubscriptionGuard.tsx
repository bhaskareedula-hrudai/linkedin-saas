import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSubscriptionStatus } from '../lib/api';

type SubscriptionGuardProps = {
  children: React.ReactNode;
};

/** Redirects to /pricing if user does not have an active subscription; otherwise renders children. */
export const SubscriptionGuard: React.FC<SubscriptionGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const checkSubscription = async () => {
      const subStatus = await getSubscriptionStatus();
      if (cancelled) return;
      initialCheckDone.current = true;
      const hasSubscription = subStatus.status === 'active' || subStatus.status === 'trialing';
      setAllowed(hasSubscription);
      setLoading(false);
    };

    checkSubscription();
  }, []);

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