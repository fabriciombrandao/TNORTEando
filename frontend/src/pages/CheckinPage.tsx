import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClientes, checkin, checkout, getVisitaEmAndamento } from "../services/api";
import type { Cliente } from "../types";
import toast from "react-hot-toast";
import { MapPin, Clock, CheckCircle, XCircle, Search, Navigation } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function CheckinPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [observacoes, setObservacoes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localizando, setLocalizando] = useState(false);

  const { data: clientes = [] } = useQuery({ queryKey: ["clientes"], queryFn: getClientes });
  const { data: emAndamento, isLoading: loadingAndamento } = useQuery({
    queryKey: ["visita-em-andamento"],
    queryFn: getVisitaEmAndamento,
    refetchInterval: 30000,
  });

  const clientesFiltrados = (clientes as Cliente[]).filter((c) =>
    c.razao_social.toLowerCase().includes(busca.toLowerCase()) ||
    c.codigo_externo.toLowerCase().includes(busca.toLowerCase())
  );

  const obterLocalizacao = () => {
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocalizando(false);
        toast.success("Localização obtida!");
      },
      () => {
        toast.error("Não foi possível obter a localização.");
        setLocalizando(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => { obterLocalizacao(); }, []);

  const mutCheckin = useMutation({
    mutationFn: () =>
      checkin({ cliente_id: clienteSelecionado!.id, lat: coords!.lat, lng: coords!.lng }),
    onSuccess: () => {
      toast.success("Check-in realizado!");
      qc.invalidateQueries({ queryKey: ["visita-em-andamento"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro no check-in."),
  });

  const mutCheckout = useMutation({
    mutationFn: () =>
      checkout(emAndamento!.visita_id, { lat: coords!.lat, lng: coords!.lng, observacoes }),
    onSuccess: (data) => {
      toast.success(`Check-out feito! Duração: ${data.duracao_minutos} min`);
      qc.invalidateQueries({ queryKey: ["visita-em-andamento"] });
      setObservacoes("");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro no check-out."),
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-white mb-6">Check-in / Check-out</h1>

      {/* Localização */}
      <div className={`rounded-xl border p-4 mb-6 flex items-center gap-3 ${
        coords ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-700 bg-slate-800/50"
      }`}>
        <Navigation className={`w-5 h-5 flex-shrink-0 ${coords ? "text-emerald-400" : "text-slate-500"}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white">
            {coords ? "Localização obtida" : "Aguardando localização..."}
          </p>
          {coords && (
            <p className="text-xs text-slate-400 mt-0.5">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </p>
          )}
        </div>
        <button
          onClick={obterLocalizacao}
          disabled={localizando}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
        >
          {localizando ? "Obtendo..." : "Atualizar"}
        </button>
      </div>

      {/* Visita em andamento */}
      {emAndamento?.em_andamento && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-6">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Visita em andamento</p>
              <p className="text-xs text-slate-400 mt-1">
                Iniciada {formatDistanceToNow(new Date(emAndamento.checkin_em), {
                  addSuffix: true, locale: ptBR
                })}
              </p>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações da visita (opcional)..."
                rows={3}
                className="w-full mt-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5
                           text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
              <button
                onClick={() => mutCheckout.mutate()}
                disabled={!coords || mutCheckout.isPending}
                className="mt-3 w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white
                           font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                {mutCheckout.isPending ? "Registrando..." : "Fazer Check-out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seleção de cliente (só se não há visita em andamento) */}
      {!emAndamento?.em_andamento && (
        <>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setClienteSelecionado(null); }}
              placeholder="Buscar cliente por nome ou código..."
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3
                         text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {busca && (
            <div className="border border-slate-700 rounded-xl overflow-hidden mb-4 max-h-64 overflow-y-auto">
              {clientesFiltrados.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">Nenhum cliente encontrado.</p>
              ) : (
                clientesFiltrados.slice(0, 20).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setClienteSelecionado(c); setBusca(c.razao_social); }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-800 border-b border-slate-800
                               last:border-0 transition-colors"
                  >
                    <p className="text-sm text-white font-medium">{c.razao_social}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {c.codigo_externo} · {c.municipio || "—"} / {c.uf}
                      {c.status_atribuicao === "PENDENTE" && (
                        <span className="ml-2 text-amber-400">⚠ sem atribuição</span>
                      )}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}

          {clienteSelecionado && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 mb-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">{clienteSelecionado.razao_social}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {clienteSelecionado.municipio || "Município não informado"} / {clienteSelecionado.uf}
                  </p>
                  {!clienteSelecionado.lat && (
                    <p className="text-xs text-amber-400 mt-1">
                      ⚠ Cliente sem coordenadas — validação de distância desabilitada
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => mutCheckin.mutate()}
            disabled={!clienteSelecionado || !coords || mutCheckin.isPending}
            className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white
                       font-medium rounded-xl py-3 text-sm transition-colors flex items-center justify-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            {mutCheckin.isPending ? "Registrando..." : "Fazer Check-in"}
          </button>
        </>
      )}
    </div>
  );
}
