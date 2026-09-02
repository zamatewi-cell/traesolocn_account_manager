import { useState, useEffect } from 'react';
import { X, LogIn, Key, Monitor, Upload, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import type { LocalAccountView } from '../../../shared/types';

type AddMethod = 'oauth' | 'token' | 'local' | 'import';

interface AddAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAddByOAuth: () => Promise<boolean>;
  onAddByToken: (token: string) => Promise<boolean>;
  onAddFromLocal: (localInfo?: LocalAccountView) => Promise<boolean>;
  onImportFromJson: (password?: string) => Promise<boolean>;
}

export function AddAccountDialog({
  isOpen,
  onClose,
  onAddByOAuth,
  onAddByToken,
  onAddFromLocal,
  onImportFromJson,
}: AddAccountDialogProps) {
  const { t } = useLanguage();
  const [selectedMethod, setSelectedMethod] = useState<AddMethod>('oauth');
  const [tokenInput, setTokenInput] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [localAccounts, setLocalAccounts] = useState<LocalAccountView[]>([]);
  const [selectedLocalAccount, setSelectedLocalAccount] = useState<LocalAccountView | null>(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const METHODS = [
    { id: 'oauth' as const, icon: LogIn, label: t.addAccount.oauthLogin, desc: t.addAccount.loginViaBrowser },
    { id: 'token' as const, icon: Key, label: t.addAccount.tokenImport, desc: t.addAccount.pasteToken },
    { id: 'local' as const, icon: Monitor, label: t.addAccount.localAccount, desc: t.addAccount.importFromTrae },
    { id: 'import' as const, icon: Upload, label: t.addAccount.jsonFile, desc: t.addAccount.importFromJson },
  ];

  // Check local account availability when dialog opens
  useEffect(() => {
    if (isOpen) {
      checkLocalAccounts();
      setTokenInput('');
      setBackupPassword('');
      setSelectedMethod('oauth');
      setSelectedLocalAccount(null);
    }
  }, [isOpen]);

  const checkLocalAccounts = async () => {
    try {
      const result = await window.electronAPI.storage.detectAllLocalAccounts();
      if (result.success && result.data) {
        setLocalAccounts(result.data.filter(a => a.exists));
        if (result.data.length > 0) {
          setSelectedLocalAccount(result.data[0]);
        }
      } else {
        setLocalAccounts([]);
      }
    } catch {
      setLocalAccounts([]);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      let success = false;
      
      switch (selectedMethod) {
        case 'oauth':
          success = await onAddByOAuth();
          break;
        case 'token':
          if (!tokenInput.trim()) {
            showToast(t.toast.tokenRequired, 'warning');
            return;
          }
          success = await onAddByToken(tokenInput.trim());
          break;
        case 'local':
          success = await onAddFromLocal(selectedLocalAccount || undefined);
          break;
        case 'import':
          success = await onImportFromJson(backupPassword || undefined);
          break;
      }

      if (success) {
        onClose();
        setTokenInput('');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg glass rounded-2xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface/8">
          <h2 className="text-lg font-semibold text-text-primary">{t.addAccount.title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Method selector */}
          <div className="grid grid-cols-2 gap-3">
            {METHODS.map((method) => {
              const Icon = method.icon;
              const isSelected = selectedMethod === method.id;
              const isDisabled = method.id === 'local' && localAccounts.length === 0;

              return (
                <button
                  key={method.id}
                  onClick={() => !isDisabled && setSelectedMethod(method.id)}
                  disabled={isDisabled}
                  className={cn(
                    'p-4 rounded-xl text-left transition-all duration-200 border',
                    isSelected
                      ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-indigo-500/40'
                      : isDisabled
                      ? 'bg-surface/[0.02] border-surface/8 opacity-40 cursor-not-allowed'
                      : 'bg-surface/[0.03] border-surface/10 hover:bg-surface/[0.06] hover:border-surface/15'
                  )}
                >
                  <Icon className={cn(
                    'w-5 h-5 mb-2',
                    isSelected ? 'text-indigo-400' : 'text-text-secondary'
                  )} />
                  <p className={cn(
                    'text-sm font-medium',
                    isSelected ? 'text-text-primary' : 'text-text-secondary'
                  )}>
                    {method.label}
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {isDisabled ? t.addAccount.noLocalFoundTip : method.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Method-specific content */}
          <div className="min-h-[120px]">
            {selectedMethod === 'oauth' && (
              <div className="text-center py-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                  <LogIn className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-text-secondary text-sm mb-2">
                  {t.addAccount.oauthInstructions}
                </p>
              </div>
            )}

            {selectedMethod === 'token' && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  {t.addAccount.tokenDescription}
                </label>
                <textarea
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={t.addAccount.tokenPlaceholder}
                  className="input h-28 resize-none font-mono text-xs"
                />
                <p className="text-xs text-text-tertiary">
                  {t.addAccount.tokenHint}
                </p>
              </div>
            )}

            {selectedMethod === 'local' && (
              <div className="py-4">
                {localAccounts.length > 0 ? (
                  <div className="space-y-3">
                    <div className="w-16 h-16 mx-auto mb-2 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                      <Monitor className="w-8 h-8 text-green-400" />
                    </div>
                    <p className="text-text-secondary text-sm text-center mb-3">
                      {localAccounts.length === 1 
                        ? t.addAccount.foundLocalAccount(localAccounts[0].nickname || localAccounts[0].email || t.common.unknown)
                        : `${t.addAccount.foundLocalAccount('').replace('：', '')} ${localAccounts.length} 个账号`
                      }
                    </p>
                    {localAccounts.length > 1 && (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {localAccounts.map((acc, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedLocalAccount(acc)}
                            className={cn(
                              'w-full p-3 rounded-lg text-left transition-all border flex items-center gap-3',
                              selectedLocalAccount === acc
                                ? 'bg-green-500/10 border-green-500/30'
                                : 'bg-surface/[0.03] border-surface/10 hover:bg-surface/[0.06]'
                            )}
                          >
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                              {(acc.nickname || acc.email || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-text-primary truncate">
                                {acc.nickname || acc.email || t.common.unknown}
                              </p>
                              {acc.installName && (
                                <p className="text-xs text-text-tertiary">{acc.installName}</p>
                              )}
                            </div>
                            {selectedLocalAccount === acc && (
                              <Check className="w-4 h-4 text-green-400" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface/5 flex items-center justify-center">
                      <Monitor className="w-8 h-8 text-text-tertiary" />
                    </div>
                    <p className="text-text-secondary text-sm mb-1">{t.addAccount.noLocalAccount}</p>
                    <p className="text-text-tertiary text-xs">
                      {t.addAccount.localLoginFirst}
                    </p>
                  </div>
                )}
              </div>
            )}

            {selectedMethod === 'import' && (
              <div className="text-center py-6 space-y-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                  <Upload className="w-8 h-8 text-blue-400" />
                </div>
                <p className="text-text-secondary text-sm mb-1">
                  {t.addAccount.jsonDescription}
                </p>
                <p className="text-text-tertiary text-xs">
                  {t.addAccount.jsonHint}
                </p>
                <div className="text-left">
                  <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="import-backup-password">
                    {t.settings.backupPassword}
                  </label>
                  <input
                    id="import-backup-password"
                    type="password"
                    value={backupPassword}
                    onChange={(event) => setBackupPassword(event.target.value)}
                    placeholder={t.settings.backupPasswordPlaceholder}
                    autoComplete="current-password"
                    className="input w-full"
                  />
                  <p className="text-xs text-text-muted mt-2">{t.settings.backupPasswordHint}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-surface/8">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={loading}
          >
            {t.common.cancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (selectedMethod === 'local' && localAccounts.length === 0)}
            className="btn btn-primary min-w-[100px] flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t.common.processing}
              </>
            ) : (
              <>
                {selectedMethod === 'oauth' && <LogIn className="w-4 h-4" />}
                {selectedMethod === 'token' && <Key className="w-4 h-4" />}
                {selectedMethod === 'local' && <Monitor className="w-4 h-4" />}
                {selectedMethod === 'import' && <Upload className="w-4 h-4" />}
                {selectedMethod === 'oauth' ? t.addAccount.login : 
                 selectedMethod === 'token' ? t.addAccount.addToken :
                 selectedMethod === 'local' ? t.addAccount.importLocal : t.addAccount.selectFile}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
