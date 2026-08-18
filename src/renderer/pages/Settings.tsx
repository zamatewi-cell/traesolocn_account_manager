import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Download, Upload, Info, Globe, Check, RefreshCw, FolderSearch, Power, Rocket, FileCode2, Sparkles, ExternalLink } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { cn } from '../lib/utils';
import type { Language, AppSettings, UpdateInfo, UpdateProgress } from '../../../shared/types';

export function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const { accounts, exportAccounts, importFromJson } = useAccounts();
  const { showToast } = useToast();
  const [exportAll, setExportAll] = useState(true);
  const [settings, setSettings] = useState<AppSettings>({
    autoCloseTrae: true,
    autoRestartTrae: true,
    traeExePath: '',
  });
  const [detecting, setDetecting] = useState(false);

  // Update-related state
  const [appVersion, setAppVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  // Load settings and app version on mount
  useEffect(() => {
    window.electronAPI.app.getSettings().then(result => {
      if (result.success && result.data) {
        setSettings(result.data);
      }
    });
    window.electronAPI.app.getVersion().then(result => {
      if (result.success && result.data?.version) {
        setAppVersion(`v${result.data.version}`);
      }
    });
  }, []);

  // Subscribe to download progress events from the main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.app.onUpdateDownloadProgress(p => {
      setProgress(p);
    });
    return unsubscribe;
  }, []);

  const saveSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      window.electronAPI.app.setSettings(next);
      return next;
    });
  }, []);

  const handleDetectPath = async () => {
    setDetecting(true);
    try {
      const result = await window.electronAPI.app.detectTraeExe();
      if (result.success && result.data?.exePath) {
        saveSettings({ traeExePath: result.data.exePath });
        showToast(`${t.settings.pathDetected}: ${result.data.exePath}`, 'success');
      } else {
        showToast(t.settings.pathNotFound, 'warning');
      }
    } catch {
      showToast(t.settings.pathNotFound, 'warning');
    } finally {
      setDetecting(false);
    }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateInfo(null);
    setInstallerPath(null);
    setProgress(null);
    try {
      const result = await window.electronAPI.app.checkForUpdate();
      if (result.success && result.data) {
        setUpdateInfo(result.data);
        if (!result.data.updateAvailable) {
          showToast(t.settings.upToDate, 'success');
        }
      } else {
        showToast(result.error || t.settings.updateCheckFailed, 'error');
      }
    } catch {
      showToast(t.settings.updateCheckFailed, 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!updateInfo?.asset) return;
    setDownloading(true);
    setProgress({ received: 0, total: updateInfo.asset.size });
    try {
      const result = await window.electronAPI.app.downloadUpdate(updateInfo.asset.url, updateInfo.asset.name);
      if (result.success && result.data) {
        setInstallerPath(result.data.installerPath);
        showToast(t.settings.updateDownloaded, 'success');
      } else {
        showToast(result.error || t.settings.updateDownloadFailed, 'error');
      }
    } catch {
      showToast(t.settings.updateDownloadFailed, 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!installerPath) return;
    setInstalling(true);
    try {
      const result = await window.electronAPI.app.installUpdate(installerPath);
      if (!result.success) {
        showToast(result.error || t.settings.updateInstallFailed, 'error');
        setInstalling(false);
      }
      // On success the main process quits this app to run the installer
    } catch {
      showToast(t.settings.updateInstallFailed, 'error');
      setInstalling(false);
    }
  };

  const handleOpenReleasePage = () => {
    if (updateInfo?.releaseUrl) {
      window.electronAPI.app.openReleasePage(updateInfo.releaseUrl);
    }
  };

  const handleExport = async () => {
    await exportAccounts(exportAll ? undefined : accounts.filter(a => a.isActive).map(a => a.id));
  };

  const handleImport = async () => {
    await importFromJson();
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
          <SettingsIcon className="w-7 h-7 text-gray-400" />
          {t.settings.title}
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          {t.settings.subtitle}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-6">
        {/* Language section */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400" />
            {t.settings.language}
          </h3>
          <p className="text-sm text-text-tertiary mb-4">{t.settings.languageDescription}</p>
          
          <div className="flex gap-3">
            <button
              onClick={() => handleLanguageChange('en')}
              className={cn(
                'flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-between',
                language === 'en'
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-surface/10 hover:border-surface/20 bg-surface/[0.02]'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🇺🇸</span>
                <span className="font-medium text-text-primary">{t.settings.english}</span>
              </div>
              {language === 'en' && <Check className="w-5 h-5 text-indigo-400" />}
            </button>
            
            <button
              onClick={() => handleLanguageChange('zh')}
              className={cn(
                'flex-1 p-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-between',
                language === 'zh'
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-surface/10 hover:border-surface/20 bg-surface/[0.02]'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🇨🇳</span>
                <span className="font-medium text-text-primary">{t.settings.chinese}</span>
              </div>
              {language === 'zh' && <Check className="w-5 h-5 text-indigo-400" />}
            </button>
          </div>
        </div>

        {/* Account switching settings */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Power className="w-5 h-5 text-purple-400" />
            {t.settings.switchSettings}
          </h3>

          <div className="space-y-4">
            {/* Auto-close Trae */}
            <div className="flex items-start justify-between p-4 rounded-xl bg-surface/[0.03]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                  <Power className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">{t.settings.autoCloseTrae}</p>
                  <p className="text-sm text-text-tertiary mt-0.5">{t.settings.autoCloseTraeDescription}</p>
                </div>
              </div>
              <button
                onClick={() => saveSettings({ autoCloseTrae: !settings.autoCloseTrae })}
                className={cn(
                  'relative w-12 h-6.5 rounded-full transition-colors duration-200 shrink-0',
                  settings.autoCloseTrae ? 'bg-indigo-500' : 'bg-surface/10'
                )}
                style={{ height: '26px' }}
                role="switch"
                aria-checked={settings.autoCloseTrae}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200',
                    settings.autoCloseTrae ? 'left-6.5' : 'left-0.5'
                  )}
                  style={settings.autoCloseTrae ? { left: '26px' } : { left: '2px' }}
                />
              </button>
            </div>

            {/* Auto-restart Trae */}
            <div className="flex items-start justify-between p-4 rounded-xl bg-surface/[0.03]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Rocket className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">{t.settings.autoRestartTrae}</p>
                  <p className="text-sm text-text-tertiary mt-0.5">{t.settings.autoRestartTraeDescription}</p>
                </div>
              </div>
              <button
                onClick={() => saveSettings({ autoRestartTrae: !settings.autoRestartTrae })}
                className={cn(
                  'relative w-12 rounded-full transition-colors duration-200 shrink-0',
                  settings.autoRestartTrae ? 'bg-indigo-500' : 'bg-surface/10'
                )}
                style={{ height: '26px' }}
                role="switch"
                aria-checked={settings.autoRestartTrae}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200',
                    settings.autoRestartTrae ? 'left-6.5' : 'left-0.5'
                  )}
                  style={settings.autoRestartTrae ? { left: '26px' } : { left: '2px' }}
                />
              </button>
            </div>

            {/* Trae executable path */}
            <div className="p-4 rounded-xl bg-surface/[0.03]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center shrink-0">
                  <FileCode2 className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary">{t.settings.traeExePath}</p>
                  <p className="text-sm text-text-tertiary mt-0.5 mb-3">{t.settings.traeExePathDescription}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.traeExePath}
                      onChange={(e) => saveSettings({ traeExePath: e.target.value })}
                      placeholder={t.settings.pathPlaceholder}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface/5 border border-surface/10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40 font-mono"
                    />
                    <button
                      onClick={handleDetectPath}
                      disabled={detecting}
                      className="btn btn-secondary flex items-center gap-2 shrink-0"
                    >
                      {detecting ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderSearch className="w-4 h-4" />
                      )}
                      {t.settings.detectPath}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Data management section */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">{t.settings.dataManagement}</h3>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-surface/[0.03]">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Download className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">{t.settings.exportAccounts}</p>
                  <p className="text-sm text-text-tertiary">{t.settings.exportDescription}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportAll}
                    onChange={(e) => setExportAll(e.target.checked)}
                    className="rounded border-surface/20 bg-surface/5 text-indigo-500 focus:ring-indigo-500/50"
                  />
                  {t.settings.allAccounts}
                </label>
                <button onClick={handleExport} className="btn btn-secondary flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  {t.common.export}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-surface/[0.03]">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">{t.settings.importAccounts}</p>
                  <p className="text-sm text-text-tertiary">{t.settings.importDescription}</p>
                </div>
              </div>
              <button onClick={handleImport} className="btn btn-secondary flex items-center gap-2">
                <Upload className="w-4 h-4" />
                {t.common.import}
              </button>
            </div>
          </div>
        </div>

        {/* About section */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-text-tertiary" />
            {t.settings.about}
          </h3>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-text-secondary">{t.settings.version}</span>
              <div className="flex items-center gap-3">
                <span className="text-text-primary font-medium">{appVersion}</span>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checking || downloading}
                  className="btn btn-secondary flex items-center gap-2 !py-1.5 !px-3 !text-xs"
                >
                  {checking ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {checking ? t.settings.checkingUpdate : t.settings.checkUpdate}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-text-secondary">{t.settings.accountsStored}</span>
              <span className="text-text-primary font-medium">{accounts.length}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-text-secondary">{t.settings.dataLocation}</span>
              <span className="text-text-tertiary text-sm font-mono">%APPDATA%/Trae Account Manager</span>
            </div>
          </div>

          {/* Update panel (visible after a check finds a newer version) */}
          {updateInfo?.updateAvailable && (
            <div className="mt-4 p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <p className="text-sm font-medium text-cyan-400">
                  {t.settings.newVersionAvailable(updateInfo.latestVersion)}
                </p>
                <button
                  onClick={handleOpenReleasePage}
                  className="ml-auto flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.settings.viewReleasePage}
                </button>
              </div>

              {updateInfo.releaseNotes && (
                <div className="mb-3">
                  <p className="text-xs text-text-tertiary mb-1">{t.settings.releaseNotes}</p>
                  <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto font-sans bg-surface/5 rounded-lg p-2 border border-surface/10">
                    {updateInfo.releaseNotes}
                  </pre>
                </div>
              )}

              {downloading ? (
                <div>
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 animate-pulse" />
                      {t.settings.downloadingUpdate}
                    </span>
                    <span className="font-mono">
                      {progress && progress.total > 0
                        ? `${Math.round((progress.received / progress.total) * 100)}% · ${(progress.received / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`
                        : `${((progress?.received ?? 0) / 1048576).toFixed(1)} MB`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface/10 rounded-full overflow-hidden">
                    <div
                      className="h-full brand-gradient-bg rounded-full transition-all duration-300"
                      style={{ width: progress && progress.total > 0 ? `${Math.min(100, (progress.received / progress.total) * 100)}%` : '100%' }}
                    />
                  </div>
                </div>
              ) : installerPath ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-green-400 flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    {t.settings.updateDownloaded}
                  </span>
                  <button
                    onClick={handleInstallUpdate}
                    disabled={installing}
                    className="btn btn-primary flex items-center gap-2 !py-1.5 !px-4 !text-xs"
                  >
                    {installing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    {t.settings.installNow}
                  </button>
                </div>
              ) : updateInfo.asset ? (
                <button
                  onClick={handleDownloadUpdate}
                  className="btn btn-primary flex items-center gap-2 !py-1.5 !px-4 !text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t.settings.downloadAndInstall}
                </button>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">{t.settings.updateNoInstaller}</span>
                  <button
                    onClick={handleOpenReleasePage}
                    className="btn btn-secondary flex items-center gap-1.5 !py-1.5 !px-3 !text-xs"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t.settings.viewReleasePage}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <p className="text-sm text-text-secondary">
              <strong className="text-indigo-400">{t.settings.securityNote.split(':')[0]}:</strong> {t.settings.securityNote.split(':')[1] || t.settings.securityNote}
            </p>
          </div>
        </div>

        {/* Tips section */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">{t.settings.quickTips}</h3>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <span className="text-indigo-400 mt-0.5">•</span>
              {t.settings.tip1}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-400 mt-0.5">•</span>
              {t.settings.tip2}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-400 mt-0.5">•</span>
              {t.settings.tip3}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-400 mt-0.5">•</span>
              {t.settings.tip4}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
