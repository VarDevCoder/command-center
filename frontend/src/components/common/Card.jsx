// Card reutilizable con estilo bridge
export default function Card({ children, className = '', title, action }) {
  return (
    <div className={`bg-bridge-900 border border-bridge-700 rounded-lg ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-bridge-700">
          <h3 className="font-mono text-xs font-semibold text-bridge-300 uppercase tracking-wider">
            {title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
