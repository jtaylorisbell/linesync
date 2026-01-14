import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutDashboard,
} from 'lucide-react';
import { IntakePage } from './components/IntakePage';
import { SinkPage } from './components/SinkPage';
import { InventoryPage } from './components/InventoryPage';

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
}

function NavButton({ active, onClick, icon, label }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-white text-blue-600 shadow-sm'
          : 'text-gray-600 hover:bg-gray-200'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('inventory');

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Inventory Demo
                </h1>
                <p className="text-sm text-gray-500">
                  Barcode-based intake & consumption
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center bg-gray-100 rounded-lg p-1">
              <NavButton
                active={currentPage === 'intake'}
                onClick={() => setCurrentPage('intake')}
                icon={<ArrowDownToLine className="h-4 w-4" />}
                label="Intake"
              />
              <NavButton
                active={currentPage === 'inventory'}
                onClick={() => setCurrentPage('inventory')}
                icon={<LayoutDashboard className="h-4 w-4" />}
                label="Inventory"
              />
              <NavButton
                active={currentPage === 'sink'}
                onClick={() => setCurrentPage('sink')}
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                label="Consume"
              />
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto">
          {currentPage === 'intake' && <IntakePage />}
          {currentPage === 'inventory' && <InventoryPage />}
          {currentPage === 'sink' && <SinkPage />}
        </main>
      </div>
    </QueryClientProvider>
  );
}

export default App;
