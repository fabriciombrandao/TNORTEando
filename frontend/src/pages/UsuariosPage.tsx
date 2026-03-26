import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Users, Plus, ChevronRight, Shield, X, Eye, EyeOff } from "lucide-react";

const getUsuarios = () => api.get("/api/v1/usuarios").then(r => r.data);
const criarUsuario = (data: any) => api.post("/api/v1/usuarios", data).then(r => r.data);

const PAPEIS = [
  { value: "ADMIN",                label: "Administrador",          cor: "bg-red-50 text-red-700 border-red-100" },
  { value: "GESTOR_CONSOLIDADORA", label: "Gestor Consolidadora",   cor: "bg-purple-50 text-purple-700 border-purple-100" },
  { value: "GESTOR_EMPRESA",       label: "Gestor Empresa",         cor: "bg-blue-50 text-blue-700 border-blue-100" },
  { value: "DSN",                  label: "DSN — Dir. de Vendas",   cor: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  { value: "GSN",                  label: "GSN — Ger. de Vendas",   cor: "bg-teal-50 text-teal-700 border-teal-100" },
  { value: "ESN",                  label: "ESN — Exec. de Vendas",  cor: "bg-emerald-50 text-emerald-700 border-emerald-100" },
];

const ORDEM = ["ADMIN","GESTOR_CONSOLIDADORA","GESTOR_EMPRESA","DSN","GSN","ESN"];

function BadgePapel({ papel }: { papel: string }) {
  const p = PAPEIS.find(p => p.value === papel);
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${p?.cor || "bg-slate-100 text-slate-500"}`}>
      {p?.label || papel}
    </span>
  );
}

function Avatar({ nome }: { nome: string }) {
  const iniciais = nome.split(" ").filter(Boolean).slice(0,2).map(n => n[0]).join("");
  return (
    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-indigo-600">{iniciais}</span>
    </div>
  );
}

export default function UsuariosPage() {
  const qc = useQueryClient();
  const [modalAberto, setModalAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroPapel, setFiltroPapel] = useState("todos");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [form, setForm] = useState({
    nome: "", email: "", codigo_externo: "", papel: "ESN",
    telefone: "", senha: "Mudar@123",
  });

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: getUsuarios,
  });

  const mutCriar = useMutation({
    mutationFn: criarUsuario,
    onSuccess: () => {
      toast.success("Usuário criado!");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      setModalAberto(false);
      setForm({ nome: "", email: "", codigo_externo: "", papel: "ESN", telefone: "", senha: "Mudar@123" });
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao criar usuário."),
  });

  const usuariosFiltrados = (usuarios as any[])
    .filter(u =>
      (filtroPapel === "todos" || u.papel === filtroPapel) &&
      (!busca ||
        u.nome.toLowerCase().includes(busca.toLowerCase()) ||
        u.email.toLowerCase().includes(busca.toLowerCase()) ||
        (u.codigo_externo||"").toLowerCase().includes(busca.toLowerCase()))
    )
    .sort((a, b) => ORDEM.indexOf(a.papel) - ORDEM.indexOf(b.papel));

  // Agrupar por papel
  const grupos = ORDEM.map(papel => ({
    papel,
    usuarios: usuariosFiltrados.filter(u => u.papel === papel),
  })).filter(g => g.usuarios.length > 0);

  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Usuários</h1>
          <p className="text-sm text-slate-500 mt-0.5">{(usuarios as any[]).length} cadastrados</p>
        </div>
        <button onClick={() => setModalAberto(true)} className="btn-primary btn-md">
          <Plus className="w-4 h-4" /> Novo usuário
        </button>
      </div>

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        <div className="relative">
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail ou código..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltroPapel("todos")}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${filtroPapel==="todos" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
            Todos
          </button>
          {PAPEIS.map(p => (
            <button key={p.value} onClick={() => setFiltroPapel(p.value)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${filtroPapel===p.value ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista agrupada por papel */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : grupos.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Nenhum usuário encontrado.</div>
      ) : (
        <div className="space-y-4">
          {grupos.map(({ papel, usuarios: grupo }) => (
            <div key={papel} className="card">
              <div className="card-header flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">
                  {PAPEIS.find(p => p.value === papel)?.label || papel}
                </span>
                <span className="text-xs text-slate-400 ml-auto">{grupo.length}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {grupo.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar nome={u.nome} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">{u.nome}</p>
                        {!u.ativo && <span className="text-xs text-red-500 font-medium">Inativo</span>}
                        {u.primeiro_acesso && <span className="text-xs text-amber-500 font-medium">Aguardando acesso</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{u.email}</p>
                      {u.codigo_externo && (
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{u.codigo_externo}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal novo usuário */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
          onClick={() => setModalAberto(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-xl"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-bold text-slate-900">Novo usuário</p>
              <button onClick={() => setModalAberto(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {/* Papel */}
              <div>
                <label className="label mb-1.5 block">Papel</label>
                <select value={form.papel} onChange={e => setForm(f => ({...f, papel: e.target.value}))}
                  className="input">
                  {PAPEIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              {/* Nome */}
              <div>
                <label className="label mb-1.5 block">Nome completo</label>
                <input value={form.nome} onChange={e => setForm(f => ({...f, nome: e.target.value}))}
                  className="input" placeholder="Nome do usuário" />
              </div>

              {/* Email */}
              <div>
                <label className="label mb-1.5 block">E-mail</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                  className="input" placeholder="email@totvs.com.br" />
              </div>

              {/* Código e Telefone lado a lado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1.5 block">Código externo</label>
                  <input value={form.codigo_externo} onChange={e => setForm(f => ({...f, codigo_externo: e.target.value}))}
                    className="input font-mono" placeholder="T12345" />
                </div>
                <div>
                  <label className="label mb-1.5 block">Telefone</label>
                  <input value={form.telefone} onChange={e => setForm(f => ({...f, telefone: e.target.value}))}
                    className="input" placeholder="(63) 99999-9999" />
                </div>
              </div>

              {/* Senha */}
              <div>
                <label className="label mb-1.5 block">Senha inicial</label>
                <div className="relative">
                  <input type={mostrarSenha ? "text" : "password"}
                    value={form.senha} onChange={e => setForm(f => ({...f, senha: e.target.value}))}
                    className="input pr-10" />
                  <button onClick={() => setMostrarSenha(!mostrarSenha)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">O usuário deverá trocar no primeiro acesso.</p>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setModalAberto(false)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button
                onClick={() => mutCriar.mutate(form)}
                disabled={!form.nome || !form.email || mutCriar.isPending}
                className="btn-primary btn-md flex-1">
                {mutCriar.isPending ? "Criando..." : "Criar usuário"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
