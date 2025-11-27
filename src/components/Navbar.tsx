import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { FileText, History, LogOut, User as UserIcon } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function Navbar() {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupabaseUser | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="nav-brand">
        <Link to="/" className="nav-logo">
          <FileText className="icon" />
          <span>STA Remake</span>
        </Link>
      </div>
      <div className="nav-links">
        <Link to="/" className="nav-link">Analyzer</Link>
        {user && <Link to="/history" className="nav-link"><History size={18} /> History</Link>}
      </div>
      <div className="nav-auth">
        {user ? (
          <div className="user-menu">
            <span className="user-email">{user.email}</span>
            <button onClick={handleLogout} className="btn-logout">
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <Link to="/login" className="btn-login">
            <UserIcon size={18} /> Login
          </Link>
        )}
      </div>
    </nav>
  );
}
