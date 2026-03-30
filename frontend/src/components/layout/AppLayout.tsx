import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import {
  LayoutDashboard, MapPin, CalendarDays, Users,
  UploadCloud, LogOut, CheckSquare, Settings,
  Menu, X, ChevronRight, KeyRound, Eye, EyeOff, ShieldAlert, BookOpen
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../services/api";

// ── Itens de navegação ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    to: "/", label: "Dashboard", icon: LayoutDashboard,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA", "DSN", "GSN"],
    mobileNav: false,
  },
  {
    to: "/agenda", label: "Agenda", icon: CalendarDays,
    papeis: ["ESN", "CS"],
    mobileNav: true,
  },
  {
    to: "/checkin", label: "Check-in", icon: CheckSquare,
    papeis: ["ESN"],
    mobileNav: true,
  },
  {
    to: "/mapa", label: "Mapa ao Vivo", icon: MapPin,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA", "DSN", "GSN"],
    mobileNav: false,
  },
  {
    to: "/clientes", label: "Clientes", icon: Users,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA", "DSN", "GSN", "CS", "ESN"],
    mobileNav: true,
  },
  {
    to: "/importacao", label: "Importação", icon: UploadCloud,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA", "DSN"],
    mobileNav: false,
  },
  {
    to: "/usuarios", label: "Usuários", icon: Users,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA"],
    mobileNav: false,
  },
  {
    to: "/cadastros", label: "Cadastros", icon: BookOpen,
    papeis: ["ADMIN", "GESTOR_EMPRESA", "CS"],
    mobileNav: false,
  },
  {
    to: "/cadastros", label: "Cadastros", icon: BookOpen,
    papeis: ["ADMIN", "GESTOR_EMPRESA", "CS"],
    mobileNav: false,
  },
  {
    to: "/auditoria", label: "Auditoria", icon: ShieldAlert,
    papeis: ["ADMIN"],
    mobileNav: false,
  },
  {
    to: "/configuracoes", label: "Configurações", icon: Settings,
    papeis: ["ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA"],
    mobileNav: false,
  },
];

const PAPEL_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR_CONSOLIDADORA: "Gestor Consolidadora",
  CS: "CS",
  GESTOR_EMPRESA: "Gestor",
  DSN: "Diretor",
  GSN: "Gerente",
  ESN: "Executivo",
};

// ── Layout Desktop (sidebar) ───────────────────────────────────────────────

function AlterarSenhaForm({ usuarioId, onFechar }: { usuarioId: string; onFechar: () => void }) {
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [loading, setLoading] = useState(false);
  const valida = senha.length >= 6 && senha === confirma;

  async function salvar() {
    if (!valida) return;
    setLoading(true);
    try {
      const { default: api } = await import("../../services/api");
      await api.post(`/api/v1/usuarios/${usuarioId}/redefinir-senha`, { senha });
      onFechar();
      alert("Senha alterada com sucesso!");
    } catch { alert("Erro ao alterar senha."); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-5 space-y-3">
      <div>
        <label className="label mb-1.5 block">Nova senha</label>
        <div className="relative">
          <input type={mostrar ? "text" : "password"} value={senha}
            onChange={e => setSenha(e.target.value)} className="input pr-10" placeholder="Mínimo 6 caracteres" />
          <button onClick={() => setMostrar(!mostrar)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className="label mb-1.5 block">Confirmar senha</label>
        <input type={mostrar ? "text" : "password"} value={confirma}
          onChange={e => setConfirma(e.target.value)}
          className={`input ${confirma && !valida ? "border-red-300" : ""}`} placeholder="Repita a senha" />
        {confirma && senha !== confirma && <p className="text-xs text-red-500 mt-1">As senhas não coincidem.</p>}
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onFechar} className="btn-secondary btn-md flex-1">Cancelar</button>
        <button onClick={salvar} disabled={!valida || loading} className="btn-primary btn-md flex-1">
          {loading ? "Salvando..." : "Alterar"}
        </button>
      </div>
    </div>
  );
}

function DesktopLayout({ children }: { children: React.ReactNode }) {
  const { usuario, logout } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [menuUsuario, setMenuUsuario] = useState(false);
  const [modalSenha, setModalSenha] = useState(false);

  const { data: perfil } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/api/v1/usuarios/me").then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
  const org = perfil?.organizacao;

  const itens = NAV_ITEMS.filter(
    (item) => usuario && item.papeis.includes(usuario.papel)
  );

  const handleLogout = async () => {
    try {
      const { default: api } = await import("../../services/api");
      await api.post("/api/v1/auth/logout");
    } catch {}
    logout();
    navigate("/login");
  };

  const inicial = usuario?.nome
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("") || "?";

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden" onClick={() => setMenuUsuario(false)}>
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

        {/* Badge organização */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
            {org && ["GESTOR_EMPRESA","DSN","GSN","ESN"].includes(usuario?.papel || "") ? (
              <>
                <p className="text-xs font-bold text-indigo-600 truncate">{org.codigo}</p>
                <p className="text-xs text-slate-400 truncate">{org.nome}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold text-indigo-600">Sistema</p>
                <p className="text-xs text-slate-400">Todas as unidades</p>
              </>
            )}
          </div>
        )}
        {collapsed && (
          <div className="px-2 py-2 border-b border-slate-100 bg-slate-50/50 flex justify-center">
            <span className="text-xs font-bold text-indigo-600">
              {["ADMIN","GESTOR_CONSOLIDADORA"].includes(usuario?.papel || "") ? "SYS" : (org?.codigo || "SYS")}
            </span>
          </div>
        )}

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
        <div className="p-2 border-t border-slate-100 relative">
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors ${collapsed ? "justify-center" : ""}`} onClick={e => { e.stopPropagation(); setMenuUsuario(m => !m); }}>
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-indigo-600">{inicial}</span>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {(() => {
                    const partes = (usuario?.nome || "").split(" ").filter(Boolean);
                    return partes.length >= 2 ? `${partes[0]} ${partes[partes.length-1]}` : partes[0] || "";
                  })()}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {usuario?.papel}
                  {(perfil?.codigo_externo || usuario?.codigo_externo) ? ` · ${perfil?.codigo_externo || usuario?.codigo_externo}` : ""}
                </p>
              </div>
            )}
            {!collapsed && <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
          </div>
          {menuUsuario && !collapsed && (
            <div className="absolute bottom-14 left-2 right-2 bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden z-50">
              <button onClick={() => { setModalSenha(true); setMenuUsuario(false); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <KeyRound className="w-4 h-4 text-slate-400" /> Alterar senha
              </button>
              <div className="border-t border-slate-100" />
              <button onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </aside>

      {modalSenha && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setModalSenha(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-bold text-slate-900">Alterar senha</p>
              <button onClick={() => setModalSenha(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <AlterarSenhaForm usuarioId={usuario?.id || ""} onFechar={() => setModalSenha(false)} />
          </div>
        </div>
      )}

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
  const [modalSenhaMobile, setModalSenhaMobile] = useState(false);

  const { data: perfil } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/api/v1/usuarios/me").then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
  const org = perfil?.organizacao;

  const itens = NAV_ITEMS.filter(
    (item) => usuario && item.papeis.includes(usuario.papel)
  );
  const mobileItens = itens.filter((i) => i.mobileNav);
  const extraItens  = itens.filter((i) => !i.mobileNav);

  const handleLogout = async () => {
    try {
      const { default: api } = await import("../../services/api");
      await api.post("/api/v1/auth/logout");
    } catch {}
    logout();
    navigate("/login");
  };

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
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-3.5 h-3.5 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm">TNORTEando</span>
            {org && ["GESTOR_EMPRESA","DSN","GSN","ESN"].includes(usuario?.papel || "") ? (
              <p className="text-xs text-indigo-600 font-semibold leading-tight">{org.codigo} — {org.nome}</p>
            ) : (
              <p className="text-xs text-slate-400 leading-tight">Todas as unidades</p>
            )}
          </div>
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
                    {(() => {
                      const partes = (usuario?.nome || "").split(" ").filter(Boolean);
                      return partes.length >= 2 ? `${partes[0]} ${partes[partes.length-1]}` : partes[0] || "";
                    })()}
                  </p>
                  <p className="text-xs text-slate-400">
                    {usuario?.papel}
                    {(perfil?.codigo_externo || usuario?.codigo_externo) ? ` · ${perfil?.codigo_externo || usuario?.codigo_externo}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setModalSenhaMobile(true); setMenuOpen(false); }}
                className="btn-ghost btn-md btn-full text-slate-700"
              >
                <KeyRound className="w-4 h-4" /> Alterar senha
              </button>
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

      {modalSenhaMobile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setModalSenhaMobile(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-bold text-slate-900">Alterar senha</p>
              <button onClick={() => setModalSenhaMobile(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <AlterarSenhaForm usuarioId={usuario?.id || ""} onFechar={() => setModalSenhaMobile(false)} />
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
