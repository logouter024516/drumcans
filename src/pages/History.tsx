import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AnalysisRecord {
  id: string;
  created_at: string;
  title: string;
  summary: string;
  score: string;
  ai_score: string;
}

export function History() {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecords(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading history...</div>;

  return (
    <div className="container">
      <h1>Analysis History</h1>
      <div className="history-list">
        {records.length === 0 ? (
          <p>No analysis history found.</p>
        ) : (
          records.map((record) => (
            <div key={record.id} className="card history-item">
              <h3>{record.title || 'Untitled Paper'}</h3>
              <div className="meta">
                <span className="date">{new Date(record.created_at).toLocaleDateString()}</span>
                <span className="score-badge">Score: {record.score}</span>
                <span className="ai-badge">AI: {record.ai_score}</span>
              </div>
              <p className="summary-preview">{record.summary}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
