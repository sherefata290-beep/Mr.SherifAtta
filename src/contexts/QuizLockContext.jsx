import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const QuizLockContext = createContext({
  locked: false,
  quizId: null,
  lockQuiz: () => {},
  unlockQuiz: () => {},
  confirmLeave: () => true,
});

const STORAGE_KEY = 'em_quiz_lock';

function readStoredLock() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.quizId) return parsed;
  } catch {}
  return null;
}

export function QuizLockProvider({ children }) {
  const [lock, setLock] = useState(() => readStoredLock());

  const lockQuiz = useCallback((quizId) => {
    const next = { quizId: String(quizId), lockedAt: Date.now() };
    setLock(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const unlockQuiz = useCallback(() => {
    setLock(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const confirmLeave = useCallback(() => {
    if (!lock?.quizId) return true;
    window.alert('لا يمكنك مغادرة الاختبار قبل تسليم الإجابات.');
    return false;
  }, [lock]);

  // Hard block browser refresh/close while locked
  useEffect(() => {
    if (!lock?.quizId) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'يجب تسليم الإجابات قبل مغادرة الاختبار';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [lock]);

  // Trap browser back button while locked
  useEffect(() => {
    if (!lock?.quizId) return undefined;
    const path = `${window.location.pathname}${window.location.search}`;
    window.history.pushState({ quizLock: true }, '', path);
    const onPopState = () => {
      window.history.pushState({ quizLock: true }, '', path);
      window.alert('لا يمكنك العودة لقائمة الاختبارات قبل تسليم الإجابات.');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [lock]);

  const value = useMemo(
    () => ({
      locked: !!lock?.quizId,
      quizId: lock?.quizId || null,
      lockQuiz,
      unlockQuiz,
      confirmLeave,
    }),
    [lock, lockQuiz, unlockQuiz, confirmLeave]
  );

  return <QuizLockContext.Provider value={value}>{children}</QuizLockContext.Provider>;
}

export function useQuizLock() {
  return useContext(QuizLockContext);
}
