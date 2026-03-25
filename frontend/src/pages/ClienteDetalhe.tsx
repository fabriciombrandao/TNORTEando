import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import {
  ArrowLeft, Building2, MapPin, User,
  FileText, Clock, FileSearch2, ShoppingBag
} from "lucide-react";

const getCliente  = (id: string) => api.get(`/api/v1/clientes/${id}`).then(r => r.data);
const getUsuarios = ()            => api.get("/api/v1/usuarios").then(r => r.data);

function formatBRL(val: number | null) {
  if (!val) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatCNPJ(cnpj: string) {
  if (!cnpj) return "—";
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatDate(val: string | null) {
  if (!val) return "—";
  try { return new Date(val + "T00:00:00").toLocaleDateString("pt-BR"); } catch { return val; }
}

function BadgeABC({ cls }: { cls: string }) {
  const map: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-700 border-emerald-200",
    B: "bg-blue-100 text-blue-700 border-blue-200",
    C: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border ${map[cls] || map.C}`}>
      {cls}
    </span>
  );
}

export default function ClienteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: cliente, isLoading } = useQuery({
    queryKey: ["cliente", id],
    queryFn: () => getCliente(id!),
    enabled: !!id,
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["usuarios"],
    queryFn: getUsuarios,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-slate-400 text-sm">Carregando...</p>
    </div>
  );

  if (!cliente) return (
    <div className="p-6"><p className="text-slate-400">Cliente não encontrado.</p></div>
  );

  const vendedor  = (usuarios as any[]).find(u => u.id === cliente.vendedor_responsavel_id);
  const contratos = cliente.contratos || [];
  const ctAtivos  = contratos.filter((c: any) => c.status === "ATIVO");
  const mrr       = ctAtivos.reduce((s: number, c: any) => s + (c.valor_mensal || 0), 0);
  const hv        = cliente.historico_vendas || {};
  const totalPropostas = hv.total_vendas || 0;
  const emCancelamento = hv.em_cancelamento || 0;

  return (
    <div className="p-4 md:p-6 max-w-5xl animate-fade-in">

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <button onClick={() => navigate("/clientes")} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50 flex-shrink-0 mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-slate-900">{cliente.razao_social}</h1>
            {cliente.classificacao_abc && <BadgeABC cls={cliente.classificacao_abc} />}
            <span className="badge-green text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Ativo</span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {cliente.codigo_externo} · {formatCNPJ(cliente.cnpj)} · {cliente.segmento} · {cliente.municipio}/{cliente.uf}
          </p>
        </div>
      </div>

      {/* KPI — MRR */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4" style={{borderTop: "2px solid #34c77b"}}>
        <p className="text-2xl font-bold text-emerald-600">{formatBRL(mrr)}</p>
        <p className="text-xs text-slate-400 uppercase tracking-wide mt-1">MRR — Receita mensal recorrente</p>
      </div>

      {/* Botões de detalhe */}
      <div className="grid grid-cols-3 gap-3 mb-4">

        {/* Licenciamento */}
        <button
          onClick={() => navigate(`/clientes/${id}/licenciamento`)}
          className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mb-3">
            <FileSearch2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Licenciamento</p>
          <p className="text-xs text-slate-400 mt-1">Produtos ativos</p>
          {emCancelamento > 0 && (
            <p className="text-xs text-red-500 mt-0.5 font-medium">{emCancelamento} em cancelamento</p>
          )}
          <p className="text-xs text-indigo-400 mt-2 group-hover:text-indigo-600">Ver detalhes →</p>
        </button>

        {/* Contratos */}
        <button
          onClick={() => navigate(`/clientes/${id}/contratos`)}
          className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Contratos</p>
          <p className="text-xs text-slate-400 mt-1">{ctAtivos.length} ativo{ctAtivos.length !== 1 ? "s" : ""} · {formatBRL(mrr)}/mês</p>
          <p className="text-xs text-slate-400">{totalPropostas} proposta{totalPropostas !== 1 ? "s" : ""}</p>
          {emCancelamento > 0 && (
            <p className="text-xs text-red-500 mt-0.5 font-medium">{emCancelamento} em aviso prévio</p>
          )}
          <p className="text-xs text-indigo-400 mt-2 group-hover:text-indigo-600">Ver detalhes →</p>
        </button>

        {/* Histórico de visitas */}
        <button
          onClick={() => navigate(`/clientes/${id}/visitas`)}
          className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center mb-3">
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Hist. de visitas</p>
          <p className="text-xs text-slate-400 mt-1">
            {cliente.ultima_visita_em
              ? `Última: ${new Date(cliente.ultima_visita_em).toLocaleDateString("pt-BR")}`
              : "Nunca visitado"}
          </p>
          <p className="text-xs text-indigo-400 mt-2 group-hover:text-indigo-600">Ver detalhes →</p>
        </button>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-4">

          {/* Histórico de vendas */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Histórico de vendas</span>
            </div>
            <div className="card-body grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="label">Primeira compra</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(hv.primeira_compra)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="label">Cliente há</p>
                <p className="text-sm font-semibold text-emerald-600">{hv.cliente_ha || "—"}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="label">Última compra</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(hv.ultima_compra)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="label">Maior compra</p>
                <p className="text-sm font-semibold text-blue-600">{formatBRL(hv.maior_compra)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 col-span-2">
                <p className="label">Vendas realizadas</p>
                <p className="text-sm font-semibold text-purple-600">{totalPropostas} proposta{totalPropostas !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </div>

          {/* Contatos */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span className="font-semibold text-slate-900 text-sm">Contatos</span>
              <button className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Adicionar</button>
            </div>
            <div className="card-body text-center py-5">
              <p className="text-slate-400 text-sm">Nenhum contato cadastrado.</p>
              <p className="text-slate-300 text-xs mt-1">Decisores, técnicos, financeiros.</p>
            </div>
          </div>

        </div>

        {/* Coluna lateral */}
        <div className="space-y-4">

          {/* Executivo */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Executivo</span>
            </div>
            <div className="card-body">
              {vendedor ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-indigo-600">
                      {vendedor.nome.split(" ").filter(Boolean).slice(0, 2).map((n: string) => n[0]).join("")}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{vendedor.nome}</p>
                    <p className="text-xs text-slate-400">{vendedor.email}</p>
                  </div>
                </div>
              ) : <p className="text-slate-400 text-sm">Não atribuído</p>}
            </div>
          </div>

          {/* Cadastro */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Cadastro</span>
            </div>
            <div className="card-body space-y-3">
              <div>
                <p className="label">Segmento</p>
                <p className="text-sm text-slate-700">{cliente.segmento || "—"}</p>
                {cliente.sub_segmento && <p className="text-xs text-slate-400">{cliente.sub_segmento}</p>}
              </div>
              <div>
                <p className="label">Município</p>
                <p className="text-sm text-slate-700 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  {cliente.municipio ? `${cliente.municipio} / ${cliente.uf}` : "—"}
                </p>
              </div>
              <div>
                <p className="label">Setor</p>
                <p className="text-sm text-slate-700">{cliente.setor_publico ? "Público" : "Privado"}</p>
              </div>
              <div>
                <p className="label">Freq. de visita</p>
                <p className="text-sm text-slate-700">
                  {cliente.frequencia_visita_dias ? `A cada ${cliente.frequencia_visita_dias} dias` : "—"}
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
