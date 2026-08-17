import { useState } from 'react';
import { TitleBar } from './components/common/TitleBar';
import { Sidebar, type Page } from './components/layout/Sidebar';
import { AccountListPage } from './pages/AccountList';
import { BatchCheckinPage } from './pages/BatchCheckin';
import { StatsPage } from './pages/Stats';
import { SettingsPage } from './pages/Settings';
import { AddAccountDialog } from './components/common/AddAccountDialog';
import { useAccounts } from './hooks/useAccounts';

function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      <div className="aurora-grid" />
    </div>
  );
}

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('accounts');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const {
    accounts,
    refreshing,
    refreshAll,
    addByToken,
    addByOAuth,
    addFromLocal,
    importFromJson,
  } = useAccounts();

  return (
    <div className="relative h-screen w-screen flex flex-col overflow-hidden bg-bg-primary text-text-primary">
      {/* Animated aurora background */}
      <AuroraBackground />

      {/* Title bar */}
      <div className="relative z-10">
        <TitleBar />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        <Sidebar
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          accountCount={accounts.length}
          onRefreshAll={refreshAll}
          refreshing={refreshing}
          onAddAccount={() => setShowAddDialog(true)}
        />

        {/* Page content */}
        <main className="flex-1 overflow-hidden p-6">
          {currentPage === 'accounts' && <AccountListPage onOpenAddDialog={() => setShowAddDialog(true)} />}
          {currentPage === 'checkin' && <BatchCheckinPage />}
          {currentPage === 'stats' && <StatsPage />}
          {currentPage === 'settings' && <SettingsPage />}
        </main>
      </div>

      <AddAccountDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAddByOAuth={addByOAuth}
        onAddByToken={addByToken}
        onAddFromLocal={addFromLocal}
        onImportFromJson={importFromJson}
      />
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
