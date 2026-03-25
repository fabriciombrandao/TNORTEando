import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Share2, RefreshCw, Package } from "lucide-react";
import api from "../services/api";

const getLicenciamento = (id: string) =>
  api.get(`/api/v1/clientes/${id}/licenciamento`).then(r => r.data);

function formatBRL(val: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatQtd(qtd: number) {
  return qtd % 1 === 0 ? String(qtd) : qtd.toFixed(1);
}

export default function LicenciamentoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["licenciamento", id],
    queryFn: () => getLicenciamento(id!),
    enabled: !!id,
  });

  const handleShare = async () => {
    if (!data) return;

    const hoje = new Date().toLocaleDateString("pt-BR");

    const linhasRec = (data.recorrentes as any[])
      .map((p: any) => `• ${p.descricao}: ${formatQtd(p.quantidade)} licença${p.quantidade > 1 ? "s" : ""}`)
      .join("\n");

    const linhasNRec = (data.nao_recorrentes as any[])
      .map((p: any) => `• ${p.descricao}: ${formatQtd(p.quantidade)} licença${p.quantidade > 1 ? "s" : ""}`)
      .join("\n");

    const texto = [
      `📋 Resumo de Licenças — ${data.razao_social}`,
      `Data: ${hoje}`,
      ``,
      `RECORRENTES — ${formatBRL(data.mrr)}/mês`,
      linhasRec,
      ``,
      data.nao_recorrentes.length > 0 ? `NÃO RECORRENTES` : null,
      data.nao_recorrentes.length > 0 ? linhasNRec : null,
      ``,
      `Atenciosamente,`,
      `TOTVS Tocantins`,
    ]
      .filter(l => l !== null)
      .join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: `Licenças — ${data.razao_social}`, text: texto });
      } catch { /* usuário cancelou */ }
    } else {
      await navigator.clipboard.writeText(texto);
      alert("Copiado para a área de transferência!");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-400 text-sm">Carregando licenciamento...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <p className="text-slate-400">Dados não encontrados.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-6">

      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Licenciamento</p>
          <p className="text-xs text-slate-400 truncate">{data.razao_social}</p>
        </div>
        <button
          onClick={handleShare}
          className="w-8 h-8 rounded-lg border border-indigo-200 bg-indigo-50 flex items-center justify-center text-indigo-600 hover:bg-indigo-100 flex-shrink-0"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3 max-w-lg mx-auto">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white rounded-xl border border-slate-100 p-3">
            <p className="text-lg font-bold text-emerald-600">{formatBRL(data.mrr)}</p>
            <p className="text-xs text-slate-400 uppercase tracking-wide mt-0.5">Recorrente/mês</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3">
            <p className="text-lg font-bold text-indigo-600">{data.total_licencas}</p>
            <p className="text-xs text-slate-400 uppercase tracking-wide mt-0.5">Licenças ativas</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3">
            <p className="text-lg font-bold text-slate-700">{data.total_produtos}</p>
            <p className="text-xs text-slate-400 uppercase tracking-wide mt-0.5">Produtos distintos</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3">
            <p className="text-lg font-bold text-slate-500">{formatBRL(data.total_nao_recorrente)}</p>
            <p className="text-xs text-slate-400 uppercase tracking-wide mt-0.5">Não recorrente</p>
          </div>
        </div>

        {/* Recorrentes */}
        {(data.recorrentes as any[]).length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
              <div className="flex items-center gap-2 text-emerald-600">
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Recorrentes</span>
              </div>
              <span className="text-sm font-bold text-emerald-600">{formatBRL(data.mrr)}/mês</span>
            </div>

            <div className="divide-y divide-slate-50">
              {/* Cabeçalho colunas */}
              <div className="grid grid-cols-[1fr_44px_80px] gap-2 px-4 py-2">
                <span className="text-xs text-slate-400 font-medium">Produto</span>
                <span className="text-xs text-slate-400 font-medium text-center">Qtd</span>
                <span className="text-xs text-slate-400 font-medium text-right">Total/mês</span>
              </div>

              {(data.recorrentes as any[]).map((p: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_44px_80px] gap-2 px-4 py-2.5 items-center">
                  <div>
                    <p className="text-sm font-medium text-slate-800 leading-tight">{p.descricao}</p>
                    {p.codigo && <p className="text-xs text-slate-400 font-mono mt-0.5">{p.codigo}</p>}
                  </div>
                  <p className="text-sm text-slate-500 text-center">{formatQtd(p.quantidade)}</p>
                  <p className="text-sm font-semibold text-emerald-600 text-right">{formatBRL(p.valor_total)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Não recorrentes */}
        {(data.nao_recorrentes as any[]).length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
              <div className="flex items-center gap-2 text-slate-500">
                <Package className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Não recorrentes</span>
              </div>
              <span className="text-sm font-bold text-slate-500">{formatBRL(data.total_nao_recorrente)}</span>
            </div>

            <div className="divide-y divide-slate-50">
              <div className="grid grid-cols-[1fr_44px_80px] gap-2 px-4 py-2">
                <span className="text-xs text-slate-400 font-medium">Produto</span>
                <span className="text-xs text-slate-400 font-medium text-center">Qtd</span>
                <span className="text-xs text-slate-400 font-medium text-right">Total</span>
              </div>

              {(data.nao_recorrentes as any[]).map((p: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_44px_80px] gap-2 px-4 py-2.5 items-center">
                  <div>
                    <p className="text-sm font-medium text-slate-800 leading-tight">{p.descricao}</p>
                    {p.codigo && <p className="text-xs text-slate-400 font-mono mt-0.5">{p.codigo}</p>}
                  </div>
                  <p className="text-sm text-slate-500 text-center">{formatQtd(p.quantidade)}</p>
                  <p className="text-sm text-slate-500 text-right">{formatBRL(p.valor_total)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botão compartilhar no rodapé (mobile) */}
        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          <Share2 className="w-4 h-4" />
          Compartilhar licenciamento
        </button>

      </div>
    </div>
  );
}
