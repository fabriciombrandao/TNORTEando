import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAgendaHoje, getClientes, criarAgendaOtimizada } from "../services/api";
import type { Cliente } from "../types";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Zap, MapPin, Clock, CheckCircle, Circle } from "lucide-react";

const statusColor: Record<string, string> = {
  PENDENTE: "text-slate-400",
  CONCLUIDO: "text-emerald-400",
  CANCELADO: "text-red-400",
  REAGENDADO: "text-amber-400",
};

const statusIcon: Record<string, React.ReactNode> = {
  PENDENTE: <Circle className="w-4 h-4" />,
  CONCLUIDO: <CheckCircle className="w-4 h-4" />,
  CANCELADO: <Circle className="w-4 h-4" />,
  REAGENDADO: <Clock className="w-4 h-4" />,
};

export default function AgendaPage() {
  const qc = useQueryClient();
  const [gerandoRoteiro, setGerandoRoteiro] = useState(false);
  const [clientesSelecionados, setClientesSelecionados] = useState<string[]>([]);

  const { data: agenda, isLoading } = useQuery({
    queryKey: ["agenda-hoje"],
    queryFn: getAgendaHoje,
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes"],
    queryFn: getClientes,
  });

  const clientesMap = Object.fromEntries(
    (clientes as Cliente[]).map((c) => [c.id, c])
  );

  const mutRoteiro = useMutation({
    mutationFn: () => {
      return new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true })
      ).then((pos) =>
        criarAgendaOtimizada({
          data: format(new Date(), "yyyy-MM-dd"),
          cliente_ids: clientesSelecionados,
          lat_inicio: pos.coords.latitude,
          lng_inicio: pos.coords.longitude,
        })
      );
    },
    onSuccess: () => {
      toast.success("Roteiro otimizado gerado!");
      qc.invalidateQueries({ queryKey: ["agenda-hoje"] });
      setGerandoRoteiro(false);
      setClientesSelecionados([]);
    },
    onError: () => toast.error("Erro ao gerar roteiro."),
  });

  const toggleCliente = (id: string) => {
    setClientesSelecionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const hoje = format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Agenda de Hoje</h1>
          <p className="text-sm text-slate-400 mt-0.5 capitalize">{hoje}</p>
        </div>
        {!agenda?.agenda && (
          <button
            onClick={() => setGerandoRoteiro(!gerandoRoteiro)}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-400 text-white
                       text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Gerar Roteiro
          </button>
        )}
      </div>

      {/* Geração de roteiro */}
      {gerandoRoteiro && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 mb-6">
          <p className="text-sm font-medium text-white mb-3">Selecione os clientes para visitar hoje:</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto mb-4">
            {(clientes as Cliente[]).map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={clientesSelecionados.includes(c.id)}
                  onChange={() => toggleCliente(c.id)}
                  className="w-4 h-4 accent-indigo-500"
                />
                <div>
                  <p className="text-sm text-white">{c.razao_social}</p>
                  <p className="text-xs text-slate-500">
                    {c.municipio || "—"} · {c.lat ? "📍 com coords" : "sem coords"}
                  </p>
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => mutRoteiro.mutate()}
              disabled={clientesSelecionados.length === 0 || mutRoteiro.isPending}
              className="flex-1 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white
                         font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {mutRoteiro.isPending
                ? "Gerando..."
                : `Otimizar ${clientesSelecionados.length} visita(s)`}
            </button>
            <button
              onClick={() => setGerandoRoteiro(false)}
              className="px-4 py-2.5 text-sm text-slate-400 hover:text-white border border-slate-700
                         rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Agenda do dia */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Carregando...</div>
      ) : !agenda?.agenda ? (
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <CalendarDays className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400">Nenhuma agenda para hoje</p>
          <p className="text-xs text-slate-600 mt-1">Gere um roteiro otimizado para começar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agenda.agenda.itens.map((item: any, idx: number) => {
            const cliente = clientesMap[item.cliente_id];
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 transition-colors ${
                  item.status === "CONCLUIDO"
                    ? "border-emerald-500/20 bg-emerald-500/5 opacity-60"
                    : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-300">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white truncate">
                        {cliente?.razao_social || item.cliente_id}
                      </p>
                      <span className={`flex items-center gap-1 text-xs flex-shrink-0 ${statusColor[item.status]}`}>
                        {statusIcon[item.status]}
                        {item.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {item.horario_previsto && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="w-3 h-3" />
                          {item.horario_previsto}
                        </span>
                      )}
                      {cliente?.municipio && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="w-3 h-3" />
                          {cliente.municipio}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
