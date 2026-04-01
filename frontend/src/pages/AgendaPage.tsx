import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../store/auth";
import toast from "react-hot-toast";
import {
  ChevronLeft, ChevronRight, Zap, CheckCircle,
  MapPin, Send, Trash2, X, Phone, MessageCircle
} from "lucide-react";
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, isSameDay
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Helpers ─────────────────────────────────────────────────────

type Visao = "mes" | "semana" | "dia";

function statusLabel(s: string | null) {
  if (!s || s === "RASCUNHO" || s === "PRE_AGENDA") return "Pré-Agenda";
  if (s === "PUBLICADA") return "Publicada";
  if (s === "ENCERRADA") return "Encerrada";
  return s;
}

function corStatus(s: string | null) {
  if (!s || s === "RASCUNHO" || s === "PRE_AGENDA") return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-400", dot: "bg-amber-400" };
  if (s === "PUBLICADA") return { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-500", dot: "bg-emerald-500" };
  return { bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-300", dot: "bg-slate-400" };
}

function minutosDesdeMeia(h: string): number {
  const [hh, mm] = (h || "08:00").split(":").map(Number);
  return hh * 60 + mm;
}

// ─── Modal de itens (detalhe do dia) ─────────────────────────────

function ModalItens({ agenda, onClose }: { agenda: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const papel = usuario?.papel || "";
  const [justModal, setJustModal] = useState<any>(null);
  const [justText, setJustText] = useState("");
  const [editHorario, setEditHorario] = useState<{ id: string; h: string } | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [horarios, setHorarios] = useState<Record<string, string>>({});
  const [inicializado, setInicializado] = useState(false);

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["agenda-itens", agenda.id],
    queryFn: () => api.get(`/api/v1/agenda/${agenda.id}/itens`).then(r => r.data),
  });
  const { data: justificativas = [] } = useQuery({
    queryKey: ["cadastro", "justificativas_agenda"],
    queryFn: () => api.get("/api/v1/cadastros/justificativas_agenda").then(r => r.data),
  });

  const itensAtivos = (itens as any[]).filter(i => i.status !== "CANCELADO");

  if (!inicializado && itensAtivos.length > 0) {
    const novos: Record<string, string> = {};
    itensAtivos.forEach(item => { novos[item.id] = item.horario_previsto || ""; });
    setHorarios(novos);
    setSelecionados(new Set(itensAtivos.map(i => i.id)));
    setInicializado(true);
  }

  const podeEditar = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel) && !agenda.publicada;

  const mutPublicar = useMutation({
    mutationFn: () => api.post(`/api/v1/agenda/${agenda.id}/publicar-itens`, {
      item_ids: Array.from(selecionados), horarios,
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

  return (
    <div className="fixed inset-0 z-50 bg-f1f5f9 flex flex-col" style={{ background: "#f1f5f9" }}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="font-bold text-slate-900 text-sm">{agenda.vendedor_nome} · {agenda.codigo_externo}</p>
          <p className="text-xs text-slate-400">
            {format(new Date(agenda.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })} · {agenda.total_itens} visitas
          </p>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <p className="text-center py-8 text-slate-400">Carregando...</p>
        ) : itensAtivos.length === 0 ? (
          <p className="text-center py-8 text-slate-400">Nenhuma visita agendada.</p>
        ) : itensAtivos.map((item: any) => {
          const sel = selecionados.has(item.id);
          const h = horarios[item.id] || item.horario_previsto || "";
          const cor = corStatus(item.publicado ? "PUBLICADA" : null);
          return (
            <div key={item.id} className={`bg-white border-l-4 ${cor.border} rounded-2xl p-4 ${!sel && podeEditar ? "opacity-50" : ""}`}>
              <div className="flex items-start gap-3">
                {podeEditar && (
                  <button onClick={() => setSelecionados(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${sel ? "bg-indigo-600 border-indigo-600" : "border-slate-300"}`}>
                    {sel && <CheckCircle className="w-3 h-3 text-white" />}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  {podeEditar ? (
                    <button onClick={() => setEditHorario({ id: item.id, h })}
                      className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg mb-1 hover:bg-indigo-100">
                      {h || "--:--"}
                    </button>
                  ) : h ? <p className="text-xs font-bold text-indigo-600 mb-1">{h}</p> : null}
                  <p className="text-sm font-bold text-slate-900">{item.razao_social}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.municipio && <span className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="w-3 h-3" />{item.municipio}</span>}
                    {item.classificacao_abc && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.classificacao_abc === "A" ? "bg-emerald-50 text-emerald-700" : item.classificacao_abc === "B" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                        {item.classificacao_abc}
                      </span>
                    )}
                    {item.publicado && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">Publicado</span>}
                  </div>
                </div>
                {podeEditar && (
                  <button onClick={() => setJustModal(item)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {podeEditar && itensAtivos.length > 0 && (
        <div className="bg-white border-t border-slate-200 px-4 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setSelecionados(new Set(itensAtivos.map((i: any) => i.id)))} className="text-xs text-indigo-600 hover:underline">Selecionar todos</button>
            <button onClick={() => setSelecionados(new Set())} className="text-xs text-slate-400 hover:underline">Limpar</button>
          </div>
          <button onClick={() => mutPublicar.mutate()} disabled={selecionados.size === 0 || mutPublicar.isPending}
            className="btn-primary btn-md w-full">
            <Send className="w-4 h-4" />
            {mutPublicar.isPending ? "Publicando..." : `Publicar selecionados (${selecionados.size})`}
          </button>
        </div>
      )}

      {/* Modal horário */}
      {editHorario && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4" onClick={() => setEditHorario(null)}>
          <div className="w-full max-w-xs bg-white rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-900 mb-3">Definir horário</p>
            <input type="time" value={editHorario.h} onChange={e => setEditHorario({ ...editHorario, h: e.target.value })}
              className="input mb-4 text-center text-xl font-bold" />
            <div className="flex gap-3">
              <button onClick={() => setEditHorario(null)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button onClick={() => { setHorarios(prev => ({ ...prev, [editHorario.id]: editHorario.h })); setEditHorario(null); }}
                className="btn-primary btn-md flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal justificativa */}
      {justModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4" onClick={() => setJustModal(null)}>
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-900 mb-2">Justificar remoção</p>
            <p className="text-sm text-slate-600 mb-3">{justModal.razao_social}</p>
            <select value={justText} onChange={e => setJustText(e.target.value)} className="input mb-3">
              <option value="">Selecione...</option>
              {(justificativas as any[]).map((j: any) => <option key={j.id} value={j.nome}>{j.nome}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setJustModal(null)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button onClick={() => mutRemover.mutate({ itemId: justModal.id, just: justText })} disabled={!justText}
                className="btn-primary btn-md flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Visão Mês ────────────────────────────────────────────────────

function VisaoMes({ mesAtual, agendas, onDiaClick }: any) {
  const inicio = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
  const fim = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
  const dias = eachDayOfInterval({ start: inicio, end: fim });

  const agPorData: Record<string, any[]> = {};
  (agendas as any[]).forEach((ag: any) => {
    const d = ag.data.slice(0, 10);
    if (!agPorData[d]) agPorData[d] = [];
    agPorData[d].push(ag);
  });

  const DOWS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Cabeçalho dias da semana */}
      <div className="grid grid-cols-7 bg-white border-b border-slate-200">
        {DOWS.map((d, i) => (
          <div key={d} className={`py-2 text-center text-xs font-bold uppercase tracking-wide ${i === 0 || i === 6 ? "text-slate-300" : "text-slate-400"}`}>{d}</div>
        ))}
      </div>
      {/* Grade */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7 gap-px bg-slate-200" style={{ minHeight: "100%" }}>
          {dias.map(dia => {
            const dStr = format(dia, "yyyy-MM-dd");
            const ags = agPorData[dStr] || [];
            const emMes = isSameMonth(dia, mesAtual);
            const hoje = isToday(dia);
            const fds = dia.getDay() === 0 || dia.getDay() === 6;
            return (
              <div key={dStr} onClick={() => ags.length > 0 && onDiaClick(ags[0])}
                className={`bg-white min-h-24 p-1.5 ${!emMes ? "opacity-40" : ""} ${fds ? "bg-slate-50" : ""} ${ags.length > 0 ? "cursor-pointer hover:bg-indigo-50/30" : ""}`}>
                <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full
                  ${hoje ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                  {format(dia, "d")}
                </div>
                <div className="space-y-0.5">
                  {ags.slice(0, 1).map((ag: any) => {
                    const cor = corStatus(ag.status);
                    const itens = (ag.itens_resumo || []).slice(0, 3);
                    return (
                      <div key={ag.id}>
                        {itens.map((it: any, i: number) => (
                          <div key={i} className={`text-xs px-1.5 py-0.5 rounded mb-0.5 truncate border-l-2 ${cor.border} ${cor.bg} ${cor.text}`}>
                            {it.horario && <span className="font-bold">{it.horario} </span>}
                            {it.razao_social.split(" ")[0]}
                          </div>
                        ))}
                        {(ag.itens_resumo || []).length > 3 && (
                          <div className="text-xs text-slate-400 pl-1">+{(ag.itens_resumo || []).length - 3} mais</div>
                        )}
                      </div>
                    );
                  })}
                  {ags.length > 1 && <div className="text-xs text-slate-400 pl-1">+{ags.length - 1} dias</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Visão Semana ─────────────────────────────────────────────────

function VisaoSemana({ dataAtual, agendas, onDiaClick }: any) {
  const inicio = startOfWeek(dataAtual, { weekStartsOn: 0 });
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const HORAS = Array.from({ length: 10 }, (_, i) => i + 8); // 08:00 a 17:00
  const PX_HORA = 64;
  const HORA_BASE = 8 * 60;

  const agPorData: Record<string, any[]> = {};
  (agendas as any[]).forEach((ag: any) => {
    const d = ag.data.slice(0, 10);
    if (!agPorData[d]) agPorData[d] = [];
    agPorData[d].push(ag);
  });

  const itensPorData: Record<string, any[]> = {};

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Cabeçalho dias */}
      <div className="flex bg-white border-b border-slate-200 flex-shrink-0">
        <div className="w-12 flex-shrink-0" />
        {dias.map(dia => {
          const hoje = isToday(dia);
          const fds = dia.getDay() === 0 || dia.getDay() === 6;
          const dStr = format(dia, "yyyy-MM-dd");
          const ags = agPorData[dStr] || [];
          return (
            <div key={dStr} onClick={() => ags.length > 0 && onDiaClick(ags[0])}
              className={`flex-1 py-2 text-center border-l border-slate-100 ${ags.length > 0 ? "cursor-pointer hover:bg-indigo-50/30" : ""}`}>
              <div className={`text-xs font-bold uppercase ${fds ? "text-slate-300" : "text-slate-400"}`}>
                {format(dia, "EEE", { locale: ptBR })}
              </div>
              <div className={`text-sm font-bold mx-auto w-7 h-7 flex items-center justify-center rounded-full mt-0.5
                ${hoje ? "bg-indigo-600 text-white" : fds ? "text-slate-300" : "text-slate-700"}`}>
                {format(dia, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grade de horários */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Coluna de horas */}
          <div className="w-12 flex-shrink-0 bg-white border-r border-slate-200">
            {HORAS.map(h => (
              <div key={h} style={{ height: PX_HORA }} className="flex items-start justify-end pr-2 pt-1 border-b border-slate-100">
                <span className="text-xs text-slate-400 font-semibold">{h}:00</span>
              </div>
            ))}
          </div>

          {/* Colunas dos dias */}
          {dias.map(dia => {
            const fds = dia.getDay() === 0 || dia.getDay() === 6;
            const dStr = format(dia, "yyyy-MM-dd");
            const ags = agPorData[dStr] || [];

            return (
              <div key={dStr} className={`flex-1 border-l border-slate-100 relative ${fds ? "bg-slate-50/50" : "bg-white"}`}
                style={{ minHeight: HORAS.length * PX_HORA }}>
                {/* Linhas de hora */}
                {HORAS.map(h => (
                  <div key={h} style={{ height: PX_HORA }}
                    className={`border-b ${h === 12 || h === 13 ? "border-orange-100 bg-orange-50/30" : "border-slate-100"}`}>
                    {h === 12 && <span className="text-xs text-orange-400 font-semibold pl-1 pt-0.5 absolute">almoço</span>}
                  </div>
                ))}

                {/* Eventos */}
                {ags.map((ag: any) => {
                  // Buscar itens em cache ou usar placeholder
                  const cor = corStatus(ag.status);
                  const h = ag.primeiro_horario || "08:00";
                  const top = (minutosDesdeMeia(h) - HORA_BASE) / 60 * PX_HORA;
                  return (
                    <div key={ag.id} onClick={(e) => { e.stopPropagation(); onDiaClick(ag); }}
                      className={`absolute left-1 right-1 rounded-lg px-1.5 py-1 cursor-pointer border-l-2 ${cor.bg} ${cor.border} hover:opacity-80 overflow-hidden`}
                      style={{ top: Math.max(0, top), minHeight: 22 }}>
                      {(ag.itens_resumo || []).slice(0, 4).map((it: any, i: number) => (
                        <div key={i} className={`text-xs font-semibold truncate ${cor.text}`}>
                          {it.horario && <span className="font-bold">{it.horario} </span>}
                          {it.razao_social.split(" ")[0]}
                        </div>
                      ))}
                      {(ag.itens_resumo || []).length > 4 && (
                        <div className={`text-xs ${cor.text} opacity-60`}>+{(ag.itens_resumo || []).length - 4}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Visão Dia ────────────────────────────────────────────────────

function VisaoDia({ dataAtual, agendas, onItemClick }: any) {
  const dStr = format(dataAtual, "yyyy-MM-dd");
  const agsHoje = (agendas as any[]).filter(ag => ag.data.slice(0, 10) === dStr);

  const { data: itensDia = [] } = useQuery({
    queryKey: ["agenda-itens-dia", agsHoje.map((a: any) => a.id).join(",")],
    queryFn: async () => {
      const todos: any[] = [];
      for (const ag of agsHoje) {
        const its = await api.get(`/api/v1/agenda/${ag.id}/itens`).then(r => r.data);
        todos.push(...its.filter((i: any) => i.status !== "CANCELADO").map((i: any) => ({ ...i, agenda: ag })));
      }
      return todos.sort((a, b) => (a.horario_previsto || "").localeCompare(b.horario_previsto || ""));
    },
    enabled: agsHoje.length > 0,
  });

  const HORAS = Array.from({ length: 10 }, (_, i) => i + 8);
  const PX_HORA = 80;
  const HORA_BASE = 8 * 60;

  return (
    <div className="flex-1 overflow-hidden flex">
      {/* Coluna de horas */}
      <div className="w-14 flex-shrink-0 bg-white border-r border-slate-200">
        {HORAS.map(h => (
          <div key={h} style={{ height: PX_HORA }} className="flex items-start justify-end pr-2 pt-1 border-b border-slate-100">
            <span className="text-xs text-slate-400 font-semibold">{String(h).padStart(2,"0")}:00</span>
          </div>
        ))}
      </div>

      {/* Coluna de eventos */}
      <div className="flex-1 overflow-y-auto bg-white relative">
        {HORAS.map(h => (
          <div key={h} style={{ height: PX_HORA }}
            className={`border-b ${h === 12 || h === 13 ? "border-orange-100 bg-orange-50/20" : "border-slate-100"}`}>
            {h === 12 && <span className="text-xs text-orange-400 font-semibold pl-3 pt-1 block">🍽 Almoço</span>}
          </div>
        ))}

        {/* Eventos posicionados */}
        {(itensDia as any[]).map((item: any) => {
          const h = item.horario_previsto || "08:00";
          const top = Math.max(0, (minutosDesdeMeia(h) - HORA_BASE) / 60 * PX_HORA) + 4;
          const cor = corStatus(item.agenda?.status);
          return (
            <div key={item.id} onClick={() => onItemClick(item)}
              className={`absolute left-3 right-3 rounded-xl px-3 py-2 cursor-pointer border-l-4 ${cor.bg} ${cor.border} shadow-sm hover:shadow-md transition-shadow`}
              style={{ top, minHeight: 60 }}>
              <p className="text-xs font-bold text-slate-500 mb-0.5">{h} – {(() => {
                const [hh, mm] = h.split(":").map(Number);
                const fim = hh * 60 + mm + 45;
                return `${String(Math.floor(fim/60)).padStart(2,"0")}:${String(fim%60).padStart(2,"0")}`;
              })()}</p>
              <p className={`text-sm font-bold ${cor.text}`}>{item.razao_social}</p>
              <div className="flex items-center gap-2 mt-1">
                {item.municipio && <span className="text-xs text-slate-400">{item.municipio}</span>}
                {item.classificacao_abc && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.classificacao_abc === "A" ? "bg-emerald-100 text-emerald-700" : item.classificacao_abc === "B" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                    {item.classificacao_abc}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {agsHoje.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300">
            <p className="text-sm font-medium">Sem visitas neste dia</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tela 1: Lista de ESNs ────────────────────────────────────────

function TelaESNs({ esns, agendas, mes, ano, onESNClick, gerarAgenda, gerando }: any) {
  const porESN: Record<string, any> = {};
  (agendas as any[]).forEach((ag: any) => {
    if (!porESN[ag.vendedor_id]) porESN[ag.vendedor_id] = { total: 0, pub: 0, done: 0 };
    porESN[ag.vendedor_id].total += ag.total_itens || 0;
    porESN[ag.vendedor_id].pub += ag.publicada ? (ag.total_itens || 0) : 0;
    porESN[ag.vendedor_id].done += ag.concluidos || 0;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Agenda de Visitas</h1>
          <p className="text-xs text-slate-400 mt-0.5 capitalize">{format(new Date(ano, mes - 1), "MMMM yyyy", { locale: ptBR })} · Selecione um executivo</p>
        </div>
        <button onClick={gerarAgenda} disabled={gerando} className="btn-primary btn-sm">
          <Zap className="w-3.5 h-3.5" /> {gerando ? "Gerando..." : "Gerar"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(esns as any[]).length === 0 ? (
          <p className="text-center py-12 text-slate-400">Nenhum executivo encontrado.</p>
        ) : (esns as any[]).map((esn: any) => {
          const stats = porESN[esn.id] || { total: 0, pub: 0, done: 0 };
          const pre = stats.total - stats.pub;
          return (
            <div key={esn.id} onClick={() => onESNClick(esn)}
              className="bg-white border border-slate-200 rounded-2xl p-4 cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                {esn.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900">{esn.nome}</p>
                <p className="text-xs text-slate-400 mt-0.5">{esn.codigo_externo}
                  {esn.tipo_esn && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-xs font-semibold">
                      {({"BASE": "Base", "NOVOS": "Novos", "BASE_NOVOS": "Base+Novos"} as Record<string,string>)[esn.tipo_esn] || esn.tipo_esn}
                    </span>
                  )}
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {pre > 0 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{pre} pré-agenda{pre !== 1 ? "s" : ""}</span>}
                  {stats.pub > 0 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{stats.pub} publicada{stats.pub !== 1 ? "s" : ""}</span>}
                  {stats.done > 0 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{stats.done} concluída{stats.done !== 1 ? "s" : ""}</span>}
                  {stats.total === 0 && <span className="text-xs text-slate-300">Sem agendas</span>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tela 2: Calendário do ESN ────────────────────────────────────

function TelaCalendario({ esn, agendas, dataAtual, setDataAtual, visao, setVisao, onAgendaClick, onVoltar, publicarTudo, excluirPre, gerarAgenda, gerando }: any) {
  const mes = dataAtual.getMonth() + 1;
  const ano = dataAtual.getFullYear();

  function navAnterior() {
    if (visao === "mes") setDataAtual(subMonths(dataAtual, 1));
    else if (visao === "semana") setDataAtual(subWeeks(dataAtual, 1));
    else setDataAtual(subDays(dataAtual, 1));
  }
  function navProximo() {
    if (visao === "mes") setDataAtual(addMonths(dataAtual, 1));
    else if (visao === "semana") setDataAtual(addWeeks(dataAtual, 1));
    else setDataAtual(addDays(dataAtual, 1));
  }

  function labelNavegacao() {
    if (visao === "mes") return format(dataAtual, "MMMM yyyy", { locale: ptBR });
    if (visao === "semana") {
      const ini = startOfWeek(dataAtual, { weekStartsOn: 0 });
      const fim = endOfWeek(dataAtual, { weekStartsOn: 0 });
      return `${format(ini, "d MMM", { locale: ptBR })} – ${format(fim, "d MMM yyyy", { locale: ptBR })}`;
    }
    return format(dataAtual, "EEEE, d 'de' MMMM", { locale: ptBR });
  }

  const totalVisitas = (agendas as any[]).reduce((s: number, a: any) => s + (a.total_itens || 0), 0);
  const publicadas = (agendas as any[]).filter((a: any) => a.publicada).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onVoltar} className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 truncate">{esn.nome}</p>
          <p className="text-xs text-slate-400">{esn.codigo_externo} · {totalVisitas} visitas · {publicadas}/{(agendas as any[]).length} dias pub.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => excluirPre(esn.id)} className="flex items-center gap-1 px-2 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100">
            <Trash2 className="w-3 h-3" /> Excluir
          </button>
          <button onClick={() => publicarTudo(esn.id)} className="flex items-center gap-1 px-2 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100">
            <Send className="w-3 h-3" /> Pub. tudo
          </button>
          <button onClick={() => gerarAgenda(esn.id)} disabled={gerando} className="btn-primary btn-sm">
            <Zap className="w-3 h-3" /> {gerando ? "..." : "Gerar"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5">
          <button onClick={navAnterior} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-500">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold text-slate-800 w-36 text-center capitalize">{labelNavegacao()}</span>
          <button onClick={navProximo} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-500">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(["mes","semana","dia"] as Visao[]).map(v => (
            <button key={v} onClick={() => setVisao(v)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${visao === v ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {v === "mes" ? "Mês" : v === "semana" ? "Semana" : "Dia"}
            </button>
          ))}
        </div>
        <div className="flex gap-3 ml-auto">
          <span className="flex items-center gap-1 text-xs text-slate-400"><span className="w-2 h-2 rounded bg-amber-400 inline-block"></span>Pré</span>
          <span className="flex items-center gap-1 text-xs text-slate-400"><span className="w-2 h-2 rounded bg-emerald-500 inline-block"></span>Pub</span>
          <span className="flex items-center gap-1 text-xs text-slate-400"><span className="w-2 h-2 rounded bg-slate-400 inline-block"></span>Feito</span>
        </div>
      </div>

      {/* Grade */}
      {visao === "mes" && <VisaoMes mesAtual={dataAtual} agendas={agendas} onDiaClick={onAgendaClick} />}
      {visao === "semana" && <VisaoSemana dataAtual={dataAtual} agendas={agendas} onDiaClick={onAgendaClick} />}
      {visao === "dia" && <VisaoDia dataAtual={dataAtual} agendas={agendas} onItemClick={(item: any) => onAgendaClick(item.agenda)} />}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────

export default function AgendaPage() {
  const { usuario } = useAuthStore();
  const qc = useQueryClient();
  const papel = usuario?.papel || "";
  const isCS = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel);
  const isESN = papel === "ESN";

  // Telas: "esns" | "calendario" | "detalhe"
  const [tela, setTela] = useState<"esns"|"calendario"|"detalhe">(isCS ? "esns" : "calendario");
  const [esnSelecionado, setEsnSelecionado] = useState<any>(null);
  const [agendaAberta, setAgendaAberta] = useState<any>(null);
  const [dataAtual, setDataAtual] = useState(new Date());
  const [visao, setVisao] = useState<Visao>("mes");
  const [gerando, setGerando] = useState(false);

  const mes = dataAtual.getMonth() + 1;
  const ano = dataAtual.getFullYear();

  const { data: esns = [] } = useQuery({
    queryKey: ["agenda-esns"],
    queryFn: () => api.get("/api/v1/agenda/esns").then(r => r.data),
    enabled: isCS,
  });

  const esnId = esnSelecionado?.id || (isESN ? usuario?.id : "");
  const { data: agendas = [], isLoading } = useQuery({
    queryKey: ["agendas", mes, ano, esnId],
    queryFn: () => api.get("/api/v1/agenda/lista", { params: { mes, ano, esn_id: esnId || undefined } }).then(r => r.data),
    enabled: !!esnId || isCS,
  });

  async function gerarAgenda(forEsnId?: string) {
    setGerando(true);
    try {
      const esn = forEsnId || esnId;
      if (!esn) { toast.error("Selecione um executivo."); return; }
      const dataInicio = format(new Date(ano, mes - 1, 1), "yyyy-MM-dd");
      const res = await api.post("/api/v1/agenda/gerar-ciclo", { esn_id: esn, data_inicio: dataInicio });
      toast.success(`${res.data.total} visitas geradas!`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["agendas"], exact: false }), 100);
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro ao gerar."); }
    finally { setGerando(false); }
  }

  async function publicarTudo(forEsnId: string) {
    if (!confirm("Publicar todas as pré-agendas deste mês?")) return;
    try {
      const res = await api.post("/api/v1/agenda/publicar-tudo", { esn_id: forEsnId, mes, ano });
      toast.success(`${res.data.publicadas} agenda${res.data.publicadas !== 1 ? "s" : ""} publicada${res.data.publicadas !== 1 ? "s" : ""}!`);
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro."); }
  }

  async function excluirPre(forEsnId: string) {
    if (!confirm("Excluir todas as pré-agendas deste mês?")) return;
    try {
      await api.delete("/api/v1/agenda/pre-agenda", { params: { esn_id: forEsnId, mes, ano } });
      toast.success("Pré-agendas excluídas!");
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro."); }
  }

  // ESN vai direto para o calendário
  if (isESN && tela === "esns") setTela("calendario");

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ height: "calc(100vh - 64px)" }}>
      {/* Tela 1: Lista ESNs */}
      {tela === "esns" && (
        <TelaESNs
          esns={esns} agendas={agendas} mes={mes} ano={ano}
          onESNClick={(esn: any) => { setEsnSelecionado(esn); setTela("calendario"); }}
          gerarAgenda={() => gerarAgenda()} gerando={gerando}
        />
      )}

      {/* Tela 2: Calendário */}
      {tela === "calendario" && (
        <TelaCalendario
          esn={esnSelecionado || { nome: usuario?.nome || "", codigo_externo: usuario?.codigo_externo || "" }}
          agendas={agendas} dataAtual={dataAtual} setDataAtual={setDataAtual}
          visao={visao} setVisao={setVisao}
          onAgendaClick={(ag: any) => { setAgendaAberta(ag); setTela("detalhe"); }}
          onVoltar={() => isCS ? setTela("esns") : null}
          publicarTudo={publicarTudo} excluirPre={excluirPre}
          gerarAgenda={gerarAgenda} gerando={gerando}
        />
      )}

      {/* Tela 3: Detalhe do dia */}
      {tela === "detalhe" && agendaAberta && (
        <ModalItens agenda={agendaAberta} onClose={() => setTela("calendario")} />
      )}
    </div>
  );
}
