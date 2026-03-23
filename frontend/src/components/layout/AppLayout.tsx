import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import {
  LayoutDashboard, MapPin, CalendarDays, Users,
  UploadCloud, LogOut, CheckSquare, Settings,
  Menu, X, ChevronRight
} from "lucide-react";
import { useState } from "react";

// ── Itens de navegação ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    to: "/", label: "Dashboard", icon: LayoutDashboard,
    papeis: ["GESTOR_EMPRESA", "DSN", "GSN"],
    mobileNav: false,
  },
  {
    to: "/agenda", label: "Agenda", icon: CalendarDays,
    papeis: ["ESN"],
    mobileNav: true,
  },
  {
    to: "/checkin", label: "Check-in", icon: CheckSquare,
    papeis: ["ESN"],
    mobileNav: true,
  },
  {
    to: "/mapa", label: "Mapa ao Vivo", icon: MapPin,
    papeis: ["GESTOR_EMPRESA", "DSN", "GSN"],
    mobileNav: false,
  },
  {
    to: "/clientes", label: "Clientes", icon: Users,
    papeis: ["GESTOR_EMPRESA", "DSN", "GSN", "ESN"],
    mobileNav: true,
  },
  {
    to: "/importacao", label: "Importação", icon: UploadCloud,
    papeis: ["GESTOR_EMPRESA", "DSN"],
    mobileNav: false,
  },
  {
    to: "/configuracoes", label: "Configurações", icon: Settings,
    papeis: ["GESTOR_EMPRESA"],
    mobileNav: false,
  },
];

const PAPEL_LABEL: Record<string, string> = {
  GESTOR_EMPRESA: "Gestor",
  DSN: "Diretor",
  GSN: "Gerente",
  ESN: "Executivo",
};

// ── Layout Desktop (sidebar) ───────────────────────────────────────────────

function DesktopLayout({ children }: { children: React.ReactNode }) {
  const { usuario, logout } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const itens = NAV_ITEMS.filter(
    (item) => usuario && item.papeis.includes(usuario.papel)
  );

  const handleLogout = () => { logout(); navigate("/login"); };

  const inicial = usuario?.nome
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("") || "?";

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`flex-shrink-0 flex flex-col bg-white border-r border-slate-100 transition-all duration-200 ${collapsed ? "w-16" : "w-56"}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-white" strokeWidth={1.5} />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-900 truncate">TNORTEando</p>
              <p className="text-xs text-slate-400 truncate">Gestão de Carteira</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {itens.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-600 font-semibold"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Usuário */}
        <div className="p-2 border-t border-slate-100">
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-indigo-600">{inicial}</span>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {usuario?.nome?.split(" ")[0]}
                </p>
                <p className="text-xs text-slate-400">
                  {PAPEL_LABEL[usuario?.papel || ""] || usuario?.papel}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleLogout}
                className="text-slate-300 hover:text-red-400 transition-colors"
                title="Sair"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

// ── Layout Mobile (bottom nav) ─────────────────────────────────────────────

function MobileLayout({ children }: { children: React.ReactNode }) {
  const { usuario, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const itens = NAV_ITEMS.filter(
    (item) => usuario && item.papeis.includes(usuario.papel)
  );
  const mobileItens = itens.filter((i) => i.mobileNav);
  const extraItens  = itens.filter((i) => !i.mobileNav);

  const handleLogout = () => { logout(); navigate("/login"); };

  const inicial = usuario?.nome
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("") || "?";

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">

      {/* Header mobile */}
      <header className="flex-shrink-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <MapPin className="w-3.5 h-3.5 text-white" strokeWidth={1.5} />
          </div>
          <span className="font-bold text-slate-900 text-sm">TNORTEando</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
            <span className="text-xs font-bold text-indigo-600">{inicial}</span>
          </div>
          {extraItens.length > 0 && (
            <button
              onClick={() => setMenuOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="mobile-nav">
        {mobileItens.map(({ to, label, icon: Icon }) => {
          const isActive = to === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={`mobile-nav-item ${isActive ? "active" : ""}`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2 : 1.5} />
              <span className="text-xs">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Menu drawer (extras no mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setMenuOpen(false)} />
          <div className="w-64 bg-white h-full flex flex-col shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
              <span className="font-semibold text-slate-900">Menu</span>
              <button onClick={() => setMenuOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {extraItens.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-600 font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    }`
                  }
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-slate-100">
              <div className="flex items-center gap-3 px-3 py-2 mb-2">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-indigo-600">{inicial}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {usuario?.nome?.split(" ")[0]}
                  </p>
                  <p className="text-xs text-slate-400">
                    {PAPEL_LABEL[usuario?.papel || ""] || usuario?.papel}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="btn-ghost btn-md btn-full text-red-500 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Layout principal — detecta mobile automaticamente ──────────────────────

export default function AppLayout() {
  const isMobile = window.innerWidth < 768;
  return isMobile
    ? <MobileLayout><Outlet /></MobileLayout>
    : <DesktopLayout><Outlet /></DesktopLayout>;
}
