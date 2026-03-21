import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import type { Cliente, Usuario } from "../types";
import toast from "react-hot-toast";
import {
  Search, AlertTriangle, CheckCircle, UserPlus,
  Building2, Phone, Mail, MapPin, Filter
} from "lucide-react";

// ── API calls ──────────────────────────────────────────────────────────────

const getClientes = (filtro?: string) =>
  api.get("/api/v1/clientes", { params: { filtro } }).then(r => r.data);

const getUsuarios = () =>
  api.get("/api/v1/usuarios").then(r => r.data);

const atribuirVendedor = (cliente_id: string, vendedor_id: string) =>
  api.patch(`/api/v1/clientes/${cliente_id}/atribuir`, { vendedor_id }).then(r => r.data);

const getEstatisticas = () =>
  api.get("/api/v1/clientes/estatisticas").then(r => r.data);

// ── Componente principal ───────────────────────────────────────────────────

export default function ClientesPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendentes" | "atribuidos">("todos");
  const [clienteAtribuindo, setClienteAtribuindo] = useState<Cliente | null>(null);
  const [vendedorSelecionado, setVendedorSelecionado] = useState("");

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes", filtroStatus],
    queryFn: () => getClientes(filtroStatus !== "todos" ? filtroStatus : undefined),
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["usuarios"],
    queryFn: getUsuarios,
  });

  const { data: stats } = useQuery({
    queryKey: ["clientes-stats"],
    queryFn: getEstatisticas,
    refetchInterval: 30000,
  });

  const mutAtribuir = useMutation({
    mutationFn: () => atribuirVendedor(clienteAtribuindo!.id, vendedorSelecionado),
    onSuccess: () => {
      toast.success("Vendedor atribuído com sucesso!");
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["clientes-stats"] });
      setClienteAtribuindo(null);
      setVendedorSelecionado("");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atribuir."),
  });

  // Filtragem local
  const clientesFiltrados = (clientes as Cliente[]).filter(c => {
    const matchBusca =
      !busca ||
      c.razao_social.toLowerCase().includes(busca.toLowerCase()) ||
      c.codigo_externo.toLowerCase().includes(busca.toLowerCase()) ||
      (c.cnpj || "").includes(busca) ||
      (c.municipio || "").toLowerCase().includes(busca.toLowerCase());

    const matchStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "pendentes" && c.status_atribuicao === "PENDENTE") ||
      (filtroStatus === "atribuidos" && c.status_atribuicao === "ATRIBUIDO");

    return matchBusca && matchStatus;
  });

  const esns = (usuarios as Usuario[]).filter(u => u.papel === "ESN");
  const pendentes = (clientes as Cliente[]).filter(c => c.status_atribuicao === "PENDENTE");

  return (
    <div className="p-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {stats?.total ?? clientes.length} cadastrados
            {pendentes.length > 0 && (
              <span className="text-amber-600 ml-2">
                · {pendentes.length} sem vendedor atribuído
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Alerta de pendentes ── */}
      {pendentes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {pendentes.length} cliente(s) sem vendedor atribuído
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Estes clientes foram importados com linhas sem ESN. Atribua um vendedor para ativá-los.
            </p>
          </div>
          <button
            onClick={() => setFiltroStatus("pendentes")}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap"
          >
            Ver pendentes →
          </button>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Nome, código ou município..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
          {(["todos", "atribuidos", "pendentes"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltroStatus(f)}
              className={`px-4 py-2 font-medium transition-colors ${
                filtroStatus === f
                  ? "bg-indigo-500 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {f === "todos" ? "Todos" : f === "atribuidos" ? "Atribuídos" : "Pendentes"}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400">
          {clientesFiltrados.length} resultado(s)
        </span>
      </div>

      {/* ── Tabela ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Código
              </th>
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Razão Social
              </th>
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Segmento
              </th>
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Município
              </th>
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Executivo
              </th>
              <th className="text-left px-4 py-3 text-xs font-600 text-slate-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                  Carregando...
                </td>
              </tr>
            ) : clientesFiltrados.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            ) : (
              clientesFiltrados.map(c => {
                const vendedor = (usuarios as Usuario[]).find(u => u.id === c.vendedor_responsavel_id);
                return (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {c.codigo_externo}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{c.razao_social}</p>
                      {c.cnpj && (
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">
                          {c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {c.segmento || "—"}
                      {c.sub_segmento && (
                        <span className="block text-xs text-slate-400">{c.sub_segmento}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {c.municipio ? `${c.municipio} / ${c.uf}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {vendedor ? (
                        <span className="text-slate-700 font-medium">
                          {vendedor.nome.split(" ")[0]} {vendedor.nome.split(" ").slice(-1)}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">Não atribuído</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.status_atribuicao === "ATRIBUIDO" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium
                                         bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">
                          <CheckCircle className="w-3 h-3" /> Atribuído
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium
                                         bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.status_atribuicao === "PENDENTE" && (
                        <button
                          onClick={() => { setClienteAtribuindo(c); setVendedorSelecionado(""); }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800
                                     flex items-center gap-1"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Atribuir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal de atribuição ── */}
      {clienteAtribuindo && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Atribuir Vendedor</h2>
            <p className="text-sm text-slate-500 mb-5">
              Selecione o executivo responsável por este cliente.
            </p>

            {/* Info do cliente */}
            <div className="bg-slate-50 rounded-xl p-4 mb-5">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900 text-sm">
                    {clienteAtribuindo.razao_social}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    {clienteAtribuindo.codigo_externo}
                  </p>
                  {clienteAtribuindo.municipio && (
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {clienteAtribuindo.municipio} / {clienteAtribuindo.uf}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Seleção de ESN */}
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Executivo de Vendas (ESN)
            </label>
            <select
              value={vendedorSelecionado}
              onChange={e => setVendedorSelecionado(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                         focus:outline-none focus:border-indigo-400 mb-5"
            >
              <option value="">Selecione um executivo...</option>
              {esns.map(u => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>

            <div className="flex gap-3">
              <button
                onClick={() => mutAtribuir.mutate()}
                disabled={!vendedorSelecionado || mutAtribuir.isPending}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50
                           text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
              >
                {mutAtribuir.isPending ? "Salvando..." : "Confirmar Atribuição"}
              </button>
              <button
                onClick={() => setClienteAtribuindo(null)}
                className="px-5 py-2.5 text-sm text-slate-500 hover:text-slate-700
                           border border-slate-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
