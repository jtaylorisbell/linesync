import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutDashboard,
  Radio,
  User,
} from 'lucide-react';
import { IntakePage } from './components/IntakePage';
import { SinkPage } from './components/SinkPage';
import { InventoryPage } from './components/InventoryPage';
import { api } from './api/client';

type Page = 'intake' | 'inventory' | 'sink';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      retry: 1,
    },
  },
});

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function NavButton({ active, onClick, icon, label, description }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 ${
        active
          ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] glow-cyan'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <span className={`transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
        {icon}
      </span>
      <div className="text-left">
        <span className="font-semibold block">{label}</span>
        <span className={`text-xs ${active ? 'text-[var(--bg-primary)]/70' : 'text-[var(--text-muted)]'}`}>
          {description}
        </span>
      </div>
    </button>
  );
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent-success-dim)] border border-[var(--accent-success)]">
      <div className="relative">
        <Radio className="h-3 w-3 text-[var(--accent-success)]" />
        <div className="absolute inset-0 animate-ping">
          <Radio className="h-3 w-3 text-[var(--accent-success)]" />
        </div>
      </div>
      <span className="text-xs font-medium text-[var(--accent-success)]">LIVE</span>
    </div>
  );
}

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('inventory');

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
    staleTime: Infinity, // User identity doesn't change, cache indefinitely
  });

  const { data: signals } = useQuery({
    queryKey: ['signals'],
    queryFn: () => api.listSignals({ status: 'OPEN' }),
    refetchInterval: 5000,
  });

  const openSignals = signals?.total_open || 0;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] grid-bg">
      {/* Header */}
      <header className="bg-[var(--bg-secondary)]/80 backdrop-blur-xl border-b border-[var(--border-primary)] sticky top-0 z-40">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Logo & Branding */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-[var(--accent-primary)] blur-xl opacity-50" />
                <div className="relative p-3 bg-gradient-to-br from-[var(--accent-primary)] to-cyan-600 rounded-xl">
                  <Zap className="h-7 w-7 text-[var(--bg-primary)]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                  Line<span className="text-[var(--accent-primary)]">Sync</span>
                </h1>
                <p className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                  Real-time Inventory Intelligence powered by
                  <svg className="h-5 w-5 inline-block" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Databricks stacked layers logo */}
                    {/* Top filled parallelogram */}
                    <path d="M24 4L44 14L24 24L4 14Z" fill="#FF3621"/>
                    <path d="M24 4L44 14L24 24L4 14Z" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round" fill="none"/>
                    {/* Second layer - outline only */}
                    <path d="M4 20L24 30L44 20" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round" fill="none"/>
                    <path d="M24 30L4 20" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round"/>
                    <path d="M24 30L44 20" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round"/>
                    {/* Third layer */}
                    <path d="M4 28L24 38L44 28" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round" fill="none"/>
                    {/* Fourth layer */}
                    <path d="M4 36L24 46L44 36" stroke="#FF3621" strokeWidth="3" strokeLinejoin="round" fill="none"/>
                  </svg>
                  <span className="text-[var(--text-secondary)] font-medium">Databricks</span>
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-2 p-1.5 bg-[var(--bg-elevated)] rounded-2xl border border-[var(--border-primary)]">
              <NavButton
                active={currentPage === 'intake'}
                onClick={() => setCurrentPage('intake')}
                icon={<ArrowDownToLine className="h-5 w-5" />}
                label="Receive"
                description="Scan incoming parts"
              />
              <NavButton
                active={currentPage === 'inventory'}
                onClick={() => setCurrentPage('inventory')}
                icon={<LayoutDashboard className="h-5 w-5" />}
                label="Dashboard"
                description="View all inventory"
              />
              <NavButton
                active={currentPage === 'sink'}
                onClick={() => setCurrentPage('sink')}
                icon={<ArrowUpFromLine className="h-5 w-5" />}
                label="Consume"
                description="Use parts on line"
              />
            </nav>

            {/* Status indicators */}
            <div className="flex items-center gap-4">
              {openSignals > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent-warning-dim)] border border-[var(--accent-warning)] animate-pulse">
                  <span className="text-xs font-bold text-[var(--accent-warning)]">
                    {openSignals} SIGNAL{openSignals > 1 ? 'S' : ''}
                  </span>
                </div>
              )}
              <LiveIndicator />
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-xl">
                <User className="h-4 w-4 text-[var(--accent-primary)]" />
                {userLoading ? (
                  <div className="h-4 w-24 bg-[var(--bg-hover)] rounded animate-pulse" />
                ) : (
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {currentUser?.display_name || 'Guest'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto">
        {currentPage === 'intake' && <IntakePage />}
        {currentPage === 'inventory' && <InventoryPage />}
        {currentPage === 'sink' && <SinkPage />}
      </main>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-[var(--border-primary)]">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-center text-sm text-[var(--text-muted)]">
          <span>LineSync v1.0</span>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
