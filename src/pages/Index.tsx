import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const Index = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
      </div>
    );
  }

  return <Navigate to={user ? '/dashboard' : '/auth'} replace />;
};

export default Index;
