import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Save, RefreshCw } from "lucide-react";

const getParametros  = () => api.get("/api/v1/parametros").then(r => r.data);
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
    horario_inicio: "08:00",
    horario_fim: "18:00",
    duracao_padrao_min: 45,
    intervalo_min: 15,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: string) => (v: number) => setForm(f => ({ ...f, [key]: v }));

  const mut = useMutation({
    mutationFn: () => salvarParametros(form),
    onSuccess: (res) => {
      toast.success(res.mensagem || "Parâmetros salvos!");
      qc.invalidateQueries({ queryKey: ["parametros"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
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

        {/* Horários de visita */}
        <div className="card">
          <div className="card-header">
            <span className="text-sm font-semibold text-slate-900">Horários e Duração</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-slate-400 mb-3">
              Parâmetros usados para sugerir horários automaticamente ao publicar agendas.
            </p>
            <div className="flex items-center justify-between py-3 border-b border-slate-50 gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Horário de início</p>
                <p className="text-xs text-slate-400 mt-0.5">Primeira visita do dia</p>
              </div>
              <input type="time" value={form.horario_inicio}
                onChange={e => setForm(f => ({ ...f, horario_inicio: e.target.value }))}
                className="w-32 text-right text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400" />
            </div>
            <div className="flex items-center justify-between py-3 border-b border-slate-50 gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Horário de término</p>
                <p className="text-xs text-slate-400 mt-0.5">Última visita do dia</p>
              </div>
              <input type="time" value={form.horario_fim}
                onChange={e => setForm(f => ({ ...f, horario_fim: e.target.value }))}
                className="w-32 text-right text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400" />
            </div>
            <Campo label="Duração média da visita" desc="Tempo estimado por visita"
              suffix="min" value={form.duracao_padrao_min} onChange={v => setForm(f => ({ ...f, duracao_padrao_min: v }))} />
            <Campo label="Intervalo entre visitas" desc="Tempo de deslocamento entre clientes"
              suffix="min" value={form.intervalo_min} onChange={v => setForm(f => ({ ...f, intervalo_min: v }))} />
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
    </div>
  );
}
