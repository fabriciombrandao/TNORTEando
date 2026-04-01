import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../store/auth";
import toast from "react-hot-toast";
import {
  CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Zap,
  CheckCircle, Circle, Clock, MapPin, Send, Trash2, X, Eye,
  Users
} from "lucide-react";
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isToday
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Tipos e helpers ──────────────────────────────────────────────

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

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  useEffect(() => {
    const h = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isDesktop;
}

// ─── Modal de itens do dia ────────────────────────────────────────

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
  const { data: params } = useQuery({
    queryKey: ["agenda-params-horario", agenda.id],
    queryFn: () => api.get(`/api/v1/agenda/${agenda.id}/parametros-horario`).then(r => r.data),
    enabled: !agenda.publicada,
  });
  const { data: justificativas = [] } = useQuery({
    queryKey: ["cadastro", "justificativas_agenda"],
    queryFn: () => api.get("/api/v1/cadastros/justificativas_agenda").then(r => r.data),
  });

  const itensAtivos = (itens as any[]).filter(i => i.status !== "CANCELADO");

  if (!inicializado && itensAtivos.length > 0 && params) {
    const novos: Record<string, string> = {};
    itensAtivos.forEach(item => { novos[item.id] = item.horario_previsto || ""; });
    setHorarios(novos);
    setSelecionados(new Set(itensAtivos.map(i => i.id)));
    setInicializado(true);
  }

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

  const podeEditar = ["ADMIN","GESTOR_EMPRESA","CS","GSN"].includes(papel) && !agenda.publicada;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="font-bold text-slate-900">{agenda.vendedor_nome} · {agenda.codigo_externo}</p>
            <p className="text-xs text-slate-400">
              {format(new Date(agenda.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })} · {agenda.total_itens} visitas
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
          {isLoading ? (
            <p className="text-center py-8 text-slate-400">Carregando...</p>
          ) : itensAtivos.length === 0 ? (
            <p className="text-center py-8 text-slate-400">Nenhuma visita agendada.</p>
          ) : itensAtivos.map((item: any) => {
            const sel = selecionados.has(item.id);
            const h = horarios[item.id] || item.horario_previsto || "";
            return (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${!sel && podeEditar ? "opacity-50" : ""}`}>
                {podeEditar && (
                  <button onClick={() => setSelecionados(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${sel ? "bg-indigo-600 border-indigo-600" : "border-slate-300"}`}>
                    {sel && <CheckCircle className="w-3 h-3 text-white" />}
                  </button>
                )}
                {podeEditar ? (
                  <button onClick={() => setEditHorario({ id: item.id, h })}
                    className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg w-14 text-center flex-shrink-0 hover:bg-indigo-100">
                    {h || "--:--"}
                  </button>
                ) : h ? <span className="text-xs text-slate-400 w-14 text-center flex-shrink-0">{h}</span> : null}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{item.razao_social}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.municipio && <span className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="w-3 h-3" />{item.municipio}</span>}
                    {item.classificacao_abc && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.classificacao_abc === "A" ? "bg-emerald-50 text-emerald-700" : item.classificacao_abc === "B" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                        {item.classificacao_abc}
                      </span>
                    )}
                    {item.publicado && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">Publicado</span>}
                  </div>
                </div>
                {podeEditar && (
                  <button onClick={() => setJustModal(item)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {podeEditar && itensAtivos.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setSelecionados(new Set(itensAtivos.map((i: any) => i.id)))} className="text-xs text-indigo-600 hover:underline">Todos</button>
              <button onClick={() => setSelecionados(new Set())} className="text-xs text-slate-400 hover:underline">Limpar</button>
            </div>
            <button onClick={() => mutPublicar.mutate()} disabled={selecionados.size === 0 || mutPublicar.isPending}
              className="btn-primary btn-md w-full">
              <Send className="w-4 h-4" />
              {mutPublicar.isPending ? "Publicando..." : `Publicar selecionados (${selecionados.size})`}
            </button>
          </div>
        )}
      </div>

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
              <button onClick={() => mutRemover.mutate({ itemId: justModal.id, just: justText })} disabled={!justText}
                className="btn-primary btn-md flex-1">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vista de calendário (desktop) ───────────────────────────────

function CalendarioView({ mesAtual, setMesAtual, esns, esnSelecionado, setEsnSelecionado, agendas, isLoading, gerarAgenda, excluirPreAgenda, publicarTudo, gerando }: any) {
  const [diaSelecionado, setDiaSelecionado] = useState<any>(null);

  const inicioMes = startOfMonth(mesAtual);
  const fimMes = endOfMonth(mesAtual);
  const inicioGrade = startOfWeek(inicioMes, { weekStartsOn: 0 });
  const fimGrade = endOfWeek(fimMes, { weekStartsOn: 0 });
  const dias = eachDayOfInterval({ start: inicioGrade, end: fimGrade });

  // Indexar agendas por data
  const agPorData: Record<string, any[]> = {};
  (agendas as any[]).forEach((ag: any) => {
    const d = ag.data.slice(0, 10);
    if (!agPorData[d]) agPorData[d] = [];
    agPorData[d].push(ag);
  });

  const DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

  // Agendas do dia selecionado
  const agendasDia = diaSelecionado ? (agPorData[format(diaSelecionado, "yyyy-MM-dd")] || []) : [];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Sidebar ESNs */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Executivos</p>
          <button onClick={() => setEsnSelecionado("")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs font-semibold transition-colors ${!esnSelecionado ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>
            <Users className="w-3.5 h-3.5" /> Todos
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {(esns as any[]).map((e: any) => {
            const ags = (agendas as any[]).filter(a => a.vendedor_id === e.id);
            const total = ags.reduce((s: number, a: any) => s + (a.total_itens || 0), 0);
            const pub = ags.filter((a: any) => a.publicada).length;
            return (
              <button key={e.id} onClick={() => setEsnSelecionado(e.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors ${esnSelecionado === e.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                  {e.nome.split(" ").slice(0,2).map((n: string) => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{e.nome.split(" ")[0]}</p>
                  <p className="text-xs text-slate-400">{total}v · {pub}pub</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grade do calendário */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Barra de controles */}
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => setMesAtual(subMonths(mesAtual, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-slate-900 w-36 text-center capitalize">
              {format(mesAtual, "MMMM yyyy", { locale: ptBR })}
            </span>
            <button onClick={() => setMesAtual(addMonths(mesAtual, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 ml-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-400 inline-block"></span>Pré-agenda</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500 inline-block"></span>Publicada</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-slate-400 inline-block"></span>Concluída</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={excluirPreAgenda} className="btn-secondary btn-sm text-xs">
              <Trash2 className="w-3 h-3" /> Excluir pré
            </button>
            {esnSelecionado && (
              <button onClick={() => publicarTudo(esnSelecionado)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100">
                <Send className="w-3 h-3" /> Publicar tudo
              </button>
            )}
            <button onClick={gerarAgenda} disabled={gerando} className="btn-primary btn-sm text-xs">
              <Zap className="w-3 h-3" /> {gerando ? "Gerando..." : "Gerar agenda"}
            </button>
          </div>
        </div>

        {/* Cabeçalho dias da semana */}
        <div className="grid grid-cols-7 bg-white border-b border-slate-200">
          {DIAS_SEMANA.map((d, i) => (
            <div key={d} className={`py-2 text-center text-xs font-bold uppercase tracking-wide ${i === 0 || i === 6 ? "text-slate-300" : "text-slate-400"}`}>{d}</div>
          ))}
        </div>

        {/* Grade */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-slate-400">Carregando...</div>
          ) : (
            <div className="grid grid-cols-7 gap-px bg-slate-200 h-full">
              {dias.map(dia => {
                const dStr = format(dia, "yyyy-MM-dd");
                const agsDodia = agPorData[dStr] || [];
                const emMes = isSameMonth(dia, mesAtual);
                const hoje = isToday(dia);
                const fdSemana = dia.getDay() === 0 || dia.getDay() === 6;
                const selecionado = diaSelecionado && format(diaSelecionado, "yyyy-MM-dd") === dStr;

                return (
                  <div key={dStr}
                    onClick={() => setDiaSelecionado(agsDodia.length > 0 ? dia : null)}
                    className={`bg-white p-1.5 min-h-[90px] cursor-pointer transition-colors
                      ${!emMes ? "opacity-40" : ""}
                      ${fdSemana ? "bg-slate-50" : ""}
                      ${selecionado ? "ring-2 ring-inset ring-indigo-500" : "hover:bg-indigo-50/30"}
                    `}>
                    <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full
                      ${hoje ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                      {format(dia, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {agsDodia.slice(0, 3).map((ag: any) => (
                        <div key={ag.id} className={`text-xs px-1.5 py-0.5 rounded font-medium truncate
                          ${!ag.publicada ? "bg-amber-100 text-amber-800" : ag.concluidos === ag.total_itens && ag.total_itens > 0 ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-800"}`}>
                          {ag.total_itens}v
                          {ag.vendedor_nome && !esnSelecionado ? ` · ${ag.vendedor_nome.split(" ")[0]}` : ""}
                        </div>
                      ))}
                      {agsDodia.length > 3 && <div className="text-xs text-slate-400 pl-1">+{agsDodia.length - 3}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Painel lateral direito */}
      {diaSelecionado && agendasDia.length > 0 && (
        <div className="w-72 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900 capitalize">
                {format(diaSelecionado, "EEE, d 'de' MMMM", { locale: ptBR })}
              </p>
              <p className="text-xs text-slate-400">{agendasDia.reduce((s: number, a: any) => s + (a.total_itens || 0), 0)} visitas</p>
            </div>
            <button onClick={() => setDiaSelecionado(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {agendasDia.map((ag: any) => (
              <div key={ag.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-bold text-slate-800">{ag.vendedor_nome}</p>
                    <p className="text-xs text-slate-400">{ag.codigo_externo}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>
                    {statusLabel(ag.status)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{ag.total_itens} visitas · {ag.concluidos} concluídas</p>
                <button onClick={() => setDiaSelecionado({ _agenda: ag, ...diaSelecionado })}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-semibold hover:bg-indigo-100"
                  onClick={() => { /* abrir modal */ }}>
                  <Eye className="w-3 h-3" /> Ver visitas
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const isDesktop = useIsDesktop();

  const [mesAtual, setMesAtual] = useState(new Date());
  const [esnSelecionado, setEsnSelecionado] = useState<string>("");
  const [agendaAberta, setAgendaAberta] = useState<any>(null);
  const [esnExpandido, setEsnExpandido] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  const mes = mesAtual.getMonth() + 1;
  const ano = mesAtual.getFullYear();

  const { data: esns = [] } = useQuery({
    queryKey: ["agenda-esns"],
    queryFn: () => api.get("/api/v1/agenda/esns").then(r => r.data),
    enabled: isCS,
  });

  const { data: agendas = [], isLoading } = useQuery({
    queryKey: ["agendas", mes, ano, esnSelecionado],
    queryFn: () => api.get("/api/v1/agenda/lista", {
      params: { mes, ano, esn_id: esnSelecionado || undefined }
    }).then(r => r.data),
  });

  async function publicarTudo(esnId: string) {
    if (!confirm("Publicar todas as pré-agendas deste mês?")) return;
    try {
      const res = await api.post("/api/v1/agenda/publicar-tudo", { esn_id: esnId, mes, ano });
      toast.success(`${res.data.publicadas} agenda${res.data.publicadas !== 1 ? "s" : ""} publicada${res.data.publicadas !== 1 ? "s" : ""}!`);
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro ao publicar."); }
  }

  async function excluirPreAgenda() {
    const esn = esnSelecionado || (isESN ? usuario?.id : "");
    if (!esn && isCS) { toast.error("Selecione um ESN."); return; }
    if (!confirm("Excluir todas as pré-agendas deste mês?")) return;
    try {
      await api.delete("/api/v1/agenda/pre-agenda", { params: { esn_id: esn, mes, ano } });
      toast.success("Pré-agendas excluídas!");
      qc.invalidateQueries({ queryKey: ["agendas"], exact: false });
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro."); }
  }

  async function gerarAgenda() {
    setGerando(true);
    try {
      const esn = esnSelecionado || (isESN ? usuario?.id : "");
      if (!esn && isCS) { toast.error("Selecione um ESN."); return; }
      const dataInicio = format(startOfMonth(mesAtual), "yyyy-MM-dd");
      const res = await api.post("/api/v1/agenda/gerar-ciclo", { esn_id: esn, data_inicio: dataInicio });
      toast.success(`${res.data.total} visitas geradas em ${res.data.dias} dias!`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["agendas"], exact: false }), 100);
    } catch (e: any) { toast.error(e.response?.data?.detail || "Erro ao gerar."); }
    finally { setGerando(false); }
  }

  const porESN: Record<string, any[]> = {};
  (agendas as any[]).forEach(ag => {
    const key = `${ag.vendedor_id}|${ag.vendedor_nome}|${ag.codigo_externo}`;
    if (!porESN[key]) porESN[key] = [];
    porESN[key].push(ag);
  });

  // Desktop + CS → grade de calendário
  if (isDesktop && isCS) {
    return (
      <>
        <CalendarioView
          mesAtual={mesAtual} setMesAtual={setMesAtual}
          esns={esns} esnSelecionado={esnSelecionado} setEsnSelecionado={setEsnSelecionado}
          agendas={agendas} isLoading={isLoading}
          gerarAgenda={gerarAgenda} excluirPreAgenda={excluirPreAgenda}
          publicarTudo={publicarTudo} gerando={gerando}
        />
        {agendaAberta && <ModalItens agenda={agendaAberta} onClose={() => setAgendaAberta(null)} />}
      </>
    );
  }

  // Mobile ou ESN → lista
  return (
    <div className="p-4 md:p-6 max-w-4xl animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Agenda de Visitas</h1>
          <p className="text-sm text-slate-500 mt-0.5">{isCS ? "Gerencie e publique agendas" : "Suas visitas agendadas"}</p>
        </div>
        {isCS && (
          <div className="flex items-center gap-2">
            <button onClick={excluirPreAgenda} className="btn-secondary btn-sm"><Trash2 className="w-3.5 h-3.5" /> Excluir pré</button>
            <button onClick={gerarAgenda} disabled={gerando} className="btn-primary btn-sm">
              <Zap className="w-3.5 h-3.5" /> {gerando ? "Gerando..." : "Gerar"}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <button onClick={() => setMesAtual(subMonths(mesAtual, 1))} className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-800 w-32 text-center capitalize">{format(mesAtual, "MMMM yyyy", { locale: ptBR })}</span>
          <button onClick={() => setMesAtual(addMonths(mesAtual, 1))} className="text-slate-400 hover:text-slate-600"><ChevronRight className="w-4 h-4" /></button>
        </div>
        {isCS && (esns as any[]).length > 0 && (
          <select value={esnSelecionado} onChange={e => setEsnSelecionado(e.target.value)} className="input flex-1 min-w-40 max-w-xs">
            <option value="">Todos</option>
            {(esns as any[]).map((e: any) => <option key={e.id} value={e.id}>{e.nome} · {e.codigo_externo}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="text-center py-12 text-slate-400">Carregando...</p>
      ) : (agendas as any[]).length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200">
          <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">Nenhuma agenda para este período</p>
        </div>
      ) : isCS ? (
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
                  <button onClick={() => setEsnExpandido(expandido ? null : key)} className="flex items-center gap-3 flex-1 text-left">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                      {nome.split(" ").slice(0,2).map((n:string) => n[0]).join("")}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900 text-sm">{nome}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{cod} · {totalVisitas} visitas · {ags.length} dias · {publicadas} pub · {totalConcluidas} concluídas</p>
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
                            <p className="text-sm font-medium text-slate-800">{format(new Date(ag.data + "T12:00:00"), "EEE, d 'de' MMM", { locale: ptBR })}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>{statusLabel(ag.status)}</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{ag.total_itens} visita{ag.total_itens !== 1 ? "s" : ""} · {ag.concluidos} concluída{ag.concluidos !== 1 ? "s" : ""}</p>
                        </div>
                        <button onClick={() => setAgendaAberta(ag)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
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
        <div className="space-y-3">
          {(agendas as any[]).map((ag: any) => (
            <div key={ag.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 capitalize">{format(new Date(ag.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
                  <p className="text-xs text-slate-400">{ag.total_itens} visitas · {ag.concluidos} concluídas</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[ag.status] || STATUS_BADGE.RASCUNHO}`}>{statusLabel(ag.status)}</span>
                  <button onClick={() => setAgendaAberta(ag)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {agendaAberta && <ModalItens agenda={agendaAberta} onClose={() => setAgendaAberta(null)} />}
    </div>
  );
}
