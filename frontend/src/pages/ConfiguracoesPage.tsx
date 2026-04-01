import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Save, RefreshCw } from "lucide-react";

const getParametros  = () => api.get("/api/v1/parametros").then(r => r.data);
const getExpediente  = () => api.get("/api/v1/expediente").then(r => r.data);
const salvarExpediente = (data: any) => api.put("/api/v1/expediente", data).then(r => r.data);

const DIAS = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const salvarParametros = (data: any) => api.put("/api/v1/parametros", data).then(r => r.data);

function Campo({ label, desc, value, onChange, prefix = "", suffix = "" }: {
  label: string; desc: string; value: number;
  onChange: (v: number) => void; prefix?: string; suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-24 text-right text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </div>
    </div>

  );
}

export default function ConfiguracoesPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["parametros"],
    queryFn: getParametros,
  });

  const [form, setForm] = useState({
    mrr_cliente_a: 5000,
    mrr_cliente_b: 1000,
    mrr_cliente_c: 100,
    meses_dormente: 18,
    visitas_por_dia_max: 4,
    raio_checkin_metros: 300,
    frequencia_padrao_dias: 30,
    freq_a_dias: 15,
    freq_b_dias: 30,
    freq_c_dias: 45,
    ciclo_dias: 45,
    horizonte_dias: 30,
    duracao_padrao_min: 45,
    intervalo_min: 15,
    visitas_manha_max: 1,
    visitas_tarde_max: 1,
    max_visitas_base_novos: 1,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: string) => (v: number) => setForm(f => ({ ...f, [key]: v }));

  const [confirmarRegenar, setConfirmarRegenar] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  const [esnsParaRegerar, setEsnsParaRegerar] = useState<any[]>([]);
  const [expediente, setExpediente] = useState(
    DIAS.map((_, i) => ({
      dia_semana: i,
      ativo: i >= 1 && i <= 5,
      manha_inicio: "08:00", manha_fim: "12:00",
      tarde_inicio: "14:00", tarde_fim: "18:00",
    }))
  );

  const { data: expedienteData } = useQuery({ queryKey: ["expediente"], queryFn: getExpediente });
  useEffect(() => { if (expedienteData) setExpediente(expedienteData); }, [expedienteData]);

  const mutExpediente = useMutation({
    mutationFn: () => salvarExpediente({ dias: expediente }),
    onSuccess: () => toast.success("Expediente salvo!"),
    onError: () => toast.error("Erro ao salvar expediente."),
  });

  const mut = useMutation({
    mutationFn: () => salvarParametros(form),
    onSuccess: async (res) => {
      toast.success(res.mensagem || "Parâmetros salvos!");
      qc.invalidateQueries({ queryKey: ["parametros"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      // Verificar se existem pré-agendas
      try {
        const mes = new Date().getMonth() + 1;
        const ano = new Date().getFullYear();
        const agendas = await api.get("/api/v1/agenda/lista", { params: { mes, ano } });
        const preAgendas = agendas.data.filter((a: any) => !a.publicada);
        if (preAgendas.length > 0) {
          // Coletar ESNs únicos com pré-agendas
          const esnsMap: Record<string, any> = {};
          preAgendas.forEach((a: any) => {
            esnsMap[a.vendedor_id] = { id: a.vendedor_id, nome: a.vendedor_nome, mes, ano };
          });
          setEsnsParaRegerar(Object.values(esnsMap));
          setConfirmarRegenar(true);
        }
      } catch {}
    },
    onError: () => toast.error("Erro ao salvar parâmetros."),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-slate-400 text-sm">Carregando...</p>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-2xl animate-fade-in">

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Configurações</h1>
        <p className="text-sm text-slate-500 mt-1">Parâmetros do sistema. Ao salvar, os clientes são reclassificados automaticamente.</p>
      </div>

      <div className="space-y-4">

        {/* Classificação ABC */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Classificação ABC por MRR</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              MRR mensal mínimo para cada classificação. Clientes abaixo do C são classificados como C.
            </p>
            <Campo label="Classe A" desc="MRR mensal mínimo para A"
              prefix="R$" value={form.mrr_cliente_a} onChange={set("mrr_cliente_a")} />
            <Campo label="Classe B" desc="MRR mensal mínimo para B"
              prefix="R$" value={form.mrr_cliente_b} onChange={set("mrr_cliente_b")} />
            <Campo label="Classe C" desc="MRR mensal mínimo para C"
              prefix="R$" value={form.mrr_cliente_c} onChange={set("mrr_cliente_c")} />
          </div>
        </div>

        {/* Clientes Dormentes */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Clientes Dormentes</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              Clientes sem nova compra por X meses são sinalizados como dormentes em vermelho.
            </p>
            <Campo label="Meses sem compra" desc="Quantidade de meses para considerar dormente"
              suffix="meses" value={form.meses_dormente} onChange={set("meses_dormente")} />
          </div>
        </div>

        {/* Visitas */}
        <div className="card">
          <div className="card-header">
            <span className="text-sm font-semibold text-slate-900">Regras de Visita</span>
          </div>
          <div className="card-body">
            <Campo label="Visitas por dia" desc="Máximo de visitas por executivo por dia"
              suffix="visitas" value={form.visitas_por_dia_max} onChange={set("visitas_por_dia_max")} />
            <Campo label="Visitas manhã" desc="Máximo de visitas no período da manhã por dia"
              suffix="visitas" value={form.visitas_manha_max} onChange={set("visitas_manha_max")} />
            <Campo label="Visitas tarde" desc="Máximo de visitas no período da tarde por dia"
              suffix="visitas" value={form.visitas_tarde_max} onChange={set("visitas_tarde_max")} />
            <Campo label="Base p/ ESN Novos" desc="Máximo de visitas de base por dia para executivos tipo Novos"
              suffix="visitas" value={form.max_visitas_base_novos} onChange={set("max_visitas_base_novos")} />
            <Campo label="Raio de check-in" desc="Distância máxima permitida para check-in"
              suffix="metros" value={form.raio_checkin_metros} onChange={set("raio_checkin_metros")} />
            <Campo label="Frequência padrão" desc="Dias padrão entre visitas quando não há regra específica"
              suffix="dias" value={form.frequencia_padrao_dias} onChange={set("frequencia_padrao_dias")} />
          </div>
        </div>

        {/* Frequência por ABC */}
        <div className="card">
          <div className="card-header">
            <span className="text-sm font-semibold text-slate-900">Frequência de Visitas por Classificação</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              Intervalo em dias entre visitas conforme a classificação ABC do cliente.
            </p>
            <Campo label="Classe A" desc="Visitar a cada X dias"
              suffix="dias" value={form.freq_a_dias} onChange={set("freq_a_dias")} />
            <Campo label="Classe B" desc="Visitar a cada X dias"
              suffix="dias" value={form.freq_b_dias} onChange={set("freq_b_dias")} />
            <Campo label="Classe C" desc="Visitar a cada X dias"
              suffix="dias" value={form.freq_c_dias} onChange={set("freq_c_dias")} />
          </div>
        </div>

        {/* Expediente semanal */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Expediente Semanal</span>
            <button onClick={() => mutExpediente.mutate()}
              disabled={mutExpediente.isPending}
              className="btn-secondary btn-sm text-xs">
              {mutExpediente.isPending ? "Salvando..." : "Salvar expediente"}
            </button>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              Define os dias e horários de trabalho. Agendas não serão geradas fora do expediente.
            </p>
            <div className="space-y-2">
              {expediente.map((dia, idx) => (
                <div key={idx} className={`rounded-xl border p-3 ${dia.ativo ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <button onClick={() => setExpediente(prev => prev.map((d, i) => i === idx ? { ...d, ativo: !d.ativo } : d))}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${dia.ativo ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"}`}>
                      {dia.ativo && <span className="text-xs font-bold">✓</span>}
                    </button>
                    <span className="text-sm font-semibold text-slate-800 w-20">{DIAS[dia.dia_semana]}</span>
                    {!dia.ativo && <span className="text-xs text-slate-400">Folga</span>}
                  </div>
                  {dia.ativo && (
                    <div className="flex items-center gap-2 ml-8 flex-wrap">
                      <input type="time" value={dia.manha_inicio}
                        onChange={e => setExpediente(prev => prev.map((d, i) => i === idx ? { ...d, manha_inicio: e.target.value } : d))}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400 w-24" />
                      <span className="text-xs text-slate-400">–</span>
                      <input type="time" value={dia.manha_fim}
                        onChange={e => setExpediente(prev => prev.map((d, i) => i === idx ? { ...d, manha_fim: e.target.value } : d))}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400 w-24" />
                      <span className="text-xs text-slate-300 mx-1">|</span>
                      <input type="time" value={dia.tarde_inicio}
                        onChange={e => setExpediente(prev => prev.map((d, i) => i === idx ? { ...d, tarde_inicio: e.target.value } : d))}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400 w-24" />
                      <span className="text-xs text-slate-400">–</span>
                      <input type="time" value={dia.tarde_fim}
                        onChange={e => setExpediente(prev => prev.map((d, i) => i === idx ? { ...d, tarde_fim: e.target.value } : d))}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400 w-24" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Duração e intervalo */}
        <div className="card">
          <div className="card-header">
            <span className="text-sm font-semibold text-slate-900">Duração das Visitas</span>
          </div>
          <div className="card-body">
            <Campo label="Duração média da visita" desc="Tempo estimado por visita"
              suffix="min" value={form.duracao_padrao_min} onChange={set("duracao_padrao_min")} />
            <Campo label="Intervalo entre visitas" desc="Tempo de deslocamento entre clientes"
              suffix="min" value={form.intervalo_min} onChange={set("intervalo_min")} />
          </div>
        </div>

        {/* Ciclo e horizonte */}
        <div className="card">
          <div className="card-header">
            <span className="text-sm font-semibold text-slate-900">Ciclo e Geração de Agenda</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              Parâmetros para geração automática da agenda de visitas.
            </p>
            <Campo label="Ciclo de visitas" desc="Prazo máximo para visitar toda a carteira"
              suffix="dias" value={form.ciclo_dias} onChange={set("ciclo_dias")} />
            <Campo label="Horizonte da agenda" desc="Quantos dias à frente gerar a agenda"
              suffix="dias" value={form.horizonte_dias} onChange={set("horizonte_dias")} />
          </div>
        </div>

        {/* Botão salvar */}
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="btn-primary btn-lg btn-full"
        >
          {mut.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Salvando e reclassificando...</>
            : <><Save className="w-4 h-4" /> Salvar parâmetros</>
          }
        </button>

      </div>

      {confirmarRegenar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
            <p className="font-bold text-slate-900 mb-2">Regenerar pré-agendas?</p>
            <p className="text-sm text-slate-500 mb-5">Existem pré-agendas geradas. Deseja gerá-las novamente com os novos parâmetros?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmarRegenar(false)}
                className="btn-secondary btn-md flex-1">Não</button>
              <button disabled={regenerando} onClick={async () => {
                setRegenerando(true);
                try {
                  const mes = new Date().getMonth() + 1;
                  const ano = new Date().getFullYear();
                  for (const esn of esnsParaRegerar) {
                    // Excluir pré-agendas
                    await api.delete("/api/v1/agenda/pre-agenda", { params: { esn_id: esn.id, mes, ano } });
                    // Gerar novas
                    const dataInicio = `${ano}-${String(mes).padStart(2,"0")}-01`;
                    await api.post("/api/v1/agenda/gerar-ciclo", { esn_id: esn.id, data_inicio: dataInicio });
                  }
                  toast.success(`${esnsParaRegerar.length} agenda${esnsParaRegerar.length !== 1 ? "s" : ""} regenerada${esnsParaRegerar.length !== 1 ? "s" : ""}!`);
                  setConfirmarRegenar(false);
                  window.location.href = "/agenda";
                } catch {
                  toast.error("Erro ao regenerar agendas.");
                } finally {
                  setRegenerando(false);
                }
              }}
                className="btn-primary btn-md flex-1">{regenerando ? "Regenerando..." : "Sim"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
