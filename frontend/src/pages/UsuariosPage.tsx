import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import {
  Users, Plus, Shield, X, Eye, EyeOff,
  MoreVertical, Pencil, KeyRound, UserX, UserCheck, Search
} from "lucide-react";

const getUsuarios    = ()           => api.get("/api/v1/usuarios").then(r => r.data);
const criarUsuario   = (d: any)     => api.post("/api/v1/usuarios", d).then(r => r.data);
const editarUsuario  = ({id, ...d}: any) => api.put(`/api/v1/usuarios/${id}`, d).then(r => r.data);
const redefinirSenha = ({id, senha}: any) => api.post(`/api/v1/usuarios/${id}/redefinir-senha`, {senha}).then(r => r.data);
const toggleAtivo    = ({id, ativo}: any) => api.patch(`/api/v1/usuarios/${id}/ativo`, {ativo}).then(r => r.data);

const PAPEIS = [
  { value: "ADMIN",                label: "Administrador",         cor: "bg-red-50 text-red-700 border-red-100" },
  { value: "GESTOR_CONSOLIDADORA", label: "Gestor Consolidadora",  cor: "bg-purple-50 text-purple-700 border-purple-100" },
  { value: "GESTOR_EMPRESA",       label: "Gestor Empresa",        cor: "bg-blue-50 text-blue-700 border-blue-100" },
  { value: "DSN",                  label: "DSN",                   cor: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  { value: "GSN",                  label: "GSN",                   cor: "bg-teal-50 text-teal-700 border-teal-100" },
  { value: "ESN",                  label: "ESN",                   cor: "bg-emerald-50 text-emerald-700 border-emerald-100" },
];
const ORDEM = ["ADMIN","GESTOR_CONSOLIDADORA","GESTOR_EMPRESA","DSN","GSN","ESN"];

const FORM_VAZIO = { nome:"", email:"", codigo_externo:"", papel:"ESN", telefone:"", senha:"Mudar@123" };

function BadgePapel({ papel }: { papel: string }) {
  const p = PAPEIS.find(p => p.value === papel);
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${p?.cor || "bg-slate-100 text-slate-500 border-slate-200"}`}>
      {p?.label || papel}
    </span>
  );
}

function Avatar({ nome, ativo }: { nome: string; ativo: boolean }) {
  const iniciais = nome.split(" ").filter(Boolean).slice(0,2).map((n:string) => n[0]).join("");
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${ativo ? "bg-indigo-100" : "bg-slate-100"}`}>
      <span className={`text-sm font-bold ${ativo ? "text-indigo-600" : "text-slate-400"}`}>{iniciais}</span>
    </div>
  );
}

function ModalForm({ titulo, form, setForm, onSalvar, onFechar, isPending, isEdicao }: any) {
  const [mostrarSenha, setMostrarSenha] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
         onClick={onFechar}>
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-xl"
           onClick={(e: any) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-900">{titulo}</p>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="label mb-1.5 block">Papel</label>
            <select value={form.papel} onChange={(e:any) => setForm((f:any) => ({...f, papel: e.target.value}))} className="input">
              {PAPEIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label mb-1.5 block">Nome completo *</label>
            <input value={form.nome} onChange={(e:any) => setForm((f:any) => ({...f, nome: e.target.value}))}
              className="input" placeholder="Nome do usuário" />
          </div>
          <div>
            <label className="label mb-1.5 block">E-mail *</label>
            <input type="email" value={form.email} onChange={(e:any) => setForm((f:any) => ({...f, email: e.target.value}))}
              className="input" placeholder="email@totvs.com.br" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1.5 block">Código externo</label>
              <input value={form.codigo_externo} onChange={(e:any) => setForm((f:any) => ({...f, codigo_externo: e.target.value}))}
                className="input font-mono" placeholder="T12345" />
            </div>
            <div>
              <label className="label mb-1.5 block">Telefone</label>
              <input value={form.telefone} onChange={(e:any) => setForm((f:any) => ({...f, telefone: e.target.value}))}
                className="input" placeholder="(63) 99999-9999" />
            </div>
          </div>
          {!isEdicao && (
            <div>
              <label className="label mb-1.5 block">Senha inicial</label>
              <div className="relative">
                <input type={mostrarSenha ? "text" : "password"}
                  value={form.senha} onChange={(e:any) => setForm((f:any) => ({...f, senha: e.target.value}))}
                  className="input pr-10" />
                <button onClick={() => setMostrarSenha(!mostrarSenha)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">O usuário deverá trocar no primeiro acesso.</p>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onFechar} className="btn-secondary btn-md flex-1">Cancelar</button>
          <button onClick={onSalvar} disabled={!form.nome || !form.email || isPending}
            className="btn-primary btn-md flex-1">
            {isPending ? "Salvando..." : isEdicao ? "Salvar" : "Criar usuário"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalSenha({ usuario, onFechar, onSalvar, isPending }: any) {
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const senhaValida = senha.length >= 6 && senha === confirma;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
         onClick={onFechar}>
      <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl"
           onClick={(e:any) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-900">Redefinir senha</p>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-500">Redefinindo senha de <strong>{usuario.nome}</strong>.</p>
          <div>
            <label className="label mb-1.5 block">Nova senha</label>
            <div className="relative">
              <input type={mostrar ? "text" : "password"} value={senha}
                onChange={(e:any) => setSenha(e.target.value)} className="input pr-10"
                placeholder="Mínimo 6 caracteres" />
              <button onClick={() => setMostrar(!mostrar)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label mb-1.5 block">Confirmar senha</label>
            <input type={mostrar ? "text" : "password"} value={confirma}
              onChange={(e:any) => setConfirma(e.target.value)}
              className={`input ${confirma && !senhaValida ? "border-red-300 focus:border-red-400" : ""}`}
              placeholder="Repita a senha" />
            {confirma && senha !== confirma && (
              <p className="text-xs text-red-500 mt-1">As senhas não coincidem.</p>
            )}
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onFechar} className="btn-secondary btn-md flex-1">Cancelar</button>
          <button onClick={() => onSalvar(senha)} disabled={!senhaValida || isPending}
            className="btn-primary btn-md flex-1">
            {isPending ? "Salvando..." : "Redefinir"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalConfirm({ titulo, mensagem, onConfirmar, onFechar, isPending, cor = "red" }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
         onClick={onFechar}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl"
           onClick={(e:any) => e.stopPropagation()}>
        <p className="font-bold text-slate-900 mb-2">{titulo}</p>
        <p className="text-sm text-slate-500 mb-4">{mensagem}</p>
        <div className="flex gap-3">
          <button onClick={onFechar} className="btn-secondary btn-md flex-1">Cancelar</button>
          <button onClick={onConfirmar} disabled={isPending}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white ${cor === "red" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
            {isPending ? "Aguarde..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsuariosPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroPapel, setFiltroPapel] = useState("todos");
  const [menuAberto, setMenuAberto] = useState<string|null>(null);

  // Modais
  const [modalCriar, setModalCriar]   = useState(false);
  const [modalEditar, setModalEditar] = useState<any>(null);
  const [modalSenha, setModalSenha]   = useState<any>(null);
  const [modalToggle, setModalToggle] = useState<any>(null);

  const [form, setForm] = useState({...FORM_VAZIO});
  const [formEditar, setFormEditar] = useState({...FORM_VAZIO});

  const { data: usuarios = [], isLoading } = useQuery({ queryKey: ["usuarios"], queryFn: getUsuarios });

  const mutCriar = useMutation({
    mutationFn: criarUsuario,
    onSuccess: () => { toast.success("Usuário criado!"); qc.invalidateQueries({queryKey:["usuarios"]}); setModalCriar(false); setForm({...FORM_VAZIO}); },
    onError: (e:any) => toast.error(e.response?.data?.detail || "Erro ao criar."),
  });

  const mutEditar = useMutation({
    mutationFn: editarUsuario,
    onSuccess: () => { toast.success("Usuário atualizado!"); qc.invalidateQueries({queryKey:["usuarios"]}); setModalEditar(null); },
    onError: (e:any) => toast.error(e.response?.data?.detail || "Erro ao editar."),
  });

  const mutSenha = useMutation({
    mutationFn: redefinirSenha,
    onSuccess: () => { toast.success("Senha redefinida!"); setModalSenha(null); },
    onError: (e:any) => toast.error(e.response?.data?.detail || "Erro ao redefinir senha."),
  });

  const mutToggle = useMutation({
    mutationFn: toggleAtivo,
    onSuccess: (_, vars:any) => {
      toast.success(vars.ativo ? "Usuário reativado!" : "Usuário desativado!");
      qc.invalidateQueries({queryKey:["usuarios"]});
      setModalToggle(null);
    },
    onError: (e:any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  const usuariosFiltrados = (usuarios as any[])
    .filter(u =>
      (filtroPapel === "todos" || u.papel === filtroPapel) &&
      (!busca || u.nome.toLowerCase().includes(busca.toLowerCase()) ||
        u.email.toLowerCase().includes(busca.toLowerCase()) ||
        (u.codigo_externo||"").toLowerCase().includes(busca.toLowerCase()))
    )
    .sort((a,b) => ORDEM.indexOf(a.papel) - ORDEM.indexOf(b.papel));

  const grupos = ORDEM.map(papel => ({
    papel,
    usuarios: usuariosFiltrados.filter((u:any) => u.papel === papel),
  })).filter(g => g.usuarios.length > 0);

  function abrirEditar(u: any) {
    setFormEditar({ nome: u.nome, email: u.email, codigo_externo: u.codigo_externo||"",
      papel: u.papel, telefone: u.telefone||"", senha: "" });
    setModalEditar(u);
    setMenuAberto(null);
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in" onClick={() => setMenuAberto(null)}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Usuários</h1>
          <p className="text-sm text-slate-500 mt-0.5">{(usuarios as any[]).length} cadastrados</p>
        </div>
        <button onClick={() => setModalCriar(true)} className="btn-primary btn-md">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo usuário</span>
        </button>
      </div>

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail ou código..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["todos", ...ORDEM].map(v => (
            <button key={v} onClick={() => setFiltroPapel(v)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                filtroPapel === v ? "bg-indigo-600 text-white border-indigo-600"
                                 : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
              {v === "todos" ? "Todos" : PAPEIS.find(p => p.value === v)?.label || v}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : grupos.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Nenhum usuário encontrado.</div>
      ) : (
        <div className="space-y-4">
          {grupos.map(({ papel, usuarios: grupo }) => (
            <div key={papel} className="card overflow-visible">
              <div className="card-header flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">
                  {PAPEIS.find(p => p.value === papel)?.label || papel}
                </span>
                <span className="text-xs text-slate-400 ml-auto">{grupo.length}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {grupo.map((u: any) => (
                  <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${!u.ativo ? "opacity-50" : ""}`}>
                    <Avatar nome={u.nome} ativo={u.ativo !== false} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-semibold ${u.ativo === false ? "line-through text-slate-400" : "text-slate-900"}`}>{u.nome}</p>
                        {u.ativo === false && (
                          <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-medium border border-red-100">Inativo</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{u.email}</p>
                      {u.codigo_externo && (
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{u.codigo_externo}</p>
                      )}
                    </div>

                    {/* Menu ações */}
                    <div className="relative flex-shrink-0" onClick={(e:any) => e.stopPropagation()}>
                      <button onClick={() => setMenuAberto(menuAberto === u.id ? null : u.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuAberto === u.id && (
                        <div className="absolute right-0 top-9 z-20 w-44 bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden">
                          <button onClick={() => abrirEditar(u)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                            <Pencil className="w-4 h-4 text-slate-400" /> Editar dados
                          </button>
                          <button onClick={() => { setModalSenha(u); setMenuAberto(null); }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                            <KeyRound className="w-4 h-4 text-slate-400" /> Redefinir senha
                          </button>
                          <div className="border-t border-slate-100" />
                          <button onClick={() => { setModalToggle(u); setMenuAberto(null); }}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 ${u.ativo === false ? "text-emerald-600" : "text-red-600"}`}>
                            {u.ativo === false
                              ? <><UserCheck className="w-4 h-4" /> Reativar</>
                              : <><UserX className="w-4 h-4" /> Desativar</>}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criar */}
      {modalCriar && (
        <ModalForm titulo="Novo usuário" form={form} setForm={setForm}
          onSalvar={() => mutCriar.mutate(form)}
          onFechar={() => { setModalCriar(false); setForm({...FORM_VAZIO}); }}
          isPending={mutCriar.isPending} isEdicao={false} />
      )}

      {/* Modal editar */}
      {modalEditar && (
        <ModalForm titulo="Editar usuário" form={formEditar} setForm={setFormEditar}
          onSalvar={() => mutEditar.mutate({ id: modalEditar.id, ...formEditar })}
          onFechar={() => setModalEditar(null)}
          isPending={mutEditar.isPending} isEdicao={true} />
      )}

      {/* Modal redefinir senha */}
      {modalSenha && (
        <ModalSenha usuario={modalSenha}
          onFechar={() => setModalSenha(null)}
          onSalvar={(senha: string) => mutSenha.mutate({ id: modalSenha.id, senha })}
          isPending={mutSenha.isPending} />
      )}

      {/* Modal confirmar toggle */}
      {modalToggle && (
        <ModalConfirm
          titulo={modalToggle.ativo === false ? "Reativar usuário?" : "Desativar usuário?"}
          mensagem={modalToggle.ativo === false
            ? `${modalToggle.nome} voltará a ter acesso ao sistema.`
            : `${modalToggle.nome} perderá acesso ao sistema.`}
          onFechar={() => setModalToggle(null)}
          onConfirmar={() => mutToggle.mutate({ id: modalToggle.id, ativo: modalToggle.ativo === false })}
          isPending={mutToggle.isPending}
          cor={modalToggle.ativo === false ? "green" : "red"} />
      )}
    </div>
  );
}
