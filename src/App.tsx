import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { QuizLockProvider } from './contexts/QuizLockContext';
import { handleGoogleRedirect } from './lib/googleAuth';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import QuizLockGuard from './components/QuizLockGuard';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';

// Heavy routes load only when needed — keeps first paint fast
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const Quizzes = lazy(() => import('./pages/Quizzes'));
const TakeQuiz = lazy(() => import('./pages/TakeQuiz'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Progress = lazy(() => import('./pages/Progress'));
const Profile = lazy(() => import('./pages/Profile'));
const Login = lazy(() => import('./pages/Login'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminStudentAttendance = lazy(() => import('./pages/AdminStudentAttendance'));
const ParentTrack = lazy(() => import('./pages/ParentTrack'));

try {
  handleGoogleRedirect();
} catch (err) {
  console.error('Google redirect handler error:', err);
}

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center" style={{ backgroundColor: '#f5f5f4' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-10 h-10 border-4 rounded-full animate-spin"
          style={{ borderColor: '#b45309', borderTopColor: 'transparent' }}
        />
        <p className="text-sm font-medium" style={{ color: '#57534e' }}>جاري التحميل...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <QuizLockProvider>
          <ScrollToTop />
          <QuizLockGuard />
          <Layout>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/courses/:id" element={
                  <ProtectedRoute><CourseDetail /></ProtectedRoute>
                } />
                <Route path="/quizzes" element={<Quizzes />} />
                <Route path="/quizzes/:id" element={
                  <ProtectedRoute><TakeQuiz /></ProtectedRoute>
                } />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/progress" element={
                  <ProtectedRoute><Progress /></ProtectedRoute>
                } />
                <Route path="/profile" element={
                  <ProtectedRoute><Profile /></ProtectedRoute>
                } />
                <Route path="/login" element={<Login />} />
                {/* Public parent tracking via secure QR token — no login */}
                <Route path="/track/:token" element={<ParentTrack />} />
                <Route path="/admin" element={
                  <ProtectedRoute adminOnly><Admin /></ProtectedRoute>
                } />
                <Route path="/admin/attendance/:userId" element={
                  <ProtectedRoute adminOnly><AdminStudentAttendance /></ProtectedRoute>
                } />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </Layout>
        </QuizLockProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
