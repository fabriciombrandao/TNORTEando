import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import {
  ArrowLeft, Building2, MapPin, Phone, FileText,
  User, Calendar, Package, ChevronDown, ChevronUp,
  XCircle, AlertCircle, RefreshCw, FileSearch2
} from "lucide-react";

const getCliente   = (id: string)  => api.get(`/api/v1/clientes/${id}`).then(r => r.data);
const getUsuarios  = ()            => api.get("/api/v1/usuarios").then(r => r.data);
const getPropostas = (cid: string) => api.get(`/api/v1/contratos/${cid}/propostas`).then(r => r.data);

function formatCNPJ(cnpj: string) {
  if (!cnpj) return "—";
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
function formatBRL(val: number | null) {
  if (!val && val !== 0) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}
function formatDate(val: string | null) {
  if (!val) return "—";
  try { return new Date(val + "T00:00:00").toLocaleDateString("pt-BR"); } catch { return val; }
}
function diasParaVencer(data: string | null): number | null {
  if (!data) return null;
  return Math.ceil((new Date(data + "T00:00:00").getTime() - new Date().getTime()) / 86400000);
}

function BadgeStatus({ status }: { status: string }) {
  const map: Record<string, string> = { ATIVO:"badge-green", CANCELADO:"badge-red", GRATUITO:"badge-blue", TROCADO:"badge-amber", PENDENTE:"badge-amber", MANUAL:"badge-gray" };
  const labels: Record<string, string> = { ATIVO:"Ativo", CANCELADO:"Cancelado", GRATUITO:"Gratuito", TROCADO:"Trocado", PENDENTE:"Pendente", MANUAL:"Manual" };
  return <span className={map[status] || "badge-gray"}>{labels[status] || status}</span>;
}

function BadgeABC({ cls }: { cls: string }) {
  const map: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-700 border-emerald-200",
    B: "bg-blue-100 text-blue-700 border-blue-200",
    C: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold border ${map[cls] || map.C}`}>{cls}</span>;
}

function ContratoCard({ contrato }: { contrato: any }) {
  const [aberto, setAberto] = useState(false);

  const { data: propostas = [], isLoading } = useQuery({
    queryKey: ["propostas", contrato.id],
    queryFn: () => getPropostas(contrato.id),
    enabled: aberto,
  });

  const todosItens = (propostas as any[]).flatMap((p: any) => p.itens || []);
  const itensRec   = todosItens.filter((i: any) => i.recorrente);
  const itensNRec  = todosItens.filter((i: any) => !i.recorrente);
  const mrrContrato = contrato.valor_mensal || 0;
  const diasVencer  = diasParaVencer(contrato.data_vigencia_fim);
  const alertaVencer = diasVencer !== null && diasVencer >= 0 && diasVencer <= 90;
  const vencido      = diasVencer !== null && diasVencer < 0;

  return (
    <div className={`border rounded-xl overflow-hidden ${contrato.status === "ATIVO" ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
      <div className="flex items-center gap-3 px-4 py-3 bg-white cursor-pointer hover:bg-slate-50" onClick={() => setAberto(!aberto)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-slate-400">{contrato.numero_contrato}</span>
            <BadgeStatus status={contrato.status} />
            {contrato.recorrente && <span className="badge badge-blue"><RefreshCw className="w-2.5 h-2.5" /> Recorrente</span>}
            {alertaVencer && <span className="badge badge-amber"><AlertCircle className="w-2.5 h-2.5" /> Vence em {diasVencer}d</span>}
            {vencido && <span className="badge badge-red"><XCircle className="w-2.5 h-2.5" /> Vencido</span>}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {contrato.modalidade || "—"}
            {contrato.data_vigencia_fim && ` · Vigência até ${formatDate(contrato.data_vigencia_fim)}`}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          {mrrContrato > 0 && <p className="text-sm font-bold text-emerald-600">{formatBRL(mrrContrato)}/mês</p>}
          <p className="text-xs text-slate-400">ARR: {formatBRL(mrrContrato * 12)}</p>
        </div>
        <div className="text-slate-300 flex-shrink-0">
          {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          {isLoading ? (
            <div className="p-4 text-center text-slate-400 text-sm">Carregando...</div>
          ) : todosItens.length === 0 ? (
            <div className="p-4 text-center text-slate-400 text-sm">Nenhum item encontrado.</div>
          ) : (
            <>
              {(propostas as any[]).map((proposta: any) => (
                <div key={proposta.id} className="px-4 pt-3 pb-2 border-b border-slate-100 last:border-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Proposta {proposta.numero_proposta}
                      {proposta.data_assinatura && ` · ${formatDate(proposta.data_assinatura)}`}
                    </p>
                    <div className="text-right">
                      {proposta.valor_recorrente > 0 && (
                        <span className="text-xs font-semibold text-emerald-600">{formatBRL(proposta.valor_recorrente)}/mês</span>
                      )}
                    </div>
                  </div>

                  {/* Itens recorrentes */}
                  {(proposta.itens || []).filter((i:any) => i.recorrente).length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-medium text-emerald-600 flex items-center gap-1 mb-1">
                        <RefreshCw className="w-3 h-3" /> Recorrentes
                      </p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400">
                            <th className="text-left pb-1 font-medium">Produto</th>
                            <th className="text-right pb-1 font-medium">Qtd</th>
                            <th className="text-right pb-1 font-medium">Unit.</th>
                            <th className="text-right pb-1 font-medium">Total/mês</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(proposta.itens || []).filter((i:any) => i.recorrente).map((item: any) => (
                            <tr key={item.id} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2">
                                <p className="font-medium text-slate-700">{item.descricao_produto}</p>
                                {item.codigo_produto && <p className="text-slate-400 font-mono">{item.codigo_produto}</p>}
                              </td>
                              <td className="py-1.5 text-right text-slate-600">{item.quantidade}</td>
                              <td className="py-1.5 text-right text-slate-600">{formatBRL(item.valor_unitario)}</td>
                              <td className="py-1.5 text-right font-semibold text-emerald-600">{formatBRL(item.valor_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Itens não recorrentes */}
                  {(proposta.itens || []).filter((i:any) => !i.recorrente).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-400 flex items-center gap-1 mb-1">
                        <Package className="w-3 h-3" /> Não Recorrentes
                      </p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400">
                            <th className="text-left pb-1 font-medium">Produto</th>
                            <th className="text-right pb-1 font-medium">Qtd</th>
                            <th className="text-right pb-1 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(proposta.itens || []).filter((i:any) => !i.recorrente).map((item: any) => (
                            <tr key={item.id} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2">
                                <p className="font-medium text-slate-700">{item.descricao_produto}</p>
                                {item.codigo_produto && <p className="text-slate-400 font-mono">{item.codigo_produto}</p>}
                              </td>
                              <td className="py-1.5 text-right text-slate-600">{item.quantidade}</td>
                              <td className="py-1.5 text-right text-slate-600">{formatBRL(item.valor_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {/* Totais */}
              <div className="px-4 py-2 bg-slate-50 flex justify-between text-xs font-semibold">
                <span className="text-slate-500">Total recorrente/mês</span>
                <span className="text-emerald-600">{formatBRL(itensRec.reduce((s:number,i:any) => s + (i.valor_total||0), 0))}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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

  if (isLoading) return <div className="p-6 flex items-center justify-center min-h-64"><p className="text-slate-400 text-sm">Carregando...</p></div>;
  if (!cliente)  return <div className="p-6"><p className="text-slate-400">Cliente não encontrado.</p></div>;

  const vendedor     = (usuarios as any[]).find(u => u.id === cliente.vendedor_responsavel_id);
  const contratos    = cliente.contratos || [];
  const ctAtivos     = contratos.filter((c: any) => c.status === "ATIVO");
  const mrr          = ctAtivos.reduce((s: number, c: any) => s + (c.valor_mensal || 0), 0);
  const arr          = mrr * 12;
  const ctVencendo90 = ctAtivos.filter((c: any) => { const d = diasParaVencer(c.data_vigencia_fim); return d !== null && d >= 0 && d <= 90; });

  return (
    <div className="p-4 md:p-6 max-w-5xl animate-fade-in">

      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => navigate("/clientes")} className="btn-ghost btn-sm text-slate-400 mt-1">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900">{cliente.razao_social}</h1>
            {cliente.classificacao_abc && <BadgeABC cls={cliente.classificacao_abc} />}
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">{cliente.codigo_externo} · {formatCNPJ(cliente.cnpj)}</p>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => navigate(`/clientes/${id}/licenciamento`)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 transition-all"
        >
          <FileSearch2 className="w-4 h-4" />
          Licenciamento
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="kpi col-span-2 md:col-span-1 border-t-2 border-t-emerald-400">
          <div className="kpi-value text-emerald-600">{formatBRL(mrr)}</div>
          <div className="kpi-label">MRR</div>
          <div className="text-xs text-slate-400 mt-1">Receita mensal recorrente</div>
        </div>
        <div className="kpi col-span-2 md:col-span-1 border-t-2 border-t-blue-400">
          <div className="kpi-value text-blue-600">{formatBRL(arr)}</div>
          <div className="kpi-label">ARR</div>
          <div className="text-xs text-slate-400 mt-1">Receita anual recorrente</div>
        </div>
        <div className="kpi border-t-2 border-t-indigo-400">
          <div className="kpi-value text-indigo-600">{ctAtivos.length}</div>
          <div className="kpi-label">Contratos Ativos</div>
        </div>
        <div className={`kpi border-t-2 ${ctVencendo90.length > 0 ? "border-t-amber-400" : "border-t-slate-200"}`}>
          <div className={`kpi-value ${ctVencendo90.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{ctVencendo90.length}</div>
          <div className="kpi-label">Vencem em 90d</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Contratos e Propostas ({contratos.length})
          </h2>
          {contratos.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-slate-400 text-sm">Nenhum contrato cadastrado.</p></div>
          ) : (
            <div className="space-y-2">
              {contratos
                .sort((a: any, b: any) => {
                  const order: Record<string, number> = { ATIVO:0, GRATUITO:1, PENDENTE:2, TROCADO:3, CANCELADO:4, MANUAL:5 };
                  return (order[a.status]||9) - (order[b.status]||9);
                })
                .map((ct: any) => <ContratoCard key={ct.id} contrato={ct} />)
              }
            </div>
          )}
        </div>

        <div className="space-y-4">
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
                      {vendedor.nome.split(" ").filter(Boolean).slice(0,2).map((n:string)=>n[0]).join("")}
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
                <p className="label">Freq. de Visita</p>
                <p className="text-sm text-slate-700">{cliente.frequencia_visita_dias ? `A cada ${cliente.frequencia_visita_dias} dias` : "—"}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Visitas</span>
            </div>
            <div className="card-body space-y-3">
              <div>
                <p className="label">Última visita</p>
                <p className="text-sm text-slate-700">{cliente.ultima_visita_em ? new Date(cliente.ultima_visita_em).toLocaleDateString("pt-BR") : "Nunca visitado"}</p>
              </div>
              <div>
                <p className="label">Próxima prevista</p>
                <p className="text-sm text-slate-700">{cliente.proxima_visita_prevista ? formatDate(cliente.proxima_visita_prevista) : "Não agendada"}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">Contatos</span>
              </div>
              <button className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Adicionar</button>
            </div>
            <div className="card-body text-center py-5">
              <p className="text-slate-400 text-sm">Nenhum contato.</p>
              <p className="text-slate-300 text-xs mt-1">Decisores, técnicos, financeiros.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
