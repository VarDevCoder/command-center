export default function VioletAvatar({ className = 'w-10 h-10' }) {
  return (
    <span className={`relative block flex-shrink-0 overflow-hidden rounded-full bg-purple-glow/20 ring-1 ring-purple-glow/40 ${className}`}>
      <img
        src="/violet-profile.png"
        alt="Violet"
        className="absolute max-w-none"
        style={{ width: '430%', height: 'auto', left: '-92%', top: '-10%' }}
      />
    </span>
  );
}
