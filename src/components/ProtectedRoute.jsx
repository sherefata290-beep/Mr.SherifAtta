import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isStaffRole } from '../lib/roles';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, profile, loading } = useAuth();

  // Wait for session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f5f4' }}>
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-12 h-12 border-4 rounded-full animate-spin"
            style={{ borderColor: '#b45309', borderTopColor: 'transparent' }}
          />
          <p className="font-medium" style={{ color: '#57534e' }}>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Critical: profile loads AFTER session. For admin routes we must wait for
  // profile before deciding access — otherwise staff get bounced to home.
  if (adminOnly) {
    if (!profile) {
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f5f4' }}>
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-12 h-12 border-4 rounded-full animate-spin"
              style={{ borderColor: '#b45309', borderTopColor: 'transparent' }}
            />
            <p className="font-medium" style={{ color: '#57534e' }}>جاري التحقق من الصلاحيات...</p>
          </div>
        </div>
      );
    }
    if (!isStaffRole(profile.role)) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
