import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import {
  LayoutDashboard, MapPin, CalendarDays, Users,
  UploadCloud, LogOut, CheckSquare
} from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, papeis: ["GESTOR_EMPRESA","DSN","GSN","ESN"] },
  { to: "/agenda", label: "Minha Agenda", icon: CalendarDays, papeis: ["ESN"] },
  { to: "/checkin", label: "Check-in", icon: CheckSquare, papeis: ["ESN"] },
  { to: "/mapa", label: "Mapa ao Vivo", icon: MapPin, papeis: ["GESTOR_EMPRESA","DSN","GSN"] },
  { to: "/clientes", label: "Clientes", icon: Users, papeis: ["GESTOR_EMPRESA","DSN","GSN","ESN"] },
  { to: "/importacao", label: "Importação", icon: UploadCloud, papeis: ["GESTOR_EMPRESA","DSN"] },
];

export default function AppLayout() {
  const { usuario, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const itensVisiveis = navItems.filter(
    (item) => usuario && item.papeis.includes(usuario.papel)
  );

  const papelLabel: Record<string, string> = {
    GESTOR_EMPRESA: "Gestor",
    DSN: "Diretor",
    GSN: "Gerente",
    ESN: "Executivo",
  };

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-sm tracking-tight">Visitas</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {itensVisiveis.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-400 font-medium"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800">
            <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-indigo-400">
                {usuario?.nome?.charAt(0)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {usuario?.nome?.split(" ")[0]}
              </p>
              <p className="text-xs text-slate-500">
                {papelLabel[usuario?.papel || ""] || usuario?.papel}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-red-400 transition-colors"
              title="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
