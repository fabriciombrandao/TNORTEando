import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Package, AlertCircle, XCircle, AlertTriangle, Loader2 } from "lucide-react";
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
    ATIVO:     "bg-emerald-50 text-emerald-700",
    CANCELADO: "bg-red-50 text-red-700",
    GRATUITO:  "bg-blue-50 text-blue-700",
    TROCADO:   "bg-slate-100 text-slate-500",
    PENDENTE:  "bg-amber-50 text-amber-700",
    MANUAL:    "bg-slate-100 text-slate-500",
  };
  const labels: Record<string, string> = {
    ATIVO:"Ativo", CANCELADO:"Cancelado", GRATUITO:"Gratuito",
    TROCADO:"Trocado", PENDENTE:"Pendente", MANUAL:"Manual",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {labels[status] || status}
    </span>
  );
}

function ItemRow({ item }: { item: any }) {
  const cancelado  = item.cancelado;
  const programado = item.programado;
  const trocado    = item.trocado;
  const gratuito   = item.gratuito;
  const inativo    = cancelado || trocado;

  return (
    <div className={`grid grid-cols-[1fr_36px_64px_72px] gap-1 text-xs items-start px-4 py-2 border-b border-slate-50 last:border-0 ${
      inativo ? "opacity-50 bg-slate-50/50" : programado ? "bg-amber-50/30" : ""
    }`}>
      <div>
        <p className={`font-medium leading-tight ${inativo ? "line-through text-slate-400" : "text-slate-800"}`}>
          {item.descricao_produto}
        </p>
        {item.codigo_produto && (
          <p className="text-slate-400 font-mono text-xs mt-0.5">{item.codigo_produto}</p>
        )}
        {cancelado && (
          <span className="inline-flex items-center gap-0.5 text-xs text-red-500 font-medium mt-0.5">
            <XCircle className="w-3 h-3" /> Cancelado
          </span>
        )}
        {trocado && !cancelado && (
          <span className="text-xs text-slate-400 font-medium mt-0.5 block">Trocado</span>
        )}
        {programado && !cancelado && (
          <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 font-medium mt-0.5">
            <AlertTriangle className="w-3 h-3" />
            Aviso prévio{item.fim_aviso_previo ? ` até ${item.fim_aviso_previo}` : ""}
          </span>
        )}
        {gratuito && !cancelado && !trocado && (
          <span className="text-xs text-emerald-500 font-medium mt-0.5 block">Gratuito</span>
        )}
      </div>
      <p className="text-slate-400 text-center pt-0.5">{item.quantidade}</p>
      <p className="text-slate-400 text-right pt-0.5">
        {item.valor_unitario > 0 ? formatBRL(item.valor_unitario) : "—"}
      </p>
      <p className={`font-semibold text-right pt-0.5 ${
        inativo    ? "text-slate-300" :
        programado ? "text-amber-600" :
        gratuito   ? "text-emerald-400" :
        item.recorrente ? "text-emerald-600" : "text-slate-500"
      }`}>
        {formatBRL(item.valor_total)}
      </p>
    </div>
  );
}

function ContratoCard({ contrato }: { contrato: any }) {
  const { data: propostas = [], isLoading } = useQuery({
    queryKey: ["propostas", contrato.id],
    queryFn: () => getPropostas(contrato.id),
  });

  const mrr = contrato.valor_mensal || 0;
  const diasVencer = diasParaVencer(contrato.data_vigencia_fim);
  const alertaVencer = diasVencer !== null && diasVencer >= 0 && diasVencer <= 90;
  const vencido = diasVencer !== null && diasVencer < 0;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      contrato.status === "ATIVO"     ? "border-slate-200" :
      contrato.status === "CANCELADO" ? "border-red-100"   : "border-slate-100 opacity-70"
    }`}>
      {/* Header do contrato */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
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
          <p className="text-xs text-slate-400 mt-0.5">{contrato.modalidade || "—"}</p>
        </div>
        {mrr > 0 && (
          <p className="text-sm font-bold text-emerald-600 flex-shrink-0">{formatBRL(mrr)}/mês</p>
        )}
      </div>

      {/* Propostas — sempre expandidas */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Carregando propostas...</span>
        </div>
      ) : (propostas as any[]).length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-4">Nenhuma proposta.</p>
      ) : (
        (propostas as any[]).map((proposta: any, idx: number) => {
          const itensRec  = (proposta.itens || []).filter((i: any) =>  i.recorrente);
          const itensNRec = (proposta.itens || []).filter((i: any) => !i.recorrente);
          const isUltima  = idx === 0;

          return (
            <div key={proposta.id} className="border-b border-slate-50 last:border-0">
              {/* Header da proposta */}
              <div className={`flex items-center justify-between px-4 py-2 ${isUltima ? "bg-indigo-50/40" : "bg-slate-50/50"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Proposta {proposta.numero_proposta}
                    </span>
                    {isUltima && (
                      <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                        Mais recente
                      </span>
                    )}
                  </div>
                  {proposta.data_assinatura && (
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(proposta.data_assinatura)}</p>
                  )}
                </div>
                {proposta.valor_recorrente > 0 && (
                  <span className="text-xs font-bold text-emerald-600">
                    {formatBRL(proposta.valor_recorrente)}/mês
                  </span>
                )}
              </div>

              {/* Cabeçalho colunas */}
              <div className="grid grid-cols-[1fr_36px_64px_72px] gap-1 px-4 py-1.5 bg-slate-50/30">
                <span className="text-xs text-slate-400 font-medium">Produto</span>
                <span className="text-xs text-slate-400 font-medium text-center">Qtd</span>
                <span className="text-xs text-slate-400 font-medium text-right">Unit.</span>
                <span className="text-xs text-slate-400 font-medium text-right">Total</span>
              </div>

              {itensRec.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-emerald-600 flex items-center gap-1 px-4 pt-2 pb-1">
                    <RefreshCw className="w-3 h-3" /> Recorrentes
                  </p>
                  {itensRec.map((item: any) => <ItemRow key={item.id} item={item} />)}
                </div>
              )}

              {itensNRec.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 flex items-center gap-1 px-4 pt-2 pb-1">
                    <Package className="w-3 h-3" /> Não recorrentes
                  </p>
                  {itensNRec.map((item: any) => <ItemRow key={item.id} item={item} />)}
                </div>
              )}
            </div>
          );
        })
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
  const mrr = ctAtivos.reduce((s: number, c: any) => s + (c.valor_mensal || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
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
        <div className="bg-white rounded-xl border border-slate-100 p-4" style={{borderTop:"2px solid #34c77b"}}>
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

        {ctAtivos.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Ativos</p>
            {ctAtivos.map((ct: any) => <ContratoCard key={ct.id} contrato={ct} />)}
          </div>
        )}

        {ctInativos.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Histórico</p>
            {ctInativos.map((ct: any) => <ContratoCard key={ct.id} contrato={ct} />)}
          </div>
        )}
      </div>
    </div>
  );
}
