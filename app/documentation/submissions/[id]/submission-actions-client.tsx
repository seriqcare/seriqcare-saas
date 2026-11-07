'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-context';
import type { SubmissionSummary } from '@/lib/queries/documentation';

interface Props {
  submission: SubmissionSummary;
}

export function SubmissionActions({ submission }: Props) {
  const router = useRouter();
  const { apiFetch, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<'reviewed' | 'approved' | 'rejected'>('approved');
  const [comments, setComments] = useState('');

  const canReview = user?.role === 'coordinator' || user?.role === 'agency_admin' || user?.role === 'super_admin';

  async function submitReview() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/documentation/submissions/${submission.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: reviewStatus, comments: comments || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.detail ?? 'Review failed.');
        return;
      }
      setShowReview(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canReview || !['submitted', 'reviewed'].includes(submission.status)) return null;

  return (
    <>
      <button className="btn" onClick={() => setShowReview(true)}>Review</button>

      {showReview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowReview(false); }}
        >
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 420, boxShadow: '0 8px 40px rgba(0,0,0,.18)' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Review Submission</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Decision</label>
              <select
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 6 }}
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)}
              >
                <option value="approved">Approve</option>
                <option value="reviewed">Mark as Reviewed (no decision)</option>
                <option value="rejected">Reject (return to draft)</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Comments (optional)</label>
              <textarea
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 6, height: 80, resize: 'vertical', boxSizing: 'border-box' }}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Add review notes…"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn secondary" onClick={() => setShowReview(false)}>Cancel</button>
              <button className="btn" onClick={submitReview} disabled={busy}>
                {busy ? 'Saving…' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
