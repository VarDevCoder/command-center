import VioletAvatar from '../common/VioletAvatar.jsx';

export default function VioletAvatarFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
      <VioletAvatar className="w-24 h-24" />
      <p className="text-[10px] font-mono text-bridge-500">Avatar 3D no disponible</p>
    </div>
  );
}
