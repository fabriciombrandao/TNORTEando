import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./store/auth";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import AgendaPage from "./pages/AgendaPage";
import CheckinPage from "./pages/CheckinPage";
import ImportacaoPage from "./pages/ImportacaoPage";
import ClientesPage from "./pages/ClientesPage";
import ClienteDetalhe from "./pages/ClienteDetalhe";
import LicenciamentoPage from "./pages/LicenciamentoPage";
import ContratosPage from "./pages/ContratosPage";
import ConfiguracoesPage from "./pages/ConfiguracoesPage";
import UsuariosPage from "./pages/UsuariosPage";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn());
  return isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />;
}

function DashboardPlaceholder() {
  const usuario = useAuthStore((s) => s.usuario);
  const papel   = usuario?.papel || "";

  const isESN = papel === "ESN";

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">
          {(() => {
            const partes = (usuario?.nome || "").split(" ").filter(Boolean);
            const nomecompleto = partes.length >= 2 ? `${partes[0]} ${partes[partes.length-1]}` : partes[0] || "";
            const papelLabel: Record<string,string> = {
              ADMIN:"Admin", GESTOR_CONSOLIDADORA:"Gestor Consolidadora",
              GESTOR_EMPRESA:"Gestor", DSN:"DSN", GSN:"GSN", ESN:"ESN"
            };
            const p = papelLabel[usuario?.papel || ""] || usuario?.papel || "";
            const cod = usuario?.codigo_externo ? ` · ${usuario.codigo_externo}` : "";
            return `Olá, ${p}${cod} · ${nomecompleto} 👋`;
          })()}
        </h1>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isESN ? (
          <>
            <div className="kpi col-span-2">
              <div className="kpi-value text-indigo-600">0</div>
              <div className="kpi-label">Visitas hoje</div>
            </div>
            <div className="kpi col-span-2">
              <div className="kpi-value">0</div>
              <div className="kpi-label">Clientes na carteira</div>
            </div>
          </>
        ) : (
          <>
            <div className="kpi">
              <div className="kpi-value text-indigo-600">0</div>
              <div className="kpi-label">Visitas hoje</div>
            </div>
            <div className="kpi">
              <div className="kpi-value text-emerald-600">0</div>
              <div className="kpi-label">Concluídas</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">0</div>
              <div className="kpi-label">Em campo</div>
            </div>
            <div className="kpi">
              <div className="kpi-value text-amber-500">0</div>
              <div className="kpi-label">S/ visita</div>
            </div>
          </>
        )}
      </div>
      <p className="text-center text-slate-400 text-xs mt-10">
        Dashboard com dados reais em breve.
      </p>
    </div>
  );
}

function MapaPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Mapa ao Vivo</h1>
      <div className="card p-10 text-center">
        <p className="text-slate-400 text-sm">Mapa de localização dos vendedores em desenvolvimento.</p>
      </div>
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
            <Route path="agenda"        element={<AgendaPage />} />
            <Route path="checkin"       element={<CheckinPage />} />
            <Route path="mapa"          element={<MapaPlaceholder />} />
            <Route path="clientes"      element={<ClientesPage />} />
            <Route path="clientes/:id" element={<ClienteDetalhe />} />
            <Route path="clientes/:id/licenciamento" element={<LicenciamentoPage />} />
            <Route path="clientes/:id/contratos" element={<ContratosPage />} />
            <Route path="importacao"    element={<ImportacaoPage />} />
            <Route path="usuarios"      element={<UsuariosPage />} />
            <Route path="configuracoes" element={<ConfiguracoesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#fff",
            color: "#0f172a",
            border: "1px solid #e2e8f0",
            fontSize: "13px",
            borderRadius: "12px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
