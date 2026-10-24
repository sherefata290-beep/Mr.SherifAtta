export const GRADE_OPTIONS = [
  { value: 'primary_3', label: 'الثالث الابتدائي' },
  { value: 'primary_4', label: 'الرابع الابتدائي' },
  { value: 'primary_5', label: 'الخامس الابتدائي' },
  { value: 'primary_6', label: 'السادس الابتدائي' },
  { value: 'prep_1', label: 'الأول الإعدادي' },
  { value: 'prep_2', label: 'الثاني الإعدادي' },
  { value: 'prep_3', label: 'الثالث الإعدادي' },
];

export function gradeLabel(value) {
  if (!value) return '—';
  return GRADE_OPTIONS.find((g) => g.value === value)?.label || value;
}
