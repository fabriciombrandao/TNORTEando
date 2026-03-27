import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw, Package, AlertCircle, XCircle } from "lucide-react";
import api from "../services/api";

const getCliente   = (id: string) => api.get(`/api/v1/clientes/${id}`).then(r => r.data);
const getPropostas = (cid: string) => api.get(`/api/v1/contratos/${cid}/propostas`).then(r => r.data);

function formatBRL(val: number | null) {
  if (!val && val !== 0) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatDate(val: string | null) {
  if (!val) return "—";
  try { return new Date(val + "T00:00:00").toLocaleDateString("pt-BR"); } catch { return val; }
}

function diasParaVencer(data: string | null) {
  if (!data) return null;
  return Math.ceil((new Date(data + "T00:00:00").getTime() - new Date().getTime()) / 86400000);
}

function BadgeStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    ATIVO: "bg-emerald-50 text-emerald-700",
    CANCELADO: "bg-red-50 text-red-700",
    GRATUITO: "bg-blue-50 text-blue-700",
    TROCADO: "bg-amber-50 text-amber-700",
    PENDENTE: "bg-amber-50 text-amber-700",
    MANUAL: "bg-slate-100 text-slate-500",
  };
  const labels: Record<string, string> = {
    ATIVO: "Ativo", CANCELADO: "Cancelado", GRATUITO: "Gratuito",
    TROCADO: "Trocado", PENDENTE: "Pendente", MANUAL: "Manual",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {labels[status] || status}
    </span>
  );
}

function ContratoCard({ contrato }: { contrato: any }) {
  const [aberto, setAberto] = useState(false);

  const { data: propostas = [], isLoading } = useQuery({
    queryKey: ["propostas", contrato.id],
    queryFn: () => getPropostas(contrato.id),
    enabled: aberto,
  });

  const todosItens   = (propostas as any[]).flatMap((p: any) => p.itens || []);
  const itensRec     = todosItens.filter((i: any) => i.recorrente);
  const itensNRec    = todosItens.filter((i: any) => !i.recorrente);
  const mrr          = contrato.valor_mensal || 0;
  const diasVencer   = diasParaVencer(contrato.data_vigencia_fim);
  const alertaVencer = diasVencer !== null && diasVencer >= 0 && diasVencer <= 90;
  const vencido      = diasVencer !== null && diasVencer < 0;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${contrato.status === "ATIVO" ? "border-slate-200" : "border-slate-100 opacity-70"}`}>

      {/* Header do contrato */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
           onClick={() => setAberto(!aberto)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-400">{contrato.numero_contrato}</span>
            <BadgeStatus status={contrato.status} />
            {alertaVencer && (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <AlertCircle className="w-3 h-3" /> Vence em {diasVencer}d
              </span>
            )}
            {vencido && (
              <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                <XCircle className="w-3 h-3" /> Vencido
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {contrato.modalidade || "—"}
            {contrato.data_vigencia_fim && ` · até ${formatDate(contrato.data_vigencia_fim)}`}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          {mrr > 0 && <p className="text-sm font-bold text-emerald-600">{formatBRL(mrr)}/mês</p>}
        </div>
        <div className="text-slate-300 flex-shrink-0">
          {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Propostas + Itens */}
      {aberto && (
        <div className="border-t border-slate-100">
          {isLoading ? (
            <p className="text-center text-slate-400 text-sm py-4">Carregando...</p>
          ) : (propostas as any[]).length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-4">Nenhuma proposta.</p>
          ) : (
            (propostas as any[]).map((proposta: any) => (
              <div key={proposta.id} className="border-b border-slate-50 last:border-0">
                {/* Header proposta */}
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50">
                  <div>
                    <span className="text-xs font-semibold text-slate-600">Proposta {proposta.numero_proposta}</span>
                    {proposta.data_assinatura && (
                      <span className="text-xs text-slate-400 ml-2">{formatDate(proposta.data_assinatura)}</span>
                    )}
                  </div>
                  {proposta.valor_recorrente > 0 && (
                    <span className="text-xs font-semibold text-emerald-600">{formatBRL(proposta.valor_recorrente)}/mês</span>
                  )}
                </div>

                {/* Itens recorrentes */}
                {(proposta.itens || []).filter((i: any) => i.recorrente).length > 0 && (
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-emerald-600 flex items-center gap-1 mb-1.5">
                      <RefreshCw className="w-3 h-3" /> Recorrentes
                    </p>
                    <div className="space-y-1">
                      {(proposta.itens || []).filter((i: any) => i.recorrente).map((item: any) => (
                        <div key={item.id} className={`grid grid-cols-[1fr_36px_70px] gap-2 text-xs items-center ${item.cancelado ? "opacity-40" : item.gratuito ? "opacity-60" : ""}`}>
                          <p className={`font-medium truncate ${item.cancelado ? "line-through text-slate-400" : "text-slate-700"}`}>
                            {item.descricao_produto}
                            {item.cancelado && <span className="ml-1 text-red-400">(cancelado)</span>}
                            {item.gratuito && !item.cancelado && <span className="ml-1 text-emerald-500">(gratuito)</span>}
                          </p>
                          <p className="text-slate-400 text-center">{item.quantidade}</p>
                          <p className={`font-semibold text-right ${item.cancelado ? "text-slate-300" : item.gratuito ? "text-emerald-400" : "text-emerald-600"}`}>
                            {item.gratuito ? "Gratuito" : formatBRL(item.valor_total)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Itens não recorrentes */}
                {(proposta.itens || []).filter((i: any) => !i.recorrente).length > 0 && (
                  <div className="px-4 py-2 border-t border-slate-50">
                    <p className="text-xs font-medium text-slate-400 flex items-center gap-1 mb-1.5">
                      <Package className="w-3 h-3" /> Não recorrentes
                    </p>
                    <div className="space-y-1">
                      {(proposta.itens || []).filter((i: any) => !i.recorrente).map((item: any) => (
                        <div key={item.id} className={`grid grid-cols-[1fr_36px_70px] gap-2 text-xs items-center ${item.cancelado ? "opacity-40" : ""}`}>
                          <p className={`font-medium truncate ${item.cancelado ? "line-through text-slate-400" : "text-slate-700"}`}>
                            {item.descricao_produto}
                            {item.cancelado && <span className="ml-1 text-red-400">(cancelado)</span>}
                            {item.gratuito && !item.cancelado && <span className="ml-1 text-emerald-500">(gratuito)</span>}
                          </p>
                          <p className="text-slate-400 text-center">{item.quantidade}</p>
                          <p className={`text-right ${item.cancelado ? "text-slate-300" : item.gratuito ? "text-emerald-400" : "text-slate-500"}`}>
                            {item.gratuito ? "Gratuito" : formatBRL(item.valor_total)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ContratosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: cliente, isLoading } = useQuery({
    queryKey: ["cliente", id],
    queryFn: () => getCliente(id!),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <p className="text-slate-400 text-sm">Carregando...</p>
    </div>
  );

  if (!cliente) return (
    <div className="p-4"><p className="text-slate-400">Cliente não encontrado.</p></div>
  );

  const contratos  = cliente.contratos || [];
  const ctAtivos   = contratos.filter((c: any) => c.status === "ATIVO");
  const ctInativos = contratos.filter((c: any) => c.status !== "ATIVO");
  const mrr        = ctAtivos.reduce((s: number, c: any) => s + (c.valor_mensal || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-8">

      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Contratos</p>
          <p className="text-xs text-slate-400 truncate">{cliente.razao_social}</p>
        </div>
      </div>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">

        {/* KPI */}
        <div className="bg-white rounded-xl border border-slate-100 p-4" style={{borderTop: "2px solid #34c77b"}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-emerald-600">{formatBRL(mrr)}/mês</p>
              <p className="text-xs text-slate-400 uppercase tracking-wide mt-1">Receita mensal recorrente</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-700">{ctAtivos.length} ativo{ctAtivos.length !== 1 ? "s" : ""}</p>
              <p className="text-xs text-slate-400">{contratos.length} total</p>
            </div>
          </div>
        </div>

        {/* Contratos ativos */}
        {ctAtivos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Ativos</p>
            {ctAtivos.map((ct: any) => <ContratoCard key={ct.id} contrato={ct} />)}
          </div>
        )}

        {/* Contratos inativos */}
        {ctInativos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Histórico</p>
            {ctInativos.map((ct: any) => <ContratoCard key={ct.id} contrato={ct} />)}
          </div>
        )}

      </div>
    </div>
  );
}
