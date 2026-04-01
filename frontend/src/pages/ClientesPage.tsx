import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import type { Cliente, Usuario } from "../types";
import toast from "react-hot-toast";
import { Search, ChevronRight, MapPin, User } from "lucide-react";

const getClientes     = () => api.get("/api/v1/clientes").then(r => r.data);
const getUsuarios     = () => api.get("/api/v1/usuarios").then(r => r.data);
const getEstatisticas = () => api.get("/api/v1/clientes/estatisticas").then(r => r.data);
const atribuirVendedor = (cliente_id: string, vendedor_id: string) =>
  api.patch(`/api/v1/clientes/${cliente_id}/atribuir`, { vendedor_id }).then(r => r.data);

function BadgeDormente() {
  return (
    <span className="inline-flex text-xs font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">
      Dormente
    </span>
  );
}

function formatCNPJ(cnpj: string) {
  if (!cnpj) return null;
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export default function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [clienteAtribuindo, setClienteAtribuindo] = useState<Cliente | null>(null);
  const [vendedorSelecionado, setVendedorSelecionado] = useState("");

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: getClientes,
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
      setClienteAtribuindo(null);
      setVendedorSelecionado("");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atribuir."),
  });

  const clientesFiltrados = (clientes as any[]).filter(c => {
    if (!busca) return true;
    const b = busca.toLowerCase();
    const vendedor = (usuarios as any[]).find(u => u.id === c.vendedor_responsavel_id);
    const nomeEsn = vendedor ? vendedor.nome.toLowerCase() : "";
    const codEsn  = vendedor ? (vendedor.codigo_externo || "").toLowerCase() : "";
    return (
      c.razao_social.toLowerCase().includes(b) ||
      c.codigo_externo.toLowerCase().includes(b) ||
      (c.cnpj || "").includes(busca) ||
      (c.municipio || "").toLowerCase().includes(b) ||
      nomeEsn.includes(b) ||
      codEsn.includes(b)
    );
  });

  const esns = (usuarios as Usuario[]).filter(u => u.papel === "ESN");
  const dormentes = (clientes as any[]).filter(c => c.dormente).length;

  return (
    <div className="p-4 md:p-6">

      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">Clientes</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {stats?.total ?? clientes.length} cadastrados
          {dormentes > 0 && (
            <span className="text-red-500 ml-2">· {dormentes} dormentes</span>
          )}
        </p>
      </div>

      {/* Busca */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Nome, código, CNPJ ou município..."
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl
                     focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
        />
        {busca && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {clientesFiltrados.length} resultado(s)
          </span>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : clientesFiltrados.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Nenhum cliente encontrado.</div>
      ) : (
        <>
          {/* MOBILE: cards */}
          <div className="md:hidden space-y-2">
            {clientesFiltrados.map((c: any) => {
              const vendedor = (usuarios as any[]).find(u => u.id === c.vendedor_responsavel_id);
              return (
                <div key={c.id}
                  onClick={() => navigate(`/clientes/${c.id}`)}
                  className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 active:bg-slate-50 cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 text-sm">{c.razao_social}</p>
                      {c.classificacao_abc && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {c.classificacao_abc}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {c.cnpj && (
                        <span className="text-xs font-mono text-slate-400">{formatCNPJ(c.cnpj)}</span>
                      )}
                      {c.dormente && <BadgeDormente />}
                      {(c as any).em_cancelamento_total && (
                        <span className="inline-flex text-xs font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">
                          Cancelamento{(c as any).fim_cancelamento ? ` ${(c as any).fim_cancelamento}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {c.segmento && (
                        <span className="text-xs text-slate-400">{c.segmento}</span>
                      )}
                      {c.municipio && (
                        <span className="text-xs text-slate-400 flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />{c.municipio}/{c.uf}
                        </span>
                      )}
                    </div>
                    {vendedor && (
                      <span className="text-xs text-indigo-500 flex items-center gap-1 mt-1 flex-wrap">
                        <User className="w-3 h-3" />
                        {vendedor.nome.split(" ")[0]} {vendedor.nome.split(" ").slice(-1)}
                        {vendedor.codigo_externo && (
                          <span className="text-slate-400 font-mono">· {vendedor.codigo_externo}</span>
                        )}
                        {vendedor.papel === "ESN" && (
                          <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-bold text-xs">
                            {({"BASE": "Base", "NOVOS": "Novos", "BASE_NOVOS": "Base+Novos"} as Record<string,string>)[vendedor.tipo_esn || "BASE"] || "Base"}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
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
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((c: any) => {
                  const vendedor = (usuarios as any[]).find(u => u.id === c.vendedor_responsavel_id);
                  return (
                    <tr key={c.id}
                      className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => navigate(`/clientes/${c.id}`)}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.codigo_externo}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">{c.razao_social}</p>
                          {c.classificacao_abc && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                              {c.classificacao_abc}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {c.cnpj && (
                            <span className="text-xs font-mono text-slate-400">{formatCNPJ(c.cnpj)}</span>
                          )}
                          {c.dormente && <BadgeDormente />}
                          {(c as any).em_cancelamento_total && (
                            <span className="inline-flex text-xs font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">
                              Cancelamento{(c as any).fim_cancelamento ? ` ${(c as any).fim_cancelamento}` : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {c.segmento || "—"}
                        {c.sub_segmento && <span className="block text-xs text-slate-400">{c.sub_segmento}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {c.municipio ? `${c.municipio} / ${c.uf}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {vendedor ? (
                          <div>
                            <p className="text-slate-700 font-medium">
                              {vendedor.nome.split(" ")[0]} {vendedor.nome.split(" ").slice(-1)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {vendedor.codigo_externo && (
                                <span className="text-xs text-slate-400 font-mono">{vendedor.codigo_externo}</span>
                              )}
                              {vendedor.papel === "ESN" && (
                                <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-bold text-xs">
                                  {({"BASE":"Base","NOVOS":"Novos","BASE_NOVOS":"Base+Novos"} as Record<string,string>)[vendedor.tipo_esn||"BASE"]||"Base"}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">Não atribuído</span>
                        )}
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
            <select value={vendedorSelecionado} onChange={e => setVendedorSelecionado(e.target.value)}
              className="input mb-4">
              <option value="">Selecione um executivo...</option>
              {esns.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setClienteAtribuindo(null)} className="btn-secondary btn-md flex-1">Cancelar</button>
              <button onClick={() => mutAtribuir.mutate()}
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
