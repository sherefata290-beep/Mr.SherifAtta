import { Trophy, Medal, Crown, Flame, GraduationCap } from 'lucide-react';
import { gradeLabel } from '../lib/grades';

export function Avatar({ name, url, size = 'md', ring }) {
  const sizes = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-12 h-12 text-base',
    lg: 'w-16 h-16 text-xl',
    xl: 'w-20 h-20 text-2xl',
  };
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-black shrink-0 overflow-hidden`}
      style={{
        background: url ? '#e7e5e4' : 'linear-gradient(135deg, #b45309 0%, #292524 100%)',
        color: '#ffffff',
        boxShadow: ring || '0 0 0 3px rgba(180,83,9,0.25)',
      }}
    >
      {url ? (
        <img src={url} alt={name || ''} className="w-full h-full object-cover" />
      ) : (
        (name || 'ط')[0]
      )}
    </div>
  );
}

export function RankBadge({ rank }) {
  if (rank === 1) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shadow-md"
        style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)', color: '#fff' }}
      >
        <Crown className="w-4 h-4" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shadow-md"
        style={{ background: 'linear-gradient(135deg,#d6d3d1,#78716c)', color: '#fff' }}
      >
        <Medal className="w-4 h-4" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shadow-md"
        style={{ background: 'linear-gradient(135deg,#d97706,#78350f)', color: '#fff' }}
      >
        <Medal className="w-4 h-4" />
      </div>
    );
  }
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black"
      style={{ backgroundColor: '#e7e5e4', color: '#57534e' }}
    >
      {rank}
    </div>
  );
}

export function personName(item, nameKey = 'full_name') {
  return (
    item?.[nameKey] ||
    item?.display_name ||
    item?.full_name ||
    item?.user_name ||
    item?.name ||
    'طالب'
  );
}

export function personPoints(item) {
  if (item?.percentage != null && item?.score != null && item?.total_questions != null) {
    return Number(item.percentage) || 0;
  }
  return Number(item?.total_points ?? item?.points ?? item?.percentage ?? 0) || 0;
}

export function isResultItem(item) {
  return item?.percentage != null && (item?.quiz_id != null || item?.score != null);
}

/** Visual podium: 2nd | 1st | 3rd — same look on Home and Leaderboard */
export default function LeaderboardPodium({ items, nameKey = 'full_name', title = 'منصة الأوائل' }) {
  if (!items?.length) return null;

  const slots = [
    { place: 1, item: items[1], height: 120 },
    { place: 0, item: items[0], height: 160 },
    { place: 2, item: items[2], height: 100 },
  ];

  const styles = [
    { bar: 'linear-gradient(180deg,#fbbf24 0%,#b45309 100%)', ring: '0 0 0 4px #fbbf24, 0 8px 24px rgba(180,83,9,0.35)' },
    { bar: 'linear-gradient(180deg,#d6d3d1 0%,#78716c 100%)', ring: '0 0 0 3px #a8a29e, 0 6px 18px rgba(68,64,60,0.25)' },
    { bar: 'linear-gradient(180deg,#d97706 0%,#78350f 100%)', ring: '0 0 0 3px #d97706, 0 6px 18px rgba(120,53,15,0.3)' },
  ];

  return (
    <div
      className="rounded-3xl p-5 sm:p-8 shadow-lg overflow-hidden"
      style={{
        background: 'linear-gradient(180deg,#ffffff 0%,#fffbeb 100%)',
        border: '1px solid #fde68a',
      }}
    >
      <div className="flex items-center justify-center gap-2 mb-6">
        <Trophy className="w-5 h-5" style={{ color: '#b45309' }} />
        <h2 className="font-black text-lg" style={{ color: '#1c1917' }}>{title}</h2>
      </div>

      <div className="flex items-end justify-center gap-2 sm:gap-4 md:gap-6 min-h-[280px]">
        {slots.map(({ place, item, height }) => {
          if (!item) {
            return <div key={`empty-${place}`} className="flex-1 max-w-[170px]" />;
          }
          const name = personName(item, nameKey);
          const pts = personPoints(item);
          const isFirst = place === 0;
          const style = styles[place];
          const resultMode = isResultItem(item);

          return (
            <div
              key={item.id || `${name}-${place}`}
              className={`flex flex-col items-center flex-1 max-w-[170px] ${isFirst ? '-mt-2 sm:-mt-6' : 'mt-2 sm:mt-6'}`}
              style={{ opacity: 1, visibility: 'visible' }}
            >
              <div className="relative mb-3">
                {isFirst && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2">
                    <Crown className="w-8 h-8" style={{ color: '#f59e0b' }} />
                  </div>
                )}
                <Avatar
                  name={name}
                  url={item.avatar_url}
                  size={isFirst ? 'xl' : 'lg'}
                  ring={style.ring}
                />
                <div
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow"
                  style={{ backgroundColor: '#1c1917', color: '#fbbf24' }}
                >
                  {place + 1}
                </div>
              </div>

              <div className="text-center mb-3 px-1 w-full">
                <div
                  className="font-bold text-sm md:text-base truncate mx-auto max-w-full"
                  style={{ color: '#1c1917' }}
                  title={name}
                >
                  {name}
                </div>
                {item.grade_level && (
                  <div className="text-[11px] mt-0.5 font-medium" style={{ color: '#78716c' }}>
                    {gradeLabel(item.grade_level)}
                  </div>
                )}
                {(item.badge || item.note) && (
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: '#78716c' }}>
                    {[item.badge, item.note].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div
                  className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black"
                  style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                >
                  <Flame className="w-3 h-3" />
                  {pts}{resultMode ? '%' : ' نقطة'}
                </div>
              </div>

              <div
                className="w-full rounded-t-2xl flex items-start justify-center pt-3 relative overflow-hidden"
                style={{
                  height,
                  minHeight: height,
                  background: style.bar,
                  boxShadow: '0 8px 24px rgba(28,25,23,0.12)',
                }}
              >
                <span className="text-3xl md:text-4xl font-black" style={{ color: 'rgba(255,255,255,0.95)' }}>
                  {place + 1}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StudentRow({ student, index, nameKey = 'full_name', extra }) {
  const name = personName(student, nameKey);
  const resultMode = isResultItem(student);
  const points = personPoints(student);
  const isTop3 = index < 3;
  const bg =
    index === 0
      ? 'linear-gradient(90deg,#fffbeb 0%,#fef3c7 50%,#fff7ed 100%)'
      : index === 1
        ? 'linear-gradient(90deg,#fafaf9 0%,#f5f5f4 100%)'
        : index === 2
          ? 'linear-gradient(90deg,#fff7ed 0%,#f5f5f4 100%)'
          : '#ffffff';
  const border =
    index === 0 ? '#fcd34d' : index === 1 ? '#d6d3d1' : index === 2 ? '#fbbf24' : '#e7e5e4';

  return (
    <div
      className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-4 rounded-2xl transition-transform hover:-translate-y-0.5 hover:shadow-md"
      style={{
        background: bg,
        border: `1.5px solid ${border}`,
        boxShadow: isTop3 ? '0 4px 20px rgba(28,25,23,0.06)' : 'none',
        opacity: 1,
        visibility: 'visible',
      }}
    >
      <RankBadge rank={index + 1} />
      <Avatar name={name} url={student.avatar_url} size="md" />
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate" style={{ color: '#1c1917' }}>{name}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {student.grade_level && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
              style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
            >
              <GraduationCap className="w-3 h-3" />
              {gradeLabel(student.grade_level)}
            </span>
          )}
          {extra}
          {(student.badge || student.note) && (
            <span className="text-[11px] truncate" style={{ color: '#78716c' }}>
              {[student.badge, student.note].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>
      <div className="text-left shrink-0">
        <div className="text-xl font-black tabular-nums" style={{ color: index === 0 ? '#b45309' : '#1c1917' }}>
          {points}{resultMode ? '%' : ''}
        </div>
        <div className="text-[11px] font-medium" style={{ color: '#78716c' }}>
          {resultMode ? 'نتيجة' : 'نقطة'}
        </div>
      </div>
    </div>
  );
}
