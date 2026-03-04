// Input de comando estilo terminal
import { useState } from 'react';
import { Send, Square } from 'lucide-react';

export default function CommandInput({ onSend, onStop, disabled = false, placeholder = 'Enviar comando...' }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      {/* Prefijo terminal */}
      <span className="font-mono text-sm text-cyan-glow select-none">$</span>

      {/* Input */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
          text-sm font-mono text-green-glow placeholder-bridge-600
          focus:outline-none focus:border-cyan-glow/50 focus:ring-1 focus:ring-cyan-glow/20
          disabled:opacity-50 transition-colors"
      />

      {/* Botón enviar */}
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="p-2 rounded-lg bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
          hover:bg-cyan-glow/20 disabled:opacity-30 disabled:cursor-not-allowed
          transition-colors"
      >
        <Send className="w-4 h-4" />
      </button>

      {/* Botón stop */}
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          className="p-2 rounded-lg bg-red-glow/10 text-red-glow border border-red-glow/30
            hover:bg-red-glow/20 transition-colors"
        >
          <Square className="w-4 h-4" />
        </button>
      )}
    </form>
  );
}
