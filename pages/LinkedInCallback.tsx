import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const LinkedInCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let authTimeout: ReturnType<typeof setTimeout> | null = null;
    let authSub: { unsubscribe: () => void } | null = null;

    const handle = async () => {
      const linkedinConnected = searchParams.get('linkedin_connected') === 'true';
      const linkedinError = searchParams.get('linkedin_error');
      const rawReturn = searchParams.get('returnPath') || localStorage.getItem('li_return_path') || '/app/profile-setup';
      const returnPath = rawReturn.startsWith('/') ? rawReturn : '/app/profile-setup';

      // --- Server reported an error ---
      if (linkedinError) {
        const msg = searchParams.get('msg') || linkedinError;
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(decodeURIComponent(msg));
        }
        localStorage.removeItem('li_return_path');
        return;
      }

      // --- Server reported success (token already saved to DB) ---
      if (linkedinConnected) {
        localStorage.removeItem('li_return_path');
        localStorage.removeItem('li_auth_state');

        // Check for an existing session immediately — it's usually already in localStorage.
        const { data: { session } } = await supabase.auth.getSession();
        if (session && !cancelled) {
          navigate(`${returnPath}?linkedin=connected`, { replace: true });
          return;
        }

        // Show success UI while waiting for session.
        if (!cancelled) setStatus('success');

        // Wait up to 5 s for the session to surface via auth state change.
        authTimeout = setTimeout(() => {
          if (!cancelled) {
            navigate('/auth', { replace: true });
          }
        }, 5000);

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
          if (newSession && !cancelled) {
            if (authTimeout) clearTimeout(authTimeout);
            authSub = null;
            subscription.unsubscribe();
            navigate(`${returnPath}?linkedin=connected`, { replace: true });
          }
        });
        authSub = subscription;
        return;
      }

      // --- No recognised params — bad URL ---
      if (!cancelled) {
        setStatus('error');
        setErrorMessage('Invalid callback. Please try connecting LinkedIn again.');
      }
    };

    handle().catch((err) => {
      console.error('[LinkedInCallback]', err);
      if (!cancelled) {
        setStatus('error');
        setErrorMessage('Something went wrong. Please try again.');
      }
    });

    return () => {
      cancelled = true;
      if (authTimeout) clearTimeout(authTimeout);
      if (authSub) authSub.unsubscribe();
    };
  }, [searchParams, navigate]);

  const backPath = (() => {
    const rp = searchParams.get('returnPath') || localStorage.getItem('li_return_path') || '/app/profile-setup';
    return rp.startsWith('/') ? rp : '/app/profile-setup';
  })();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {status === 'processing' && (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Connecting to LinkedIn</h2>
            <p className="text-gray-500">Please wait while we complete the connection…</p>
          </div>
        )}
        {status === 'success' && (
          <div className="space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">LinkedIn Connected!</h2>
            <p className="text-gray-500">Redirecting you back…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Connection Failed</h2>
            <p className="text-red-600 font-medium">{errorMessage}</p>
            <button
              onClick={() => navigate(backPath)}
              className="mt-4 text-indigo-600 font-bold hover:underline"
            >
              Back to Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
};