import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../store/auth";
import toast from "react-hot-toast";
import {
  CalendarDays, ChevronLeft, ChevronRight, Zap, Eye,
  CheckCircle, Circle, Clock, MapPin, Users, Send, Trash2, X
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

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["agenda-itens", agenda.id],
    queryFn: () => api.get(`/api/v1/agenda/${agenda.id}/itens`).then(r => r.data),
  });

  const { data: justificativas = [] } = useQuery({
    queryKey: ["cadastro", "justificativas_agenda"],
    queryFn: () => api.get("/api/v1/cadastros/justificativas_agenda").then(r => r.data),
  });

  const mutPublicar = useMutation({
    mutationFn: () => api.post(`/api/v1/agenda/${agenda.id}/publicar`).then(r => r.data),
    onSuccess: () => {
      toast.success("Agenda publicada!");
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
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
      setJustModal(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  const podeEditar = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel) && !agenda.publicada;

  // Agrupar por dia
  const porDia: Record<string, any[]> = {};
  (itens as any[]).forEach(item => {
    if (!porDia[item.data || agenda.data]) porDia[item.data || agenda.data] = [];
    porDia[item.data || agenda.data].push(item);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="font-bold text-slate-900">{agenda.vendedor_nome} · {agenda.codigo_externo}</p>
            <p className="text-xs text-slate-400">{agenda.total_itens} visitas · {format(new Date(agenda.data + "T12:00:00"), "MMMM yyyy", { locale: ptBR })}</p>
          </div>
          <div className="flex items-center gap-2">
            {podeEditar && (
              <button onClick={() => mutPublicar.mutate()}
                className="btn-primary btn-sm">
                <Send className="w-3.5 h-3.5" /> Publicar
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {isLoading ? (
            <p className="text-center py-8 text-slate-400">Carregando...</p>
          ) : (itens as any[]).length === 0 ? (
            <p className="text-center py-8 text-slate-400">Nenhuma visita agendada.</p>
          ) : (
            (itens as any[]).map((item: any) => (
              <div key={item.id} className={`flex items-start gap-3 py-3 border-b border-slate-50 last:border-0 ${item.status === "CANCELADO" ? "opacity-40" : ""}`}>
                <div className={`mt-0.5 flex-shrink-0 ${STATUS_ITEM[item.status] || "text-slate-400"}`}>
                  {item.status === "CONCLUIDO" ? <CheckCircle className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{item.razao_social}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.municipio && <span className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="w-3 h-3" />{item.municipio}</span>}
                    {item.classificacao_abc && <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.classificacao_abc === "A" ? "bg-emerald-50 text-emerald-700" : item.classificacao_abc === "B" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                      {item.classificacao_abc}
                    </span>}
                    {item.horario_previsto && <span className="flex items-center gap-1 text-xs text-slate-400"><Clock className="w-3 h-3" />{item.horario_previsto}</span>}
                  </div>
                </div>
                {podeEditar && item.status !== "CANCELADO" && (
                  <button onClick={() => setJustModal(item)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

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
        /* Visão CS/GSN — por ESN */
        <div className="space-y-4">
          {Object.entries(porESN).map(([key, ags]) => {
            const [, nome, cod] = key.split("|");
            const totalVisitas = ags.reduce((s, a) => s + (a.total_itens || 0), 0);
            const publicadas = ags.filter(a => a.publicada).length;
            return (
              <div key={key} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                    {nome.split(" ").slice(0,2).map((n:string) => n[0]).join("")}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900 text-sm">{nome}</p>
                    <p className="text-xs text-slate-400">{cod} · {totalVisitas} visitas · {publicadas}/{ags.length} dias publicados</p>
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {ags.map((ag: any) => (
                    <div key={ag.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-800">
                            {format(new Date(ag.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}
                          </p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>
                            {ag.status || "PRÉ-AGENDA"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{ag.total_itens} visitas · {ag.concluidos} concluídas</p>
                      </div>
                      <button onClick={() => setAgendaAberta(ag)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
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
