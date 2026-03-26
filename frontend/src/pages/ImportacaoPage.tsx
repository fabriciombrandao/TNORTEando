import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import {
  Upload, FileText, CheckCircle, AlertTriangle,
  Users, Building2, MapPin, ArrowRight, Loader2,
  XCircle, RefreshCw
} from "lucide-react";

const analisarCSV = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/v1/importacao/analisar", form).then(r => r.data);
};

const importarCSV = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/v1/importacao/csv", form).then(r => r.data);
};

type Analise = {
  valido: boolean;
  arquivo: { total_linhas: number; organizacao: { codigo: string; nome: string; existente: boolean } };
  hierarquia: {
    dsns: { total: number; novos: number; lista: { codigo: string; nome: string; novo: boolean }[] };
    gsns: { total: number; novos: number; lista: { codigo: string; nome: string; novo: boolean }[] };
    esns: { total: number; novos: number; lista: { codigo: string; nome: string; novo: boolean }[] };
  };
  clientes:  { total: number; novos: number; existentes: number; sem_esn: number };
  contratos: { total: number; novos: number; existentes: number };
  municipios: { nome: string; clientes: number }[];
  alertas: string[];
};

type Resultado = {
  sucesso: boolean;
  organizacoes_criadas: number;
  usuarios_criados: number;
  vinculos_criados: number;
  clientes_criados: number;
  contratos_criados: number;
  avisos: string[];
  erros: string[];
};

export default function ImportacaoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [etapa, setEtapa] = useState<"selecao" | "analise" | "importando" | "concluido">("selecao");

  const mutAnalise = useMutation({
    mutationFn: analisarCSV,
    onSuccess: (data) => { setAnalise(data); setEtapa("analise"); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao analisar arquivo."),
  });

  const mutImportar = useMutation({
    mutationFn: importarCSV,
    onSuccess: (data) => { setResultado(data); setEtapa("concluido"); },
    onError: (e: any) => {
      toast.error(e.response?.data?.detail || "Erro na importação.");
      setEtapa("analise");
    },
  });

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast.error("Selecione um arquivo CSV.");
      return;
    }
    setArquivo(file);
    setAnalise(null);
    setResultado(null);
    setEtapa("selecao");
  };

  const handleAnalisar = () => {
    if (!arquivo) return;
    mutAnalise.mutate(arquivo);
  };

  const handleImportar = () => {
    if (!arquivo) return;
    setEtapa("importando");
    mutImportar.mutate(arquivo);
  };

  const resetar = () => {
    setArquivo(null);
    setAnalise(null);
    setResultado(null);
    setEtapa("selecao");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in">

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Importação de Contratos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Importe o relatório CSV exportado do TOTVS. O sistema analisa o arquivo antes de importar.
        </p>
      </div>

      {/* Etapa 1 — Seleção do arquivo */}
      <div className="card mb-4">
        <div className="card-header flex items-center justify-between">
          <span className="font-semibold text-slate-900 text-sm">1. Selecionar arquivo</span>
          {arquivo && (
            <button onClick={resetar} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> Limpar
            </button>
          )}
        </div>
        <div className="card-body">
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              arquivo ? "border-indigo-300 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <input ref={inputRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {arquivo ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-indigo-500" />
                <div className="text-left">
                  <p className="font-semibold text-slate-900">{arquivo.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{(arquivo.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-600">Clique ou arraste o arquivo CSV aqui</p>
                <p className="text-xs text-slate-400 mt-1">Formato: contractsReport.csv · Encoding: ISO-8859-1</p>
              </>
            )}
          </div>

          {arquivo && etapa === "selecao" && (
            <button
              onClick={handleAnalisar}
              disabled={mutAnalise.isPending}
              className="btn-primary btn-md btn-full mt-4"
            >
              {mutAnalise.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Analisando arquivo...</>
                : <><FileText className="w-4 h-4" /> Analisar arquivo</>
              }
            </button>
          )}
        </div>
      </div>

      {/* Etapa 2 — Análise */}
      {analise && etapa === "analise" && (
        <div className="space-y-4">

          {/* Alertas */}
          {analise.alertas.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-800">Atenção</span>
              </div>
              {analise.alertas.map((a, i) => (
                <p key={i} className="text-sm text-amber-700 ml-6">· {a}</p>
              ))}
            </div>
          )}

          {/* Organização */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Organização</span>
            </div>
            <div className="card-body flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">{analise.arquivo.organizacao.nome}</p>
                <p className="text-xs text-slate-400 font-mono">{analise.arquivo.organizacao.codigo}</p>
              </div>
              {analise.arquivo.organizacao.existente
                ? <span className="badge-green">Já cadastrada</span>
                : <span className="badge-blue">Nova</span>
              }
            </div>
          </div>

          {/* Hierarquia */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900 text-sm">Hierarquia de vendas</span>
            </div>
            <div className="card-body space-y-4">
              {(["dsns","gsns","esns"] as const).map(tipo => {
                const label = { dsns: "DSN", gsns: "GSN", esns: "ESN" }[tipo];
                const dados = analise.hierarquia[tipo];
                return (
                  <div key={tipo}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}s ({dados.total})</span>
                      {dados.novos > 0 && (
                        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          {dados.novos} novo{dados.novos > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {dados.lista.map(u => (
                        <div key={u.codigo} className="flex items-center justify-between text-sm py-1 border-b border-slate-50 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400">{u.codigo}</span>
                            <span className="text-slate-700">{u.nome}</span>
                          </div>
                          {u.novo
                            ? <span className="text-xs text-indigo-500 font-medium">Novo</span>
                            : <span className="text-xs text-slate-400">Existente</span>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Clientes e Contratos */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <div className="card-header">
                <span className="font-semibold text-slate-900 text-sm">Clientes</span>
              </div>
              <div className="card-body space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Total no arquivo</span>
                  <span className="font-semibold">{analise.clientes.total}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Novos</span>
                  <span className="font-semibold text-indigo-600">{analise.clientes.novos}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Já existem</span>
                  <span className="font-semibold text-slate-400">{analise.clientes.existentes}</span>
                </div>
                {analise.clientes.sem_esn > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-600">Sem ESN</span>
                    <span className="font-semibold text-amber-600">{analise.clientes.sem_esn}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="font-semibold text-slate-900 text-sm">Contratos</span>
              </div>
              <div className="card-body space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Total no arquivo</span>
                  <span className="font-semibold">{analise.contratos.total}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Novos</span>
                  <span className="font-semibold text-indigo-600">{analise.contratos.novos}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Já existem</span>
                  <span className="font-semibold text-slate-400">{analise.contratos.existentes}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Municípios */}
          {analise.municipios.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900 text-sm">Top municípios</span>
              </div>
              <div className="card-body divide-y divide-slate-50">
                {analise.municipios.map((m, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{m.nome}</span>
                    <span className="text-slate-400 font-mono">{m.clientes} cliente{m.clientes > 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Botão confirmar */}
          <div className="flex gap-3">
            <button onClick={resetar} className="btn-secondary btn-md flex-1">
              Cancelar
            </button>
            <button onClick={handleImportar} className="btn-primary btn-md flex-1">
              <ArrowRight className="w-4 h-4" />
              Confirmar importação
            </button>
          </div>
        </div>
      )}

      {/* Etapa 3 — Importando */}
      {etapa === "importando" && (
        <div className="card">
          <div className="card-body flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
            <p className="font-semibold text-slate-700">Importando dados...</p>
            <p className="text-sm text-slate-400 text-center">
              Aguarde. Estamos processando a hierarquia, clientes e contratos.
            </p>
          </div>
        </div>
      )}

      {/* Etapa 4 — Resultado */}
      {resultado && etapa === "concluido" && (
        <div className="space-y-4">

          {/* Status */}
          <div className={`card border-t-2 ${resultado.sucesso ? "border-t-emerald-400" : "border-t-red-400"}`}>
            <div className="card-body flex items-center gap-4 py-5">
              {resultado.sucesso
                ? <CheckCircle className="w-10 h-10 text-emerald-500 flex-shrink-0" />
                : <XCircle className="w-10 h-10 text-red-500 flex-shrink-0" />
              }
              <div>
                <p className="font-bold text-slate-900">
                  {resultado.sucesso ? "Importação concluída com sucesso!" : "Importação com erros"}
                </p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {resultado.sucesso
                    ? "Todos os dados foram processados."
                    : "Verifique os erros abaixo."}
                </p>
              </div>
            </div>
          </div>

          {/* Resumo */}
          <div className="card">
            <div className="card-header">
              <span className="font-semibold text-slate-900 text-sm">Resumo da importação</span>
            </div>
            <div className="card-body divide-y divide-slate-50">
              {[
                { label: "Organizações criadas",  val: resultado.organizacoes_criadas },
                { label: "Usuários criados",       val: resultado.usuarios_criados },
                { label: "Vínculos criados",       val: resultado.vinculos_criados },
                { label: "Clientes criados",       val: resultado.clientes_criados },
                { label: "Contratos criados",      val: resultado.contratos_criados },
              ].map(({ label, val }) => (
                <div key={label} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className={`font-bold ${val > 0 ? "text-indigo-600" : "text-slate-400"}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Avisos */}
          {resultado.avisos.length > 0 && (
            <div className="card border-amber-100">
              <div className="card-header flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-amber-700 text-sm">Avisos ({resultado.avisos.length})</span>
              </div>
              <div className="card-body space-y-1 max-h-48 overflow-y-auto">
                {resultado.avisos.map((a, i) => (
                  <p key={i} className="text-xs text-amber-700">· {a}</p>
                ))}
              </div>
            </div>
          )}

          {/* Erros */}
          {resultado.erros.length > 0 && (
            <div className="card border-red-100">
              <div className="card-header flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="font-semibold text-red-700 text-sm">Erros ({resultado.erros.length})</span>
              </div>
              <div className="card-body space-y-1 max-h-48 overflow-y-auto">
                {resultado.erros.map((e, i) => (
                  <p key={i} className="text-xs text-red-700">· {e}</p>
                ))}
              </div>
            </div>
          )}

          <button onClick={resetar} className="btn-secondary btn-md btn-full">
            <RefreshCw className="w-4 h-4" /> Nova importação
          </button>
        </div>
      )}
    </div>
  );
}
