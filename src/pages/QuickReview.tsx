/**
 * QuickReview — thin wrapper; redirects to project workspace with drawer open
 * when a projectId is known, otherwise shows project picker.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { ReviewEmptyState, ReviewDocPicker } from '@/components/review/ReviewEmptyState';
import { AnalysisPanel } from '@/components/project/AnalysisPanel';
import { Header } from '@/components/Header';

const QuickReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const effectiveProjectId = projectId || pickedProjectId;

  // If we have a project, redirect to workspace with drawer open on Analysis
  if (effectiveProjectId) {
    return <Navigate to={`/projects/${effectiveProjectId}/script?drawer=open&tab=analysis`} replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="space-y-0">
        <ReviewEmptyState
          reviewType="quick-review"
          onSelectProject={(id) => setPickedProjectId(id)}
          onSelectDoc={(pid) => navigate(`/projects/${pid}/script?drawer=open&tab=analysis`)}
        />
        {pickedProjectId && (
          <div className="max-w-md mx-auto px-6 pb-16">
            <ReviewDocPicker projectId={pickedProjectId} reviewType="quick-review" />
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickReview;
