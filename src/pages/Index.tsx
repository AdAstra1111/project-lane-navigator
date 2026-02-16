import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import iffyLogo from '@/assets/iffy-logo-v3.png';

const Index = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img src={iffyLogo} alt="IFFY" className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  return <Navigate to={user ? '/companies' : '/auth'} replace />;
};

export default Index;
