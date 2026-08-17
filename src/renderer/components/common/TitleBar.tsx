import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

export function TitleBar() {
  const { t } = useLanguage();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.electronAPI.window.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();
    
    // Check periodically (since maximize events aren't exposed easily)
    const interval = setInterval(checkMaximized, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="titlebar h-10 flex items-center justify-between glass !rounded-none !border-x-0 !border-t-0 select-none">
      <div className="flex items-center gap-3 px-4">
        <div className="w-6 h-6 rounded-md brand-gradient-bg flex items-center justify-center shadow-lg shadow-indigo-500/40">
          <span className="text-white text-xs font-bold">T</span>
        </div>
        <span className="text-sm font-medium text-gradient">{t.window.title}</span>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="w-12 h-10 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface/10 transition-colors"
          title={t.common.minimize}
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => window.electronAPI.window.maximize()}
          className="w-12 h-10 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface/10 transition-colors"
          title={isMaximized ? t.common.restore : t.common.maximize}
        >
          {isMaximized ? (
            <Copy className="w-3.5 h-3.5 transform -rotate-90" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={() => window.electronAPI.window.close()}
          className="w-12 h-10 flex items-center justify-center text-text-tertiary hover:text-white hover:bg-red-500 transition-colors"
          title={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
