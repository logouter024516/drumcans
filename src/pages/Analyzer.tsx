import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewPdf } from '../gemini';
import { supabase } from '../lib/supabase';

interface AnalysisResult {
  title?: string;
  author?: string;
  score?: string;
  scoreUsage?: string;
  aiScore?: string;
  aiReason?: string;
  summary?: string;
  [key: string]: unknown;
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeStaScore = (raw?: string) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fractionMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (!Number.isNaN(numerator) && denominator > 0) {
      const scaled = (numerator / denominator) * 500;
      return Math.round(clampNumber(scaled, 0, 500));
    }
  }

  const numberMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (numberMatch) {
    const value = Number(numberMatch[1]);
    if (!Number.isNaN(value)) {
      if (value <= 1) {
        return Math.round(clampNumber(value * 500, 0, 500));
      }
      return Math.round(clampNumber(value, 0, 500));
    }
  }

  return null;
};

const normalizePercent = (raw?: string) => {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const parts = cleaned.split(' ');
  for (const part of parts) {
    if (!part) continue;
    const numeric = Number(part);
    if (!Number.isNaN(numeric)) {
      if (numeric <= 1 && raw.includes('/')) {
        const secondMatch = raw.match(/\/(\d+(?:\.\d+)?)/);
        if (secondMatch) {
          const denominator = Number(secondMatch[1]);
          if (denominator > 0) {
            return Math.min(Math.max((numeric / denominator) * 100, 0), 100);
          }
        }
      }
      return Math.min(Math.max(numeric, 0), 100);
    }
  }
  return null;
};

const extractAuthors = (raw?: string) => {
  if (!raw) return [] as string[];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0);
    }
  } catch {
    // continue with string parsing heuristics
  }

  const normalized = raw
    .replace(/\band\b/gi, ',')
    .replace(/[;&]/g, ',');

  return normalized
    .split(/,|\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const FLASH_COST = 50;
const PRO_COST = 100;
const monthlyCreditLimitRaw = Number(import.meta.env.VITE_MONTHLY_CREDIT ?? '0');
const monthlyCreditLimit = Number.isFinite(monthlyCreditLimitRaw) && monthlyCreditLimitRaw > 0 ? monthlyCreditLimitRaw : 0;
type CreditState = {
  balance: number;
  period: string;
  loading: boolean;
};

const getCurrentPeriod = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

const MODEL_OPTIONS: Array<{ value: string; label: string; helper: string; cost: number; }> = [
  {
    value: 'gemini-2.5-flash-lite',
    label: 'Superfast',
    helper: 'No credits required',
    cost: 0,
  },
  {
    value: 'gemini-2.5-flash',
    label: 'Fash',
    helper: `Consumes ${FLASH_COST} credits per analysis`,
    cost: FLASH_COST,
  },
  {
    value: 'gemini-2.5-pro',
    label: 'Pro',
    helper: `Consumes ${PRO_COST} credits per analysis`,
    cost: PRO_COST,
  },
];

export function Analyzer() {
  const initialPeriod = getCurrentPeriod();
  const [modelName, setModelName] = useState('gemini-2.5-flash');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState('');
  const [parsedResult, setParsedResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(initialPeriod);
  const [creditState, setCreditState] = useState<CreditState>({
    balance: monthlyCreditLimit,
    period: initialPeriod,
    loading: true,
  });
  const [userId, setUserId] = useState<string | null>(null);
  const authorList = parsedResult ? extractAuthors(parsedResult.author) : [];
  const staScoreValue = parsedResult ? normalizeStaScore(parsedResult.score) : null;
  const aiScoreValue = parsedResult ? normalizePercent(parsedResult.aiScore) : null;
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedModel = MODEL_OPTIONS.find((option) => option.value === modelName);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setUserId(session?.user?.id ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const intervalId = window.setInterval(() => {
      setPeriod(getCurrentPeriod());
    }, 60 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isOptionDisabled = useCallback((optionValue: string) => {
    const option = MODEL_OPTIONS.find((item) => item.value === optionValue);
    if (!option) return true;
    if (option.cost === 0) return false;
    return (
      monthlyCreditLimit <= 0 ||
      !userId ||
      creditState.loading ||
      creditState.balance < option.cost
    );
  }, [creditState.balance, creditState.loading, userId]);

  const fetchCreditBalance = useCallback(async (targetUserId: string, targetPeriod: string) => {
    if (monthlyCreditLimit <= 0) {
      setCreditState({ balance: 0, period: targetPeriod, loading: false });
      return;
    }

    setCreditState((prev) => ({ ...prev, loading: true }));
    const { data, error } = await supabase
      .from('user_credits')
      .select('balance')
      .eq('user_id', targetUserId)
      .eq('period', targetPeriod)
      .limit(1);

    if (error) {
      console.error('Failed to load user credits:', error);
      setError('크레딧 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      setCreditState({ balance: 0, period: targetPeriod, loading: false });
      return;
    }

    const record = data?.[0];
    if (!record) {
      const { data: inserted, error: insertError } = await supabase
        .from('user_credits')
        .insert({ user_id: targetUserId, period: targetPeriod, balance: monthlyCreditLimit })
        .select('balance')
        .single();

      if (insertError) {
        console.error('Failed to initialize user credits:', insertError);
        setError('크레딧 정보를 초기화하지 못했습니다.');
        setCreditState({ balance: monthlyCreditLimit, period: targetPeriod, loading: false });
        return;
      }

      setCreditState({ balance: inserted?.balance ?? monthlyCreditLimit, period: targetPeriod, loading: false });
      return;
    }

    setCreditState({ balance: record.balance ?? monthlyCreditLimit, period: targetPeriod, loading: false });
  }, []);

  useEffect(() => {
    if (!userId) {
      setCreditState({ balance: 0, period, loading: false });
      return;
    }
    fetchCreditBalance(userId, period);
  }, [userId, period, fetchCreditBalance]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setReview('');
      setParsedResult(null);
      setError('');
    }
  };

  const saveResult = async (resultJson: AnalysisResult) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const normalizedStaScore = normalizeStaScore(resultJson.score);
    const normalizedAiScore = normalizePercent(resultJson.aiScore);

    try {
      await supabase.from('analyses').insert({
        user_id: user.id,
        title: resultJson.title || file?.name || 'Untitled',
        summary: resultJson.summary,
        score: normalizedStaScore !== null ? `${normalizedStaScore}` : resultJson.score,
        ai_score: normalizedAiScore ?? resultJson.aiScore,
        full_result: resultJson
      });
    } catch (err) {
      console.error('Failed to save history:', err);
    }
  };

  const handleReview = async () => {
    if (!file) {
      setError('Please select a PDF file.');
      return;
    }

    const selectedModel = MODEL_OPTIONS.find((option) => option.value === modelName);
    if (!selectedModel) {
      setError('Unsupported model selection.');
      return;
    }

    const { cost } = selectedModel;

    if (cost > 0) {
      if (monthlyCreditLimit <= 0) {
        setError('Paid models are not configured.');
        return;
      }
      if (!userId) {
        setError('유료 모델을 사용하려면 로그인해주세요.');
        return;
      }
      if (creditState.loading) {
        setError('크레딧 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      const activePeriod = getCurrentPeriod();
      if (period !== activePeriod) {
        setPeriod(activePeriod);
        setError('새로운 월별 한도가 적용되어 크레딧을 새로 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (creditState.balance < cost) {
        setError('남은 크레딧이 부족합니다.');
        return;
      }
    }

    setLoading(true);
    setError('');
    setReview('');
    setParsedResult(null);

    try {
      const resultText = await reviewPdf(file, modelName);
      setReview(resultText);

      try {
        const jsonStr = resultText.replace(/```json\n?|\n?```/g, '').trim();
        const resultJson = JSON.parse(jsonStr) as AnalysisResult;
        await saveResult(resultJson);
        setParsedResult(resultJson);
      } catch (parseError) {
        console.warn('Could not parse JSON result for saving history', parseError);
      }

      if (cost > 0 && userId) {
        const updatedBalance = Math.max(creditState.balance - cost, 0);
        setCreditState({ balance: updatedBalance, period, loading: false });

        const { error: updateError } = await supabase
          .from('user_credits')
          .update({ balance: updatedBalance })
          .eq('user_id', userId)
          .eq('period', period);

        if (updateError) {
          console.error('Failed to update user credits:', updateError);
          fetchCreditBalance(userId, period);
        }
      }

    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        setError(err.message || 'An error occurred during the review.');
      } else {
        setError('An unexpected error occurred during the review.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>📄 PDF Paper Reviewer</h1>
      <p className="subtitle">Powered by Gemini 2.5 family · STA Score 500점 체계</p>

      <div className="card">
        <div className="input-group">
          <label htmlFor="modelName">Select Model:</label>
          <div className="model-select" ref={dropdownRef}>
            <button
              type="button"
              id="modelName"
              className="model-select__trigger"
              onClick={() => setModelMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
            >
              <span className="model-select__label">{selectedModel?.label ?? 'Select Model'}</span>
              <span className="model-select__chevron" aria-hidden>v</span>
            </button>
            {modelMenuOpen && (
              <div className="model-select__dropdown" role="listbox">
                {MODEL_OPTIONS.map((option) => {
                  const disabled = isOptionDisabled(option.value);
                  const active = option.value === modelName;
                  return (
                    <button
                      key={option.value}
                      className={`model-select__option${active ? ' selected' : ''}`}
                      type="button"
                      disabled={disabled}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        if (disabled) return;
                        setModelName(option.value);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {option.cost > 0 && <small>{option.cost} credits</small>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <small>{selectedModel?.helper}</small>
        </div>

        <div className="credits-panel">
          <div className="credit-item">
            <span>Paid Model Credits</span>
            <strong>
              {monthlyCreditLimit <= 0
                ? 'Not configured'
                : !userId
                  ? '로그인 필요'
                  : creditState.loading
                    ? 'Loading...'
                    : `${creditState.balance}/${monthlyCreditLimit}`}
            </strong>
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="file">Upload PDF Paper:</label>
          <input
            type="file"
            id="file"
            accept="application/pdf"
            onChange={handleFileChange}
          />
        </div>

        <button onClick={handleReview} disabled={loading || !file}>
          {loading ? 'Reviewing...' : 'Review Paper'}
        </button>

        {error && <div className="error">{error}</div>}
      </div>

      {review && (
        <div className="result">
          <h2>Review Result</h2>
          {parsedResult ? (
            <>
              <div className="result-horizontal">
                <div className="result-card">
                  <h3>논문 정보</h3>
                  <p><span className="result-label">제목</span>{parsedResult.title || '제공되지 않음'}</p>
                  <div>
                    <span className="result-label">저자</span>
                    {authorList.length > 0 ? (
                      <ul className="author-list">
                        {authorList.map((author, index) => (
                          <li key={`${author}-${index}`}>{author}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">제공되지 않음</p>
                    )}
                  </div>
                </div>
                <div className="result-card">
                  <h3>STA Score (0~500)</h3>
                  <p>
                    <span className="result-label">점수</span>
                    {staScoreValue !== null ? `${staScoreValue} / 500` : (parsedResult.score ?? '알 수 없음')}
                  </p>
                  <p><span className="result-label">평가기준</span>{parsedResult.scoreUsage ?? 'STA Score (0~500)'}</p>
                </div>
                <div className="result-card">
                  <h3>AI 의심도</h3>
                  <p>
                    <span className="result-label">의심 점수</span>
                    {aiScoreValue !== null ? `${aiScoreValue}%` : (parsedResult.aiScore ?? '알 수 없음')}
                  </p>
                  <p><span className="result-label">근거</span>{parsedResult.aiReason ?? '제공되지 않음'}</p>
                </div>
              </div>
              <div className="result-summary">
                <h3>요약</h3>
                <p>{parsedResult.summary ?? '요약이 제공되지 않았습니다.'}</p>
              </div>
            </>
          ) : (
            <div className="markdown-body">
              <pre>{review}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
