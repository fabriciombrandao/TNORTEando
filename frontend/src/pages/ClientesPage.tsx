import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import type { Cliente, Usuario } from "../types";
import toast from "react-hot-toast";
import {
  Search, AlertTriangle, CheckCircle, ChevronRight,
  MapPin, User
} from "lucide-react";

const getClientes    = (filtro?: string) => api.get("/api/v1/clientes", { params: { filtro } }).then(r => r.data);
const getUsuarios    = ()                => api.get("/api/v1/usuarios").then(r => r.data);
const getEstatisticas = ()              => api.get("/api/v1/clientes/estatisticas").then(r => r.data);
const atribuirVendedor = (cliente_id: string, vendedor_id: string) =>
  api.patch(`/api/v1/clientes/${cliente_id}/atribuir`, { vendedor_id }).then(r => r.data);

export default function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busca, setBusca]             = useState("");
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
  });

  const mutAtribuir = useMutation({
    mutationFn: () => atribuirVendedor(clienteAtribuindo!.id, vendedorSelecionado),
    onSuccess: () => {
      toast.success("Vendedor atribuído!");
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["clientes-stats"] });
      setClienteAtribuindo(null);
      setVendedorSelecionado("");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atribuir."),
  });

  const clientesFiltrados = (clientes as Cliente[]).filter(c => {
    const matchBusca = !busca ||
      c.razao_social.toLowerCase().includes(busca.toLowerCase()) ||
      c.codigo_externo.toLowerCase().includes(busca.toLowerCase()) ||
      (c.cnpj || "").includes(busca) ||
      (c.municipio || "").toLowerCase().includes(busca.toLowerCase());
    const matchStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "pendentes"  && c.status_atribuicao === "PENDENTE") ||
      (filtroStatus === "atribuidos" && c.status_atribuicao === "ATRIBUIDO");
    return matchBusca && matchStatus;
  });

  const esns     = (usuarios as Usuario[]).filter(u => u.papel === "ESN");
  const pendentes = (clientes as Cliente[]).filter(c => c.status_atribuicao === "PENDENTE");

  return (
    <div className="p-4 md:p-6">

      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">Clientes</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {stats?.total ?? clientes.length} cadastrados
          {pendentes.length > 0 && (
            <span className="text-amber-600 ml-2">· {pendentes.length} sem vendedor</span>
          )}
        </p>
      </div>

      {/* Alerta pendentes */}
      {pendentes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">{pendentes.length} cliente(s) sem vendedor</p>
            <p className="text-xs text-amber-600 mt-0.5">Atribua um executivo para ativar estes clientes.</p>
          </div>
          <button onClick={() => setFiltroStatus("pendentes")}
            className="text-xs font-medium text-amber-700 whitespace-nowrap flex-shrink-0">
            Ver →
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        {/* Busca — full width no mobile */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Nome, código ou município..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl
                       focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
          />
        </div>

        {/* Filtros de status */}
        <div className="flex items-center justify-between">
          <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm bg-white">
            {(["todos", "atribuidos", "pendentes"] as const).map(f => (
              <button key={f} onClick={() => setFiltroStatus(f)}
                className={`px-3 py-1.5 font-medium transition-colors text-xs ${
                  filtroStatus === f ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}>
                {f === "todos" ? "Todos" : f === "atribuidos" ? "Atribuídos" : "Pendentes"}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">{clientesFiltrados.length} resultado(s)</span>
        </div>
      </div>

      {/* Lista — cards no mobile, tabela no desktop */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : clientesFiltrados.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Nenhum cliente encontrado.</div>
      ) : (
        <>
          {/* MOBILE: cards */}
          <div className="md:hidden space-y-2">
            {clientesFiltrados.map(c => {
              const vendedor = (usuarios as Usuario[]).find(u => u.id === c.vendedor_responsavel_id);
              return (
                <div key={c.id}
                  onClick={() => navigate(`/clientes/${c.id}`)}
                  className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 active:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{c.razao_social}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {c.segmento && (
                        <span className="text-xs text-slate-400 truncate max-w-[120px]">{c.segmento}</span>
                      )}
                      {c.municipio && (
                        <span className="text-xs text-slate-400 flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />{c.municipio}/{c.uf}
                        </span>
                      )}
                    </div>
                    {vendedor && (
                      <span className="text-xs text-indigo-500 flex items-center gap-1 mt-1">
                        <User className="w-3 h-3" />
                        {vendedor.nome.split(" ")[0]} {vendedor.nome.split(" ").slice(-1)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(c as any).dormente && (
                      <span className="text-xs font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Dormente</span>
                    )}
                    {c.status_atribuicao === "ATRIBUIDO"
                      ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                      : <AlertTriangle className="w-4 h-4 text-amber-400" />
                    }
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* DESKTOP: tabela */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Código</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Razão Social</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Segmento</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Município</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Executivo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map(c => {
                  const vendedor = (usuarios as Usuario[]).find(u => u.id === c.vendedor_responsavel_id);
                  return (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                        onClick={() => navigate(`/clientes/${c.id}`)}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.codigo_externo}</td>
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
                        {c.sub_segmento && <span className="block text-xs text-slate-400">{c.sub_segmento}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{c.municipio ? `${c.municipio} / ${c.uf}` : "—"}</td>
                      <td className="px-4 py-3">
                        {vendedor
                          ? <span className="text-slate-700 font-medium">{vendedor.nome.split(" ")[0]} {vendedor.nome.split(" ").slice(-1)}</span>
                          : <span className="text-slate-400 text-xs">Não atribuído</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.status_atribuicao === "ATRIBUIDO"
                            ? <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full"><CheckCircle className="w-3 h-3" /> Atribuído</span>
                            : <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full"><AlertTriangle className="w-3 h-3" /> Pendente</span>
                          }
                          {(c as any).dormente && (
                            <span className="inline-flex text-xs font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">Dormente</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal atribuir vendedor */}
      {clienteAtribuindo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
             onClick={() => setClienteAtribuindo(null)}>
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl"
               onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900 mb-1">Atribuir Executivo</h3>
            <p className="text-sm text-slate-500 mb-4">{clienteAtribuindo.razao_social}</p>
            <select
              value={vendedorSelecionado}
              onChange={e => setVendedorSelecionado(e.target.value)}
              className="input mb-4">
              <option value="">Selecione um executivo...</option>
              {esns.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setClienteAtribuindo(null)}
                className="btn-secondary btn-md flex-1">Cancelar</button>
              <button
                onClick={() => mutAtribuir.mutate()}
                disabled={!vendedorSelecionado || mutAtribuir.isPending}
                className="btn-primary btn-md flex-1">
                {mutAtribuir.isPending ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
