import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClientes, checkin, checkout, getVisitaEmAndamento } from "../services/api";
import type { Cliente } from "../types";
import toast from "react-hot-toast";
import { MapPin, Clock, CheckCircle, Search, Navigation, AlertTriangle, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const TIPOS_VISITA = [
  { value: "ROTINA",       label: "Rotina",        cor: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "PROBLEMA",     label: "Problema",      cor: "bg-red-50 text-red-700 border-red-200" },
  { value: "OPORTUNIDADE", label: "Oportunidade",  cor: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "SUPORTE",      label: "Suporte",       cor: "bg-amber-50 text-amber-700 border-amber-200" },
];

export default function CheckinPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localizando, setLocalizando] = useState(false);

  // Relatório
  const [relTipo, setRelTipo] = useState("");
  const [relResumo, setRelResumo] = useState("");
  const [relProblema, setRelProblema] = useState(false);
  const [relProblemaDesc, setRelProblemaDesc] = useState("");
  const [relOport, setRelOport] = useState(false);
  const [relOportDesc, setRelOportDesc] = useState("");
  const [relProximoPasso, setRelProximoPasso] = useState("");
  const [mostrarRelatorio, setMostrarRelatorio] = useState(false);

  const { data: clientes = [] } = useQuery({ queryKey: ["clientes"], queryFn: getClientes });
  const { data: emAndamento } = useQuery({
    queryKey: ["visita-em-andamento"],
    queryFn: getVisitaEmAndamento,
    refetchInterval: 30000,
  });

  const clientesFiltrados = (clientes as Cliente[]).filter(c =>
    c.razao_social.toLowerCase().includes(busca.toLowerCase()) ||
    c.codigo_externo.toLowerCase().includes(busca.toLowerCase())
  );

  const obterLocalizacao = () => {
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocalizando(false); },
      () => { toast.error("Não foi possível obter a localização."); setLocalizando(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => { obterLocalizacao(); }, []);

  const mutCheckin = useMutation({
    mutationFn: () => checkin({ cliente_id: clienteSelecionado!.id, lat: coords!.lat, lng: coords!.lng }),
    onSuccess: () => {
      toast.success("Check-in realizado!");
      qc.invalidateQueries({ queryKey: ["visita-em-andamento"] });
      setMostrarRelatorio(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro no check-in."),
  });

  const relatorioValido = relTipo &&
    relResumo.trim().length >= 10 &&
    (!relProblema || relProblemaDesc.trim()) &&
    (!relOport || relOportDesc.trim());

  const mutCheckout = useMutation({
    mutationFn: () => checkout(emAndamento!.visita_id, {
      lat: coords!.lat, lng: coords!.lng,
      relatorio_tipo: relTipo,
      relatorio_resumo: relResumo,
      relatorio_problema: relProblema,
      relatorio_problema_desc: relProblemaDesc,
      relatorio_oportunidade: relOport,
      relatorio_oport_desc: relOportDesc,
      relatorio_proximo_passo: relProximoPasso,
    }),
    onSuccess: (data: any) => {
      toast.success(`Check-out realizado! Duração: ${data.duracao_minutos} min`);
      qc.invalidateQueries({ queryKey: ["visita-em-andamento"] });
      setRelTipo(""); setRelResumo(""); setRelProblema(false);
      setRelProblemaDesc(""); setRelOport(false); setRelOportDesc("");
      setRelProximoPasso(""); setMostrarRelatorio(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro no check-out."),
  });

  return (
    <div className="p-4 max-w-2xl mx-auto pb-8">
      <h1 className="text-xl font-bold text-slate-900 mb-4">Check-in / Check-out</h1>

      {/* Localização */}
      <div className={`rounded-xl border p-3 mb-4 flex items-center gap-3 ${
        coords ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
      }`}>
        <Navigation className={`w-5 h-5 flex-shrink-0 ${coords ? "text-emerald-500" : "text-slate-400"}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-800">
            {coords ? "Localização obtida" : "Aguardando localização..."}
          </p>
          {coords && <p className="text-xs text-slate-400">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</p>}
        </div>
        <button onClick={obterLocalizacao} disabled={localizando}
          className="text-xs text-indigo-600 font-medium disabled:opacity-50">
          {localizando ? "Obtendo..." : "Atualizar"}
        </button>
      </div>

      {/* Visita em andamento */}
      {emAndamento?.em_andamento && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden mb-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Visita em andamento</p>
              <p className="text-xs text-slate-500">
                Iniciada {formatDistanceToNow(new Date(emAndamento.checkin_em), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
          </div>

          {/* Formulário relatório */}
          <div className="p-4 space-y-4">
            <button onClick={() => setMostrarRelatorio(!mostrarRelatorio)}
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>Relatório da visita <span className="text-red-500">*</span></span>
              {mostrarRelatorio ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {(mostrarRelatorio || true) && (
              <div className="space-y-4">
                {/* Tipo */}
                <div>
                  <label className="label mb-2 block">Tipo da visita <span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-2 gap-2">
                    {TIPOS_VISITA.map(t => (
                      <button key={t.value} onClick={() => setRelTipo(t.value)}
                        className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                          relTipo === t.value ? t.cor : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                        }`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resumo */}
                <div>
                  <label className="label mb-1.5 block">Resumo da visita <span className="text-red-500">*</span></label>
                  <textarea value={relResumo} onChange={e => setRelResumo(e.target.value)}
                    rows={3} placeholder="Descreva o que foi discutido na visita..."
                    className="input resize-none" />
                  {relResumo && relResumo.length < 10 && (
                    <p className="text-xs text-red-500 mt-1">Mínimo 10 caracteres.</p>
                  )}
                </div>

                {/* Problema */}
                <div className="border border-slate-100 rounded-xl p-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={relProblema} onChange={e => setRelProblema(e.target.checked)}
                      className="w-4 h-4 accent-red-500" />
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <AlertTriangle className="w-4 h-4 text-red-500" /> Problema identificado
                    </span>
                  </label>
                  {relProblema && (
                    <textarea value={relProblemaDesc} onChange={e => setRelProblemaDesc(e.target.value)}
                      rows={2} placeholder="Descreva o problema..."
                      className="input resize-none mt-2" />
                  )}
                </div>

                {/* Oportunidade */}
                <div className="border border-slate-100 rounded-xl p-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={relOport} onChange={e => setRelOport(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500" />
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <TrendingUp className="w-4 h-4 text-emerald-500" /> Nova oportunidade
                    </span>
                  </label>
                  {relOport && (
                    <textarea value={relOportDesc} onChange={e => setRelOportDesc(e.target.value)}
                      rows={2} placeholder="Descreva a oportunidade..."
                      className="input resize-none mt-2" />
                  )}
                </div>

                {/* Próximo passo */}
                <div>
                  <label className="label mb-1.5 block">Próximo passo</label>
                  <input value={relProximoPasso} onChange={e => setRelProximoPasso(e.target.value)}
                    className="input" placeholder="Ex: Enviar proposta, agendar demo..." />
                </div>
              </div>
            )}

            <button onClick={() => mutCheckout.mutate()}
              disabled={!coords || !relatorioValido || mutCheckout.isPending}
              className="btn-primary btn-lg btn-full">
              <CheckCircle className="w-4 h-4" />
              {mutCheckout.isPending ? "Registrando..." : "Fazer Check-out"}
            </button>
            {!relatorioValido && (
              <p className="text-xs text-red-500 text-center">Preencha todos os campos obrigatórios do relatório.</p>
            )}
          </div>
        </div>
      )}

      {/* Seleção de cliente */}
      {!emAndamento?.em_andamento && (
        <>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={busca}
              onChange={e => { setBusca(e.target.value); setClienteSelecionado(null); }}
              placeholder="Buscar cliente..."
              className="input pl-9" />
          </div>

          {busca && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4 max-h-64 overflow-y-auto shadow-sm">
              {clientesFiltrados.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Nenhum cliente encontrado.</p>
              ) : clientesFiltrados.slice(0, 20).map(c => (
                <button key={c.id} onClick={() => { setClienteSelecionado(c); setBusca(c.razao_social); }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <p className="text-sm font-medium text-slate-800">{c.razao_social}</p>
                  <p className="text-xs text-slate-400">{c.codigo_externo} · {c.municipio}/{c.uf}</p>
                </button>
              ))}
            </div>
          )}

          {clienteSelecionado && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{clienteSelecionado.razao_social}</p>
                  <p className="text-xs text-slate-500">{clienteSelecionado.municipio}/{clienteSelecionado.uf}</p>
                  {!clienteSelecionado.lat && (
                    <p className="text-xs text-amber-500 mt-1">⚠ Cliente sem coordenadas — validação de distância desabilitada</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <button onClick={() => mutCheckin.mutate()}
            disabled={!clienteSelecionado || !coords || mutCheckin.isPending}
            className="btn-primary btn-lg btn-full">
            <MapPin className="w-4 h-4" />
            {mutCheckin.isPending ? "Registrando..." : "Fazer Check-in"}
          </button>
        </>
      )}
    </div>
  );
}
