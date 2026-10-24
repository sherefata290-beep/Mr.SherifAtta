import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuizLock } from '../contexts/QuizLockContext';

/**
 * While a quiz session is active, force the student to stay on that quiz route.
 */
export default function QuizLockGuard() {
  const { locked, quizId } = useQuizLock();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!locked || !quizId) return;
    const allowed = `/quizzes/${quizId}`;
    const current = location.pathname.replace(/\/$/, '') || '/';
    const target = allowed.replace(/\/$/, '');
    if (current !== target) {
      navigate(allowed, { replace: true });
    }
  }, [locked, quizId, location.pathname, navigate]);

  return null;
}
