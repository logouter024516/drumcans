import { useState } from 'react';
import { supabase } from '../lib/supabase';
import logo from '../assets/sta-logo.svg';

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <path fill="#EA4335" d="M12 10.2v3.9h5.6c-.2 1.3-.9 2.4-2 3.1l3.2 2.5c1.8-1.7 2.9-4.1 2.9-6.9 0-.7-.1-1.4-.2-2H12z" />
    <path fill="#34A853" d="M5.4 14.3l-.9.7-2.6 2c2 3.9 6 6.7 10.6 6.7 3.2 0 5.9-1.1 7.8-3l-3.2-2.5c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.1z" />
    <path fill="#4A90E2" d="M21.5 6.4c-1.8-1.9-4.4-3.2-7.5-3.2-4.6 0-8.6 2.8-10.6 6.7l3.7 2.9c.9-2.3 3.1-4 5.8-4 1.4 0 2.7.5 3.7 1.4z" />
    <path fill="#FBBC05" d="M2 6.2l3.7 2.9c.2-.7.5-1.3.9-1.9L2 6.2z" />
  </svg>
);

const KakaoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <ellipse cx="12" cy="12" rx="11" ry="9" fill="#FEE500" stroke="#111" strokeWidth="1" />
    <path d="M8 14l-.4 2.3L10 14h4l2.4 2.3L16 14h1V9H7v5z" fill="#111" />
  </svg>
);

export function Login() {
  const [error, setError] = useState('');

  const handleOAuth = async (provider: 'google' | 'kakao') => {
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '소셜 로그인에 실패했습니다.';
      setError(message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <div className="logo-wrapper">
          <img src={logo} alt="STA Remake" className="login-logo" />
        </div>
        <h1 className="login-heading">Log in</h1>
        <p className="login-subheading">Google 또는 Kakao 계정으로 로그인해주세요.</p>

        <div className="provider-stack">
          <button className="provider-button" onClick={() => handleOAuth('google')}>
            <span className="provider-icon"><GoogleIcon /></span>
            <span>Google 계정으로 로그인</span>
          </button>
          <button className="provider-button" onClick={() => handleOAuth('kakao')}>
            <span className="provider-icon"><KakaoIcon /></span>
            <span>Kakao 계정으로 로그인</span>
          </button>
        </div>

        {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}
      </div>
    </div>
  );
}
