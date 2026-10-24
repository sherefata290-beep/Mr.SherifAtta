import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  methodNotAllowed,
  serverError,
} from './security.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'stats', limit: 90, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      // Public safe stats (no sensitive breakdown)
      const isAdminQuery = req.query.admin === 'true';
      if (isAdminQuery) {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
      }

      const [courses, lessons, quizzes, questions, profiles, results] = await Promise.all([
        supabase.from('courses').select('id', { count: 'exact', head: true }).eq('is_published', true),
        supabase.from('lessons').select('id', { count: 'exact', head: true }),
        supabase.from('quizzes').select('id', { count: 'exact', head: true }).eq('is_published', true),
        isAdminQuery
          ? supabase.from('questions').select('id', { count: 'exact', head: true })
          : Promise.resolve({ count: 0 }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
        isAdminQuery
          ? supabase.from('quiz_results').select('id', { count: 'exact', head: true })
          : Promise.resolve({ count: 0 }),
      ]);

      if (isAdminQuery) {
        const [allCourses, allQuizzes, allProfiles] = await Promise.all([
          supabase.from('courses').select('id', { count: 'exact', head: true }),
          supabase.from('quizzes').select('id', { count: 'exact', head: true }),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        return res.status(200).json({
          courses: allCourses.count || 0,
          lessons: lessons.count || 0,
          quizzes: allQuizzes.count || 0,
          questions: questions.count || 0,
          students: allProfiles.count || 0,
          results: results.count || 0,
        });
      }

      return res.status(200).json({
        courses: courses.count || 0,
        lessons: lessons.count || 0,
        quizzes: quizzes.count || 0,
        questions: 0,
        students: profiles.count || 0,
        results: 0,
      });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'stats');
  }
}
