import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./store/auth";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import AgendaPage from "./pages/AgendaPage";
import CheckinPage from "./pages/CheckinPage";
import ImportacaoPage from "./pages/ImportacaoPage";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  return isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />;
}

function DashboardPlaceholder() {
  const usuario = useAuthStore((s) => s.usuario);
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-2">
        Olá, {usuario?.nome?.split(" ")[0]} 👋
      </h1>
      <p className="text-slate-400 text-sm">Dashboard em desenvolvimento.</p>
    </div>
  );
}

function ClientesPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-2">Clientes</h1>
      <p className="text-slate-400 text-sm">Listagem de clientes em desenvolvimento.</p>
    </div>
  );
}

function MapaPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-2">Mapa ao Vivo</h1>
      <p className="text-slate-400 text-sm">Mapa de localização dos vendedores em desenvolvimento.</p>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPlaceholder />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="checkin" element={<CheckinPage />} />
            <Route path="mapa" element={<MapaPlaceholder />} />
            <Route path="clientes" element={<ClientesPlaceholder />} />
            <Route path="importacao" element={<ImportacaoPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#f8fafc",
            border: "1px solid #334155",
            fontSize: "13px",
          },
        }}
      />
    </QueryClientProvider>
  );
}
