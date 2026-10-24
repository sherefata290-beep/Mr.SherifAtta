import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import supabase from '../lib/supabase';
import { apiFetch } from '../lib/api';

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

function isGoogleOnlyUser(authUser) {
  if (!authUser) return false;
  const provider = authUser.app_metadata?.provider;
  const providers = authUser.app_metadata?.providers;
  if (provider === 'google') return true;
  if (Array.isArray(providers) && providers.length === 1 && providers[0] === 'google') return true;
  const identities = authUser.identities || [];
  if (identities.length === 1 && identities[0]?.provider === 'google') return true;
  return false;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setProfile(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/profiles?id=${encodeURIComponent(authUser.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.id) {
          setProfile(data);
          return;
        }
      }

      // Google users must already have a platform account — never auto-create for them.
      if (isGoogleOnlyUser(authUser)) {
        setProfile(null);
        // Safety net: if gate was skipped, sign them out
        try {
          const gateRes = await fetch('/api/google-gate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}`,
            },
            body: JSON.stringify({}),
          });
          if (!gateRes.ok) {
            await supabase.auth.signOut();
          } else {
            const gateData = await gateRes.json();
            if (gateData?.profile) {
              setProfile(gateData.profile);
              return;
            }
          }
        } catch {
          await supabase.auth.signOut();
        }
        return;
      }

      // Email/password signup: create profile if missing.
      // Grade may come from signup form; access still requires redeeming a code (has_access).
      const createRes = await apiFetch('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({
          id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'طالب',
          parent_phone: authUser.user_metadata?.parent_phone || '',
          grade_level: authUser.user_metadata?.grade_level || '',
        }),
      });
      if (createRes.ok) {
        const created = await createRes.json();
        setProfile(created);
      } else {
        setProfile(null);
      }
    } catch (err) {
      console.error('Profile fetch error:', err);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user);
  }, [user, fetchProfile]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // Fast path: unlock UI as soon as session is known; profile loads in background
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!mounted) return;
        const nextSession = data?.session ?? null;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        // Don't block first paint waiting for profile API
        if (mounted) setLoading(false);
        if (nextSession?.user) {
          fetchProfile(nextSession.user);
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error('Auth init error:', err);
        if (mounted) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        fetchProfile(nextSession.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
