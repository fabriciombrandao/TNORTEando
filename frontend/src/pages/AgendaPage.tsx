import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../store/auth";
import toast from "react-hot-toast";
import {
  CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Zap, Eye,
  CheckCircle, Circle, Clock, MapPin, Send, Trash2, X, Pencil
} from "lucide-react";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const STATUS_BADGE: Record<string, string> = {
  PRE_AGENDA: "bg-amber-50 text-amber-700",
  RASCUNHO:   "bg-amber-50 text-amber-700",
  PUBLICADA:  "bg-emerald-50 text-emerald-700",
  ENCERRADA:  "bg-slate-100 text-slate-500",
};

function statusLabel(status: string | null) {
  if (!status || status === "RASCUNHO" || status === "PRE_AGENDA") return "Pré-Agenda";
  if (status === "PUBLICADA") return "Publicada";
  if (status === "ENCERRADA") return "Encerrada";
  return status;
}

const STATUS_ITEM: Record<string, string> = {
  PENDENTE:   "text-slate-400",
  CONCLUIDO:  "text-emerald-500",
  CANCELADO:  "text-red-400",
  REAGENDADO: "text-amber-500",
};

function ModalItens({ agenda, onClose }: { agenda: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const papel = usuario?.papel || "";
  const [justModal, setJustModal] = useState<any>(null);
  const [justText, setJustText] = useState("");
  const [editHorario, setEditHorario] = useState<{id: string; h: string} | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [horarios, setHorarios] = useState<Record<string, string>>({});

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["agenda-itens", agenda.id],
    queryFn: () => api.get(`/api/v1/agenda/${agenda.id}/itens`).then(r => r.data),
  });

  const { data: params } = useQuery({
    queryKey: ["agenda-params-horario", agenda.id],
    queryFn: () => api.get(`/api/v1/agenda/${agenda.id}/parametros-horario`).then(r => r.data),
    enabled: !agenda.publicada,
  });

  const { data: justificativas = [] } = useQuery({
    queryKey: ["cadastro", "justificativas_agenda"],
    queryFn: () => api.get("/api/v1/cadastros/justificativas_agenda").then(r => r.data),
  });

  // Calcular horários sugeridos quando itens e params estiverem disponíveis
  const itensAtivos = (itens as any[]).filter(i => i.status !== "CANCELADO");

  function calcularHorarios(itensLista: any[]) {
    if (!params) return;
    const [hh, mm] = (params.horario_inicio || "08:00").split(":").map(Number);
    const slot = (params.duracao_min || 45) + (params.intervalo_min || 15);
    const novosHorarios: Record<string, string> = {};
    itensLista.forEach((item, i) => {
      if (!item.horario_previsto) {
        const total = hh * 60 + mm + i * slot;
        novosHorarios[item.id] = `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
      } else {
        novosHorarios[item.id] = item.horario_previsto;
      }
    });
    setHorarios(novosHorarios);
    // Selecionar todos por padrão
    setSelecionados(new Set(itensLista.map(i => i.id)));
  }

  // Quando itens carregam, calcular horários e selecionar todos
  const [inicializado, setInicializado] = useState(false);
  if (!inicializado && itensAtivos.length > 0 && params) {
    calcularHorarios(itensAtivos);
    setInicializado(true);
  }

  const mutPublicarItens = useMutation({
    mutationFn: () => api.post(`/api/v1/agenda/${agenda.id}/publicar-itens`, {
      item_ids: Array.from(selecionados),
      horarios,
    }).then(r => r.data),
    onSuccess: (res) => {
      toast.success(`${res.publicados} visita${res.publicados !== 1 ? "s" : ""} publicada${res.publicados !== 1 ? "s" : ""}!`);
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
      qc.invalidateQueries({ queryKey: ["agenda-itens", agenda.id] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao publicar."),
  });

  const mutRemover = useMutation({
    mutationFn: ({ itemId, just }: any) =>
      api.delete(`/api/v1/agenda/${agenda.id}/itens/${itemId}`, { data: { justificativa: just } }).then(r => r.data),
    onSuccess: () => {
      toast.success("Visita removida.");
      qc.invalidateQueries({ queryKey: ["agenda-itens", agenda.id] });
      setSelecionados(prev => { const s = new Set(prev); s.delete(justModal?.id); return s; });
      setJustModal(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  const mutHorario = useMutation({
    mutationFn: ({ itemId, h }: any) =>
      api.put(`/api/v1/agenda/${agenda.id}/itens/${itemId}/horario`, { horario: h }).then(r => r.data),
    onSuccess: (_, vars) => {
      setHorarios(prev => ({ ...prev, [vars.itemId]: vars.h }));
      qc.invalidateQueries({ queryKey: ["agenda-itens", agenda.id] });
      setEditHorario(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  const podeEditar = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel) && !agenda.publicada;
  const totalSelecionados = selecionados.size;

  function toggleItem(id: string) {
    setSelecionados(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="font-bold text-slate-900">{agenda.vendedor_nome} · {agenda.codigo_externo}</p>
            <p className="text-xs text-slate-400">
              {format(new Date(agenda.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })} · {agenda.total_itens} visitas
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Lista de itens */}
        <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
          {isLoading ? (
            <p className="text-center py-8 text-slate-400">Carregando...</p>
          ) : itensAtivos.length === 0 ? (
            <p className="text-center py-8 text-slate-400">Nenhuma visita agendada.</p>
          ) : (
            itensAtivos.map((item: any) => {
              const sel = selecionados.has(item.id);
              const h = horarios[item.id] || item.horario_previsto || "";
              return (
                <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${!sel && podeEditar ? "opacity-50" : ""}`}>
                  {/* Checkbox */}
                  {podeEditar && (
                    <button onClick={() => toggleItem(item.id)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${sel ? "bg-indigo-600 border-indigo-600" : "border-slate-300"}`}>
                      {sel && <CheckCircle className="w-3 h-3 text-white" />}
                    </button>
                  )}
                  {/* Horário */}
                  {podeEditar ? (
                    <button onClick={() => setEditHorario({ id: item.id, h })}
                      className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg w-14 text-center flex-shrink-0 hover:bg-indigo-100">
                      {h || "--:--"}
                    </button>
                  ) : (
                    h ? <span className="text-xs text-slate-400 w-14 text-center flex-shrink-0">{h}</span> : null
                  )}
                  {/* Dados do cliente */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{item.razao_social}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.municipio && <span className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="w-3 h-3" />{item.municipio}</span>}
                      {item.classificacao_abc && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.classificacao_abc === "A" ? "bg-emerald-50 text-emerald-700" : item.classificacao_abc === "B" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.classificacao_abc}
                        </span>
                      )}
                      {item.publicado && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">Publicado</span>}
                    </div>
                  </div>
                  {/* Remover */}
                  {podeEditar && (
                    <button onClick={() => setJustModal(item)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer com botão publicar */}
        {podeEditar && itensAtivos.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setSelecionados(new Set(itensAtivos.map((i:any) => i.id)))}
                className="text-xs text-indigo-600 hover:underline">Selecionar todos</button>
              <button onClick={() => setSelecionados(new Set())}
                className="text-xs text-slate-400 hover:underline">Limpar seleção</button>
            </div>
            <button onClick={() => mutPublicarItens.mutate()}
              disabled={totalSelecionados === 0 || mutPublicarItens.isPending}
              className="btn-primary btn-md w-full">
              <Send className="w-4 h-4" />
              {mutPublicarItens.isPending ? "Publicando..." : `Publicar selecionados (${totalSelecionados})`}
            </button>
          </div>
        )}
      </div>

      {/* Modal horário */}
      {editHorario && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4" onClick={() => setEditHorario(null)}>
          <div className="w-full max-w-xs bg-white rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-900 mb-3">Definir horário</p>
            <input type="time" value={editHorario.h} onChange={e => setEditHorario({ ...editHorario, h: e.target.value })}
              className="input mb-4 text-center text-xl font-bold" />
            <div className="flex gap-3">
              <button onClick={() => setEditHorario(null)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button onClick={() => {
                setHorarios(prev => ({ ...prev, [editHorario.id]: editHorario.h }));
                setEditHorario(null);
              }} className="btn-primary btn-md flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal justificativa */}
      {justModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4" onClick={() => setJustModal(null)}>
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-900 mb-3">Justificar remoção</p>
            <p className="text-sm text-slate-600 mb-3">{justModal.razao_social}</p>
            <select value={justText} onChange={e => setJustText(e.target.value)} className="input mb-3">
              <option value="">Selecione a justificativa...</option>
              {(justificativas as any[]).map((j: any) => <option key={j.id} value={j.nome}>{j.nome}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setJustModal(null)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button onClick={() => mutRemover.mutate({ itemId: justModal.id, just: justText })}
                disabled={!justText} className="btn-primary btn-md flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgendaPage() {
  const { usuario } = useAuthStore();
  const qc = useQueryClient();
  const papel = usuario?.papel || "";
  const isCS = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel);
  const isESN = papel === "ESN";

  const [mesAtual, setMesAtual] = useState(new Date());
  const [esnSelecionado, setEsnSelecionado] = useState<string>("");
  const [agendaAberta, setAgendaAberta] = useState<any>(null);
  const [esnExpandido, setEsnExpandido] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  const mes = mesAtual.getMonth() + 1;
  const ano = mesAtual.getFullYear();

  // Buscar ESNs da equipe (CS/GSN)
  const { data: esns = [] } = useQuery({
    queryKey: ["agenda-esns"],
    queryFn: () => api.get("/api/v1/agenda/esns").then(r => r.data),
    enabled: isCS,
  });

  // Buscar agendas
  const { data: agendas = [], isLoading } = useQuery({
    queryKey: ["agendas", mes, ano, esnSelecionado],
    queryFn: () => api.get("/api/v1/agenda/lista", {
      params: { mes, ano, esn_id: esnSelecionado || undefined }
    }).then(r => r.data),
  });

  async function publicarTudo(esnId: string) {
    if (!confirm("Publicar todas as pré-agendas deste mês para este executivo?")) return;
    try {
      const res = await api.post("/api/v1/agenda/publicar-tudo", {
        esn_id: esnId, mes, ano
      });
      toast.success(`${res.data.publicadas} agenda${res.data.publicadas !== 1 ? "s" : ""} publicada${res.data.publicadas !== 1 ? "s" : ""}!`);
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Erro ao publicar.");
    }
  }

  async function excluirPreAgenda() {
    if (!esnSelecionado && isCS) { toast.error("Selecione um ESN."); return; }
    const esn = esnSelecionado || (isESN ? usuario?.id : "");
    if (!confirm("Excluir todas as pré-agendas deste mês para este executivo?")) return;
    try {
      await api.delete("/api/v1/agenda/pre-agenda", {
        params: { esn_id: esn, mes, ano }
      });
      toast.success("Pré-agendas excluídas!");
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Erro ao excluir.");
    }
  }

  async function gerarAgenda() {
    setGerando(true);
    try {
      const esn = esnSelecionado || (isESN ? usuario?.id : "");
      if (!esn && isCS) { toast.error("Selecione um ESN."); return; }
      // Gerar para o mês visualizado atualmente
      const dataInicio = format(startOfMonth(mesAtual), "yyyy-MM-dd");
      const res = await api.post("/api/v1/agenda/gerar-ciclo", {
        esn_id: esn,
        data_inicio: dataInicio,
      });
      toast.success(`${res.data.total} visitas geradas em ${res.data.dias} dias!`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["agendas"], exact: false }), 100);
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Erro ao gerar agenda.");
    } finally {
      setGerando(false);
    }
  }

  // Agrupar agendas por ESN
  const porESN: Record<string, any[]> = {};
  (agendas as any[]).forEach(ag => {
    const key = `${ag.vendedor_id}|${ag.vendedor_nome}|${ag.codigo_externo}`;
    if (!porESN[key]) porESN[key] = [];
    porESN[key].push(ag);
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Agenda de Visitas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isCS ? "Gerencie e publique agendas dos executivos" : "Suas visitas agendadas"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={excluirPreAgenda}
            className="btn-secondary btn-sm">
            <Trash2 className="w-3.5 h-3.5" /> Excluir pré-agenda
          </button>
          <button onClick={gerarAgenda} disabled={gerando}
            className="btn-primary btn-sm">
            <Zap className="w-3.5 h-3.5" />
            {gerando ? "Gerando..." : "Gerar agenda"}
          </button>
        </div>
      </div>

      {/* Navegação de mês + filtro ESN */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <button onClick={() => setMesAtual(subMonths(mesAtual, 1))}
            className="text-slate-400 hover:text-slate-600">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 w-32 text-center capitalize">
            {format(mesAtual, "MMMM yyyy", { locale: ptBR })}
          </span>
          <button onClick={() => setMesAtual(addMonths(mesAtual, 1))}
            className="text-slate-400 hover:text-slate-600">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {isCS && (esns as any[]).length > 0 && (
          <select value={esnSelecionado} onChange={e => setEsnSelecionado(e.target.value)}
            className="input flex-1 min-w-40 max-w-xs">
            <option value="">Todos os executivos</option>
            {(esns as any[]).map((e: any) => (
              <option key={e.id} value={e.id}>{e.nome} · {e.codigo_externo}</option>
            ))}
          </select>
        )}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <p className="text-center py-12 text-slate-400">Carregando...</p>
      ) : (agendas as any[]).length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
          <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">Nenhuma agenda para este período</p>
          <p className="text-slate-300 text-sm mt-1">Clique em "Gerar agenda" para criar automaticamente</p>
        </div>
      ) : isCS ? (
        /* Visão CS/GSN — cards expansíveis por ESN */
        <div className="space-y-3">
          {Object.entries(porESN).map(([key, ags]) => {
            const [, nome, cod] = key.split("|");
            const totalVisitas = ags.reduce((s, a) => s + (a.total_itens || 0), 0);
            const totalConcluidas = ags.reduce((s, a) => s + (a.concluidos || 0), 0);
            const publicadas = ags.filter(a => a.publicada).length;
            const expandido = esnExpandido === key;
            return (
              <div key={key} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 hover:bg-slate-50 transition-colors">
                  <button onClick={() => setEsnExpandido(expandido ? null : key)}
                    className="flex items-center gap-3 flex-1 text-left">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                      {nome.split(" ").slice(0,2).map((n:string) => n[0]).join("")}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900 text-sm">{nome}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{cod} · {totalVisitas} visitas · {ags.length} dias · {publicadas} publicados · {totalConcluidas} concluídas</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${expandido ? "rotate-180" : ""}`} />
                  </button>
                  {ags.some(a => !a.publicada) && (
                    <button onClick={() => publicarTudo(key.split("|")[0])}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 flex-shrink-0">
                      <Send className="w-3 h-3" /> Publicar tudo
                    </button>
                  )}
                </div>
                {expandido && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {ags.map((ag: any) => (
                      <div key={ag.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-slate-800">
                              {format(new Date(ag.data + "T12:00:00"), "EEE, d 'de' MMM", { locale: ptBR })}
                            </p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>
                              {statusLabel(ag.status)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{ag.total_itens} visita{ag.total_itens !== 1 ? "s" : ""} · {ag.concluidos} concluída{ag.concluidos !== 1 ? "s" : ""}</p>
                        </div>
                        <button onClick={() => setAgendaAberta(ag)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Visão ESN — lista de dias */
        <div className="space-y-3">
          {(agendas as any[]).map((ag: any) => (
            <div key={ag.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-slate-900 capitalize">
                    {format(new Date(ag.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}
                  </p>
                  <p className="text-xs text-slate-400">{ag.total_itens} visitas · {ag.concluidos} concluídas</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>
                    {ag.status || "PRÉ-AGENDA"}
                  </span>
                  <button onClick={() => setAgendaAberta(ag)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de itens */}
      {agendaAberta && (
        <ModalItens agenda={agendaAberta} onClose={() => setAgendaAberta(null)} />
      )}
    </div>
  );
}
