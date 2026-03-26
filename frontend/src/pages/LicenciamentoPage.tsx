import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Share2, RefreshCw, Package, X, Copy, Check } from "lucide-react";
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
  const [modalAberto, setModalAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["licenciamento", id],
    queryFn: () => getLicenciamento(id!),
    enabled: !!id,
  });

  const gerarTexto = () => {
    if (!data) return "";
    const hoje = new Date().toLocaleDateString("pt-BR");
    const linhasRec = (data.recorrentes as any[])
      .map((p: any) => `• ${p.descricao}: ${formatQtd(p.quantidade)} licença${p.quantidade > 1 ? "s" : ""} — ${formatBRL(p.valor_total)}/mês`)
      .join("\n");
    const linhasNRec = (data.nao_recorrentes as any[])
      .map((p: any) => `• ${p.descricao}: ${formatQtd(p.quantidade)} licença${p.quantidade > 1 ? "s" : ""}`)
      .join("\n");
    return [
      `📋 Resumo de Licenças — ${data.razao_social}`,
      `Data: ${hoje}`,
      ``,
      `RECORRENTES — ${formatBRL(data.mrr)}/mês`,
      linhasRec,
      data.nao_recorrentes.length > 0 ? `` : null,
      data.nao_recorrentes.length > 0 ? `NÃO RECORRENTES` : null,
      data.nao_recorrentes.length > 0 ? linhasNRec : null,
      ``,
      `Atenciosamente,`,
      `TOTVS Tocantins`,
    ].filter(l => l !== null).join("\n");
  };

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(gerarTexto());
    } catch {
      const el = document.createElement("textarea");
      el.value = gerarTexto();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(gerarTexto())}`, "_blank");
  };

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <p className="text-slate-400 text-sm">Carregando...</p>
    </div>
  );

  if (!data) return (
    <div className="p-4"><p className="text-slate-400">Dados não encontrados.</p></div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-8">

      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Licenciamento</p>
          <p className="text-xs text-slate-400 truncate">{data.razao_social}</p>
        </div>
        <button onClick={() => setModalAberto(true)}
          className="w-8 h-8 rounded-lg border border-indigo-200 bg-indigo-50 flex items-center justify-center text-indigo-600 hover:bg-indigo-100 flex-shrink-0">
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3 max-w-lg mx-auto overflow-x-hidden">

        {/* KPI único — MRR */}
        <div className="bg-white rounded-xl border border-slate-100 p-4" style={{borderTop: "2px solid #34c77b"}}>
          <p className="text-2xl font-bold text-emerald-600">{formatBRL(data.mrr)}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Recorrente/mês</p>
            <p className="text-xs text-slate-400">{data.total_licencas} licenças · {data.total_produtos} produtos</p>
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

            {/* Cabeçalho */}
            <div className="grid grid-cols-[1fr_36px_64px_72px] gap-1 px-3 py-2 border-b border-slate-50">
              <span className="text-xs text-slate-400 font-medium">Produto</span>
              <span className="text-xs text-slate-400 font-medium text-center">Qtd</span>
              <span className="text-xs text-slate-400 font-medium text-right">Unit.</span>
              <span className="text-xs text-slate-400 font-medium text-right">Total/mês</span>
            </div>

            <div className="divide-y divide-slate-50">
              {(data.recorrentes as any[]).map((p: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_36px_64px_72px] gap-1 px-3 py-2 items-start">
                  <p className="text-xs font-medium text-slate-800 leading-tight break-words">{p.descricao}</p>
                  <p className="text-xs text-slate-500 text-center pt-0.5">{formatQtd(p.quantidade)}</p>
                  <p className="text-xs text-slate-400 text-right pt-0.5">
                    {p.quantidade > 0 ? formatBRL(p.valor_total / p.quantidade) : "—"}
                  </p>
                  <p className="text-xs font-semibold text-emerald-600 text-right pt-0.5">{formatBRL(p.valor_total)}</p>
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

            <div className="grid grid-cols-[1fr_36px_64px_72px] gap-1 px-3 py-2 border-b border-slate-50">
              <span className="text-xs text-slate-400 font-medium">Produto</span>
              <span className="text-xs text-slate-400 font-medium text-center">Qtd</span>
              <span className="text-xs text-slate-400 font-medium text-right">Unit.</span>
              <span className="text-xs text-slate-400 font-medium text-right">Total</span>
            </div>

            <div className="divide-y divide-slate-50">
              {(data.nao_recorrentes as any[]).map((p: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_36px_64px_72px] gap-1 px-3 py-2 items-start">
                  <p className="text-xs font-medium text-slate-800 leading-tight break-words">{p.descricao}</p>
                  <p className="text-xs text-slate-500 text-center pt-0.5">{formatQtd(p.quantidade)}</p>
                  <p className="text-xs text-slate-400 text-right pt-0.5">
                    {p.quantidade > 0 ? formatBRL(p.valor_total / p.quantidade) : "—"}
                  </p>
                  <p className="text-xs text-slate-500 text-right pt-0.5">{formatBRL(p.valor_total)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Modal compartilhar */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
             onClick={() => setModalAberto(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <p className="font-semibold text-slate-900 text-sm">Compartilhar licenciamento</p>
              <button onClick={() => setModalAberto(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mx-4 my-3 bg-slate-50 rounded-xl p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">
                {gerarTexto()}
              </pre>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button onClick={handleCopiar}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-all">
                {copiado ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copiado ? "Copiado!" : "Copiar"}
              </button>
              <button onClick={handleWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-all">
                <Share2 className="w-4 h-4" />
                WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
