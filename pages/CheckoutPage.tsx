import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, Check, ChevronLeft, Loader2, ShieldCheck, CreditCard } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PLANS } from '../constants';
import { supabase } from '../lib/supabase';

export const CheckoutPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);

  const plan = PLANS.find(p => p.id === planId) || PLANS[1];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({
          id: u.id,
          email: u.email ?? '',
          name: (u.user_metadata?.full_name as string) || u.email || '',
        });
      } else {
        navigate('/auth', { replace: true });
      }
    });
  }, [navigate]);

  const handleCheckout = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, userId: user.id, email: user.email }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {
        throw new Error(`Checkout service unavailable (${res.status}). Please check Stripe environment variables in Vercel and redeploy.`);
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? 'Failed to create checkout session');
      }
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 sm:px-8">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Checkout action */}
        <div className="lg:col-span-2 space-y-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to plans
          </button>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">Complete your subscription</h1>
            <p className="text-gray-500 text-sm mt-1">
              You're subscribing to <span className="font-semibold text-indigo-600">{plan.name}</span> — ${plan.price}/month
            </p>
          </div>

          {user && (
            <Card title="Signing in as">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
              </div>
            </Card>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <Button
            size="lg"
            fullWidth
            type="button"
            onClick={handleCheckout}
            disabled={loading || !user}
            className="gap-2 h-14 text-lg"
          >
            {loading
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Redirecting to payment…</>
              : <><CreditCard className="w-5 h-5" /> Subscribe with Stripe</>}
          </Button>

          <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
            <ShieldCheck className="w-4 h-4 text-green-500" />
            Secured by Stripe — your card details never touch our servers
          </div>
        </div>

        {/* Right: Order Summary */}
        <div className="space-y-6">
          <Card title="Order Summary">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-gray-900">{plan.name} Plan</p>
                  <p className="text-sm text-gray-500">Billed monthly · cancel anytime</p>
                </div>
                <span className="font-bold text-gray-900">${plan.price}/mo</span>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-2">
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-green-500 shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4 flex justify-between items-center text-lg font-bold">
                <span>Due today</span>
                <span className="text-indigo-600">${plan.price}</span>
              </div>
            </div>
          </Card>

          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-900 text-sm">
              <Bot className="w-4 h-4" />
              What happens next?
            </div>
            <p className="text-xs text-indigo-700">
              After payment you'll be taken to your dashboard. Upload your resume and our AI agent will start building your professional presence.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};