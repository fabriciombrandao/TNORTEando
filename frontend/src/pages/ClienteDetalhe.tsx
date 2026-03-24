import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import {
  ArrowLeft, Building2, MapPin, Phone, Mail,
  FileText, User, Clock, CheckCircle, XCircle,
  AlertCircle, Star, Calendar, Hash
} from "lucide-react";

const getCliente = (id: string) =>
  api.get(`/api/v1/clientes/${id}`).then(r => r.data);

const getUsuarios = () =>
  api.get("/api/v1/usuarios").then(r => r.data);

function StatusContrato({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ATIVO:     { label: "Ativo",     className: "badge-green" },
    CANCELADO: { label: "Cancelado", className: "badge-red" },
    GRATUITO:  { label: "Gratuito",  className: "badge-blue" },
    TROCADO:   { label: "Trocado",   className: "badge-amber" },
    PENDENTE:  { label: "Pendente",  className: "badge-amber" },
    MANUAL:    { label: "Manual",    className: "badge-gray" },
  };
  const s = map[status] || { label: status, className: "badge-gray" };
  return <span className={s.className}>{s.label}</span>;
}

function ClassificacaoABC({ cls }: { cls: string }) {
  const map: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold ${map[cls] || map.C}`}>
      {cls}
    </span>
  );
}

function formatCNPJ(cnpj: string) {
  if (!cnpj) return "—";
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatCurrency(val: number | null) {
  if (!val) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatDate(val: string | null) {
  if (!val) return "—";
  return new Date(val + "T00:00:00").toLocaleDateString("pt-BR");
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

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-slate-400 text-sm">Carregando...</div>
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="p-6">
        <p className="text-slate-400">Cliente não encontrado.</p>
      </div>
    );
  }

  const vendedor = (usuarios as any[]).find(u => u.id === cliente.vendedor_responsavel_id);
  const contratosAtivos = (cliente.contratos || []).filter((c: any) => c.status === "ATIVO");
  const mrr = contratosAtivos.reduce((sum: number, c: any) => sum + (c.valor_mensal || 0), 0);

  return (
    <div className="p-6 max-w-5xl animate-fade-in">

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <button
          onClick={() => navigate("/clientes")}
          className="btn-ghost btn-sm mt-1 text-slate-400 hover:text-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{cliente.razao_social}</h1>
            {cliente.classificacao_abc && (
              <ClassificacaoABC cls={cliente.classificacao_abc} />
            )}
          </div>
          <p className="text-slate-400 text-sm mt-0.5 font-mono">{cliente.codigo_externo}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-5">

          {/* Dados do cliente */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Dados Cadastrais</span>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label">CNPJ</p>
                  <p className="text-sm text-slate-700 font-mono">{formatCNPJ(cliente.cnpj)}</p>
                </div>
                <div>
                  <p className="label">Setor</p>
                  <p className="text-sm text-slate-700">{cliente.setor_publico ? "Público" : "Privado"}</p>
                </div>
                <div>
                  <p className="label">Segmento</p>
                  <p className="text-sm text-slate-700">{cliente.segmento || "—"}</p>
                </div>
                <div>
                  <p className="label">Sub-segmento</p>
                  <p className="text-sm text-slate-700">{cliente.sub_segmento || "—"}</p>
                </div>
                <div>
                  <p className="label">Município</p>
                  <p className="text-sm text-slate-700 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {cliente.municipio ? `${cliente.municipio} / ${cliente.uf}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="label">Freq. de Visita</p>
                  <p className="text-sm text-slate-700">
                    {cliente.frequencia_visita_dias ? `A cada ${cliente.frequencia_visita_dias} dias` : "—"}
                  </p>
                </div>
              </div>
              {cliente.observacoes && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="label">Observações</p>
                  <p className="text-sm text-slate-600">{cliente.observacoes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Contratos */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">
                  Contratos ({(cliente.contratos || []).length})
                </span>
              </div>
              {mrr > 0 && (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                  MRR: {formatCurrency(mrr)}
                </span>
              )}
            </div>
            {(cliente.contratos || []).length === 0 ? (
              <div className="card-body text-center py-8">
                <p className="text-slate-400 text-sm">Nenhum contrato cadastrado.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Produto</th>
                    <th>Modalidade</th>
                    <th>Valor/Mês</th>
                    <th>Vigência</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(cliente.contratos || []).map((ct: any) => (
                    <tr key={ct.id}>
                      <td className="font-mono text-xs text-slate-500">{ct.numero_contrato}</td>
                      <td>{ct.produto_principal || "—"}</td>
                      <td>{ct.modalidade || "—"}</td>
                      <td className="font-medium text-slate-700">{formatCurrency(ct.valor_mensal)}</td>
                      <td className="text-xs">{formatDate(ct.data_vigencia_fim)}</td>
                      <td><StatusContrato status={ct.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Histórico de Visitas */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Histórico de Visitas</span>
            </div>
            <div className="card-body text-center py-8">
              <p className="text-slate-400 text-sm">Nenhuma visita registrada ainda.</p>
            </div>
          </div>

        </div>

        {/* Coluna lateral */}
        <div className="space-y-5">

          {/* Executivo responsável */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Executivo Responsável</span>
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
                    {vendedor.telefone && (
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" /> {vendedor.telefone}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-sm">Não atribuído</p>
              )}
            </div>
          </div>

          {/* Próxima visita */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Visitas</span>
            </div>
            <div className="card-body space-y-3">
              <div>
                <p className="label">Última visita</p>
                <p className="text-sm text-slate-700">
                  {cliente.ultima_visita_em
                    ? new Date(cliente.ultima_visita_em).toLocaleDateString("pt-BR")
                    : "Nunca visitado"}
                </p>
              </div>
              <div>
                <p className="label">Próxima prevista</p>
                <p className="text-sm text-slate-700">
                  {cliente.proxima_visita_prevista
                    ? formatDate(cliente.proxima_visita_prevista)
                    : "Não agendada"}
                </p>
              </div>
            </div>
          </div>

          {/* Contatos */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">Contatos</span>
              </div>
              <button className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                + Adicionar
              </button>
            </div>
            <div className="card-body text-center py-6">
              <p className="text-slate-400 text-sm">Nenhum contato cadastrado.</p>
              <p className="text-slate-300 text-xs mt-1">Adicione decisores, técnicos e financeiros.</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
