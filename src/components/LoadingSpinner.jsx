export default function LoadingSpinner({ text = 'جاري التحميل...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div
        className="w-12 h-12 border-4 rounded-full animate-spin"
        style={{ borderColor: '#b45309', borderTopColor: 'transparent' }}
      />
      <p className="font-medium" style={{ color: '#57534e' }}>{text}</p>
    </div>
  );
}
