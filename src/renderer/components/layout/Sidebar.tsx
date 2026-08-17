import { Users, CheckCircle, BarChart3, Settings, RefreshCw, Sun, Moon, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';

export type Page = 'accounts' | 'checkin' | 'stats' | 'settings';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  accountCount: number;
  onRefreshAll: () => void;
  refreshing: boolean;
  onAddAccount: () => void;
}

export function Sidebar({ currentPage, onNavigate, accountCount, onRefreshAll, refreshing, onAddAccount }: SidebarProps) {
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const NAV_ITEMS = [
    { id: 'accounts' as const, icon: Users, label: t.nav.accounts },
    { id: 'checkin' as const, icon: CheckCircle, label: t.nav.batchCheckin },
    { id: 'stats' as const, icon: BarChart3, label: t.nav.statistics },
    { id: 'settings' as const, icon: Settings, label: t.nav.settings },
  ];

  return (
    <div className="w-60 h-full flex flex-col glass !rounded-none !border-y-0 !border-l-0">
      {/* Logo/Brand */}
      <div className="p-5 border-b border-surface/8">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl brand-gradient-bg flex items-center justify-center shadow-lg shadow-indigo-500/40 animate-float-soft">
            <span className="text-white text-lg font-bold">T</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gradient">{t.app.title}</h1>
            <p className="text-xs text-text-tertiary">{t.app.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'nav-item-active text-indigo-400'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface/5'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full brand-gradient-bg shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
              )}
              <Icon className={cn('w-5 h-5 transition-colors', isActive ? 'text-indigo-400' : 'group-hover:text-indigo-400')} />
              <span>{item.label}</span>
              {item.id === 'accounts' && accountCount > 0 && (
                <span className={cn(
                  'ml-auto text-xs px-2 py-0.5 rounded-full',
                  isActive ? 'bg-indigo-500/15 text-indigo-400' : 'bg-surface/8 text-text-tertiary'
                )}>
                  {accountCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick actions */}
      <div className="p-3 border-t border-surface/8 space-y-2">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface/5 transition-all duration-200"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          {theme === 'light' ? t.nav.darkMode : t.nav.lightMode}
        </button>

        <button
          onClick={onRefreshAll}
          disabled={refreshing}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface/5 transition-all duration-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          {refreshing ? t.nav.refreshing : t.nav.refreshAll}
        </button>

        <button
          onClick={onAddAccount}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t.accounts.addAccount}
        </button>

        {/* Version info */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-text-muted/50">{t.app.version}</p>
        </div>
      </div>
    </div>
  );
}
