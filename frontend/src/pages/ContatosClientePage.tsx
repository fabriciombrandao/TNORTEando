import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { ArrowLeft, Plus, Pencil, Trash2, X, Check, Search, Star, Phone, Mail, MessageCircle, Share2 } from "lucide-react";

const listarContatos  = (id: string) => api.get(`/api/v1/clientes/${id}/contatos`).then(r => r.data);
const criarContato    = (id: string, body: any) => api.post(`/api/v1/clientes/${id}/contatos`, body).then(r => r.data);
const editarContato   = (cliId: string, conId: string, body: any) => api.put(`/api/v1/clientes/${cliId}/contatos/${conId}`, body).then(r => r.data);
const removerContato  = (cliId: string, conId: string) => api.delete(`/api/v1/clientes/${cliId}/contatos/${conId}`).then(r => r.data);
const buscarContatos  = (q: string) => api.get(`/api/v1/contatos/buscar`, { params: { q } }).then(r => r.data);
const listarDepts     = () => api.get(`/api/v1/cadastros/departamentos`).then(r => r.data);
const listarTipos     = () => api.get(`/api/v1/cadastros/tipos_contato`).then(r => r.data);

function compartilharContato(c: any) {
  const linhas = [];
  linhas.push(`*${c.nome}*`);
  if (c.cargo || c.departamento) {
    linhas.push([c.cargo, c.departamento].filter(Boolean).join(" · "));
  }
  if (c.telefone) linhas.push(`📱 ${c.telefone}`);
  if (c.email) linhas.push(`✉️ ${c.email}`);
  if (c.observacoes) linhas.push(`📝 ${c.observacoes}`);
  const texto = linhas.join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
}

function foneWA(tel: string) {
  return tel.replace(/\D/g, "");
}

function iniciais(nome: string) {
  return nome.split(" ").filter(Boolean).slice(0, 2).map(n => n[0]).join("").toUpperCase();
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-0 md:px-4" onClick={onClose}>
      <div className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <p className="font-bold text-slate-900">{titulo}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormContato({ clienteId, item, onSave, onClose }: { clienteId: string; item?: any; onSave: (b: any) => void; onClose: () => void }) {
  const [nome,         setNome]         = useState(item?.nome         || "");
  const [cargo,        setCargo]        = useState(item?.cargo        || "");
  const [telefone,     setTelefone]     = useState(item?.telefone     || "");
  const [email,        setEmail]        = useState(item?.email        || "");
  const [departamento, setDepartamento] = useState(item?.departamento || "");
  const [tipo,         setTipo]         = useState(item?.tipo         || "OUTRO");
  const [principal,    setPrincipal]    = useState(item?.principal    || false);
  const [observacoes,  setObservacoes]  = useState(item?.observacoes  || "");
  const [busca,        setBusca]        = useState("");
  const [buscaAtiva,   setBuscaAtiva]   = useState(false);

  const { data: depts = [] } = useQuery({ queryKey: ["cadastro", "departamentos"], queryFn: listarDepts });
  const { data: tipos = [] } = useQuery({ queryKey: ["cadastro", "tipos_contato"], queryFn: listarTipos });
  const { data: resultados = [] } = useQuery({
    queryKey: ["busca-contatos", busca],
    queryFn:  () => buscarContatos(busca),
    enabled:  busca.length >= 2,
  });

  function vincularExistente(c: any) {
    onSave({ contato_id: c.id, nome: c.nome, departamento, tipo, principal });
    onClose();
  }

  return (
    <div className="space-y-4">
      {/* Busca contato existente — só no modo criar */}
      {!item && (
        <div>
          <label className="label mb-1.5 block">Vincular contato existente</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={busca} onChange={e => { setBusca(e.target.value); setBuscaAtiva(true); }}
              className="input pl-9" placeholder="Buscar por nome ou e-mail..." />
          </div>
          {buscaAtiva && busca.length >= 2 && (resultados as any[]).length > 0 && (
            <div className="mt-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-md">
              {(resultados as any[]).map((c: any) => (
                <button key={c.id} onClick={() => vincularExistente(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50 text-left border-b border-slate-50 last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                    {iniciais(c.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{c.nome}</p>
                    <p className="text-xs text-slate-400">{c.cargo || "—"} {c.email ? `· ${c.email}` : ""}</p>
                  </div>
                  <span className="text-xs text-indigo-600 font-semibold">Vincular</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-xs text-slate-400 font-medium">ou cadastrar novo</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
        </div>
      )}

      {/* Formulário */}
      <div>
        <label className="label mb-1.5 block">Nome completo <span className="text-red-500">*</span></label>
        <input value={nome} onChange={e => setNome(e.target.value)} className="input" placeholder="Nome do contato" />
      </div>
      <div>
        <label className="label mb-1.5 block">Cargo</label>
        <input value={cargo} onChange={e => setCargo(e.target.value)} className="input" placeholder="Ex: Diretor Financeiro" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1.5 block">Departamento</label>
          <select value={departamento} onChange={e => setDepartamento(e.target.value)} className="input">
            <option value="">Selecione...</option>
            {(depts as any[]).map((d: any) => <option key={d.id} value={d.nome}>{d.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1.5 block">Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="input">
            {(tipos as any[]).map((t: any) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            <option value="OUTRO">Outro</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1.5 block">Telefone</label>
          <input value={telefone} onChange={e => setTelefone(e.target.value)} className="input" placeholder="(63) 9 9999-0000" />
        </div>
        <div>
          <label className="label mb-1.5 block">E-mail</label>
          <input value={email} onChange={e => setEmail(e.target.value)} className="input" placeholder="email@empresa.com" />
        </div>
      </div>
      <div>
        <label className="label mb-1.5 block">Observações</label>
        <input value={observacoes} onChange={e => setObservacoes(e.target.value)} className="input" placeholder="Informações adicionais..." />
      </div>
      <div className="flex items-center justify-between py-2 border-t border-slate-100">
        <div>
          <p className="text-sm font-semibold text-slate-800">Contato principal</p>
          <p className="text-xs text-slate-400">Referência principal deste cliente</p>
        </div>
        <button onClick={() => setPrincipal(!principal)}
          className={`w-12 h-6 rounded-full transition-colors relative ${principal ? "bg-indigo-600" : "bg-slate-200"}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${principal ? "left-6" : "left-0.5"}`} />
        </button>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary btn-md flex-1">Cancelar</button>
        <button onClick={() => onSave({ nome, cargo, telefone, email, departamento, tipo, principal, observacoes })}
          disabled={!nome.trim()} className="btn-primary btn-md flex-1">
          <Check className="w-4 h-4" /> Salvar
        </button>
      </div>
    </div>
  );
}

export default function ContatosClientePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal]     = useState<"novo" | "editar" | null>(null);
  const [editando, setEditando] = useState<any>(null);

  const { data: contatos = [], isLoading } = useQuery({
    queryKey: ["contatos", id],
    queryFn:  () => listarContatos(id!),
    enabled:  !!id,
  });

  const mutCriar = useMutation({
    mutationFn: (body: any) => criarContato(id!, body),
    onSuccess: () => { toast.success("Contato adicionado!"); qc.invalidateQueries({ queryKey: ["contatos", id] }); setModal(null); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao salvar."),
  });

  const mutEditar = useMutation({
    mutationFn: (body: any) => editarContato(id!, editando.id, body),
    onSuccess: () => { toast.success("Contato atualizado!"); qc.invalidateQueries({ queryKey: ["contatos", id] }); setModal(null); setEditando(null); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atualizar."),
  });

  const mutRemover = useMutation({
    mutationFn: (conId: string) => removerContato(id!, conId),
    onSuccess: () => { toast.success("Contato removido."); qc.invalidateQueries({ queryKey: ["contatos", id] }); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao remover."),
  });

  return (
    <div className="p-4 md:p-6 max-w-2xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-100">
          <ArrowLeft className="w-4 h-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">Contatos</h1>
          <p className="text-xs text-slate-400">{(contatos as any[]).length} contato(s) cadastrado(s)</p>
        </div>
        <button onClick={() => { setEditando(null); setModal("novo"); }} className="btn-primary btn-sm">
          <Plus className="w-3.5 h-3.5" /> Novo
        </button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <p className="text-center py-12 text-slate-400">Carregando...</p>
      ) : (contatos as any[]).length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <p className="text-slate-400 text-sm font-medium">Nenhum contato cadastrado</p>
          <p className="text-slate-300 text-xs mt-1">Adicione decisores, técnicos e outros contatos do cliente.</p>
          <button onClick={() => setModal("novo")} className="btn-primary btn-sm mt-4">
            <Plus className="w-3.5 h-3.5" /> Adicionar contato
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {(contatos as any[]).map((c: any) => (
            <div key={c.id} className={`bg-white border rounded-2xl p-4 ${c.principal ? "border-indigo-200" : "border-slate-200"}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                  {iniciais(c.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{c.nome}</p>
                    {c.principal && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                  </div>
                  {c.cargo && <p className="text-xs text-slate-500 mt-0.5">{c.cargo}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {c.tipo && <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{c.tipo}</span>}
                    {c.departamento && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">{c.departamento}</span>}
                  </div>
                  {(c.telefone || c.email) && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-50">
                      {c.telefone && (
                        <>
                          <a href={`tel:${c.telefone}`} title={c.telefone}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg text-xs text-slate-600 font-medium transition-colors">
                            <Phone className="w-3.5 h-3.5" /> Ligar
                          </a>
                          <a href={`https://wa.me/55${foneWA(c.telefone)}`} target="_blank" rel="noreferrer" title="WhatsApp"
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-medium transition-colors">
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </a>
                        </>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} title={c.email}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-xs text-slate-600 font-medium transition-colors">
                          <Mail className="w-3.5 h-3.5" /> E-mail
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => compartilharContato(c)} title="Compartilhar no WhatsApp"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-green-50 hover:text-green-600">
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setEditando(c); setModal("editar"); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm(`Remover "${c.nome}"?`)) mutRemover.mutate(c.id); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal
          titulo={modal === "novo" ? "Novo contato" : `Editar — ${editando?.nome}`}
          onClose={() => { setModal(null); setEditando(null); }}
        >
          <FormContato
            clienteId={id!}
            item={modal === "editar" ? editando : undefined}
            onSave={(body: any) => modal === "novo" ? mutCriar.mutate(body) : mutEditar.mutate(body)}
            onClose={() => { setModal(null); setEditando(null); }}
          />
        </Modal>
      )}
    </div>
  );
}
