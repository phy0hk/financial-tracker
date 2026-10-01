import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StorageProvider } from './context/StorageContext';
import { AuthScreen } from './screens/AuthScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AdminScreen } from './screens/AdminScreen';
import { LocalStoragePluginStateStore, PluginManager } from '../../../packages/core/src/plugins/PluginManager';
import { CoreExpenseModule } from '../../../packages/core/src/plugins/modules/CoreExpenseModule';
import { EmergencyDuressModule } from '../../../packages/core/src/plugins/modules/EmergencyDuressModule';
import { OCRScannerModule } from '../../../packages/core/src/plugins/modules/OCRScannerModule';
import { SubscriptionsModule } from '../../../packages/core/src/plugins/modules/SubscriptionsModule';

const pluginManager = new PluginManager(new LocalStoragePluginStateStore());
pluginManager.registerAll([new CoreExpenseModule(), new EmergencyDuressModule(), new OCRScannerModule(), new SubscriptionsModule()]);

function usePathname(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname || '/auth');
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || '/auth');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (next: string) => { window.history.pushState({}, '', next); setPath(next); };
  return [path, navigate];
}

function Navigation({ navigate }: { navigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const links = useMemo(() => [{ label: 'Dashboard', path: '/dashboard' }, { label: 'Settings', path: '/settings' }, ...(user?.role === 'admin' ? [{ label: 'Admin', path: '/admin' }] : [])], [user?.role]);
  return <nav className="flex items-center gap-3 border-b border-slate-800 bg-slate-950 px-6 py-3 text-sm text-slate-300"><span className="mr-auto font-semibold text-cyan-300">ZeroTracker</span>{links.map((link) => <button key={link.path} onClick={() => navigate(link.path)} className="rounded px-3 py-2 hover:bg-slate-800">{link.label}</button>)}<button onClick={() => void logout()} className="rounded bg-slate-800 px-3 py-2">Sign out</button></nav>;
}

function RoutedApplication() {
  const { user } = useAuth();
  const [path, navigate] = usePathname();
  if (!user) return <AuthScreen />;
  const screen: ReactNode = path === '/settings' ? <SettingsScreen /> : path === '/admin' ? <AdminScreen /> : <DashboardScreen />;
  return <div className="min-h-screen bg-slate-950"><Navigation navigate={navigate} />{screen}</div>;
}

export function App() {
  return <AuthProvider><StorageProvider><RoutedApplication /></StorageProvider></AuthProvider>;
}

export { pluginManager };
export default App;
