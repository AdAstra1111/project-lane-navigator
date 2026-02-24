/**
 * QuickReview — thin wrapper around AnalysisPanel (expanded mode).
 * Kept as a route entry for backward compat; all rendering via AnalysisPanel.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ReviewEmptyState, ReviewDocPicker } from '@/components/review/ReviewEmptyState';
import { AnalysisPanel } from '@/components/project/AnalysisPanel';
import { Header } from '@/components/Header';

const QuickReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const effectiveProjectId = projectId || pickedProjectId;

  if (!effectiveProjectId) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="space-y-0">
          <ReviewEmptyState
            reviewType="quick-review"
            onSelectProject={(id) => setPickedProjectId(id)}
            onSelectDoc={(pid) => navigate(`/quick-review?projectId=${pid}`)}
          />
          {pickedProjectId && (
            <div className="max-w-md mx-auto px-6 pb-16">
              <ReviewDocPicker projectId={pickedProjectId} reviewType="quick-review" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <AnalysisPanel projectId={effectiveProjectId} mode="expanded" />
    </div>
  );
};

export default QuickReview;
