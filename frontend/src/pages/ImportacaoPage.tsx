import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import {
  Upload, FileText, CheckCircle, AlertTriangle,
  Users, Building2, MapPin, ArrowRight, Loader2,
  XCircle, RefreshCw, ChevronDown, ChevronUp, Search
} from "lucide-react";

// ── API ───────────────────────────────────────────────────────────────────────
const analisarCSV  = (file: File) => { const f = new FormData(); f.append("file", file); return api.post("/api/v1/importacao/analisar", f).then(r => r.data); };
const importarCSV  = (payload: {file: File; selecao: any}) => {
  const f = new FormData();
  f.append("file", payload.file);
  f.append("selecao", JSON.stringify(payload.selecao));
  return api.post("/api/v1/importacao/csv-selecionado", f).then(r => r.data);
};

// ── Types ─────────────────────────────────────────────────────────────────────
type UsuarioItem = { codigo: string; nome: string; email: string; novo: boolean };
type ClienteItem = { codigo: string; nome: string; cnpj: string; municipio: string; uf: string; esn: string; esn_nome: string; novo: boolean; sem_esn: boolean };
type ContratoItem = { numero: string; cliente_cod: string; cliente_nome: string; status: string; modalidade: string; mrr: number; novo: boolean };
type Analise = {
  valido: boolean;
  arquivo: { total_linhas: number; organizacao: { codigo: string; nome: string; existente: boolean } };
  hierarquia: { dsns: UsuarioItem[]; gsns: UsuarioItem[]; esns: UsuarioItem[] };
  clientes: ClienteItem[];
  contratos: ContratoItem[];
  municipios: { nome: string; clientes: number }[];
  alertas: string[];
};
type Resultado = { sucesso: boolean; organizacoes_criadas: number; usuarios_criados: number; vinculos_criados: number; clientes_criados: number; contratos_criados: number; avisos: string[]; erros: string[] };

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCNPJ(cnpj: string) { if (!cnpj) return "—"; return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"); }
function formatBRL(v: number) { return v > 0 ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v) : "—"; }

// ── Checkbox ──────────────────────────────────────────────────────────────────
function CB({ checked, warn, onChange }: { checked: boolean; warn?: boolean; onChange: (e?: any) => void }) {
  return (
    <button onClick={onChange}
      className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
        checked ? "bg-indigo-600 border-indigo-600 text-white" : warn ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white"
      }`}>
      {checked && <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </button>
  );
}

// ── Seção expansível ──────────────────────────────────────────────────────────
function Secao({ titulo, badge, todos, onChange, children }: { titulo: string; badge?: React.ReactNode; todos: boolean; onChange: () => void; children: React.ReactNode }) {
  const [aberta, setAberta] = useState(true);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-2">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 cursor-pointer hover:bg-slate-100" onClick={() => setAberta(!aberta)}>
        <CB checked={todos} onChange={() => onChange()} />
        <span className="text-xs font-semibold text-slate-700 flex-1" onClick={e => e.stopPropagation()}>{titulo}</span>
        {badge}
        {aberta ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
      </div>
      {aberta && <div className="divide-y divide-slate-50">{children}</div>}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ImportacaoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo]   = useState<File | null>(null);
  const [analise, setAnalise]   = useState<Analise | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [etapa, setEtapa]       = useState<"selecao"|"analise"|"importando"|"concluido">("selecao");
  const [busca, setBusca]       = useState("");

  // Seleções
  const [selDsns,      setSelDsns]      = useState<Set<string>>(new Set());
  const [selGsns,      setSelGsns]      = useState<Set<string>>(new Set());
  const [selEsns,      setSelEsns]      = useState<Set<string>>(new Set());
  const [selClientes,  setSelClientes]  = useState<Set<string>>(new Set());
  const [selContratos, setSelContratos] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setFn(n);
  };

  const toggleAll = (set: Set<string>, setFn: (s: Set<string>) => void, keys: string[]) => {
    setFn(set.size === keys.length ? new Set() : new Set(keys));
  };

  // Quando desmarca cliente, desmarca contratos dele automaticamente
  const toggleCliente = (cod: string) => {
    const nCli = new Set(selClientes);
    if (nCli.has(cod)) {
      nCli.delete(cod);
      // Desmarcar contratos do cliente
      const nCt = new Set(selContratos);
      analise?.contratos.filter(c => c.cliente_cod === cod).forEach(c => nCt.delete(c.numero));
      setSelContratos(nCt);
    } else {
      nCli.add(cod);
      // Marcar contratos do cliente
      const nCt = new Set(selContratos);
      analise?.contratos.filter(c => c.cliente_cod === cod).forEach(c => nCt.add(c.numero));
      setSelContratos(nCt);
    }
    setSelClientes(nCli);
  };

  const mutAnalise = useMutation({
    mutationFn: analisarCSV,
    onSuccess: (data: Analise) => {
      setAnalise(data);
      // Selecionar tudo por padrão
      setSelDsns(new Set(data.hierarquia.dsns.map(u => u.codigo)));
      setSelGsns(new Set(data.hierarquia.gsns.map(u => u.codigo)));
      setSelEsns(new Set(data.hierarquia.esns.map(u => u.codigo)));
      setSelClientes(new Set(data.clientes.map(c => c.codigo)));
      setSelContratos(new Set(data.contratos.map(c => c.numero)));
      setEtapa("analise");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao analisar arquivo."),
  });

  const mutImportar = useMutation({
    mutationFn: importarCSV,
    onSuccess: (data) => { setResultado(data); setEtapa("concluido"); },
    onError: (e: any) => { toast.error(e.response?.data?.detail || "Erro na importação."); setEtapa("analise"); },
  });

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) { toast.error("Selecione um arquivo CSV."); return; }
    setArquivo(file); setAnalise(null); setResultado(null); setEtapa("selecao");
  };

  const handleImportar = () => {
    if (!arquivo || !analise) return;
    setEtapa("importando");
    mutImportar.mutate({
      file: arquivo!,
      selecao: { dsns: [...selDsns], gsns: [...selGsns], esns: [...selEsns], clientes: [...selClientes], contratos: [...selContratos] },
    });
  };

  const resetar = () => {
    setArquivo(null); setAnalise(null); setResultado(null); setEtapa("selecao");
    if (inputRef.current) inputRef.current.value = "";
  };

  const clientesFiltrados = analise?.clientes.filter(c =>
    !busca || c.nome.toLowerCase().includes(busca.toLowerCase()) ||
    c.codigo.toLowerCase().includes(busca.toLowerCase()) ||
    (c.cnpj||"").includes(busca) ||
    (c.municipio||"").toLowerCase().includes(busca.toLowerCase()) ||
    (c.esn_nome||"").toLowerCase().includes(busca.toLowerCase())
  ) || [];

  const semEsn = analise?.clientes.filter(c => c.sem_esn) || [];
  const selecionados = selClientes.size;
  const ignorados = (analise?.clientes.length || 0) - selecionados;

  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Importação de Contratos</h1>
        <p className="text-sm text-slate-500 mt-1">Selecione o CSV do TOTVS. O sistema analisa antes de importar — você pode revisar e desmarcar registros.</p>
      </div>

      {/* ── ETAPA 1: Seleção ── */}
      <div className="card mb-4">
        <div className="card-header flex items-center justify-between">
          <span className="font-semibold text-slate-900 text-sm">1. Selecionar arquivo</span>
          {arquivo && <button onClick={resetar} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"><XCircle className="w-3.5 h-3.5"/>Limpar</button>}
        </div>
        <div className="card-body">
          <div className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${arquivo?"border-indigo-300 bg-indigo-50/30":"border-slate-200 hover:border-indigo-300 hover:bg-slate-50"}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleFile(f); }}>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); }}/>
            {arquivo ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-indigo-500"/>
                <div className="text-left">
                  <p className="font-semibold text-slate-900">{arquivo.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{(arquivo.size/1024).toFixed(0)} KB</p>
                </div>
              </div>
            ) : (
              <><Upload className="w-10 h-10 text-slate-300 mx-auto mb-3"/>
              <p className="text-sm font-medium text-slate-600">Clique ou arraste o arquivo CSV aqui</p>
              <p className="text-xs text-slate-400 mt-1">Formato: contractsReport.csv · Encoding: ISO-8859-1</p></>
            )}
          </div>
          {arquivo && etapa==="selecao" && (
            <button onClick={() => mutAnalise.mutate(arquivo!)} disabled={mutAnalise.isPending} className="btn-primary btn-md btn-full mt-4">
              {mutAnalise.isPending ? <><Loader2 className="w-4 h-4 animate-spin"/>Analisando...</> : <><FileText className="w-4 h-4"/>Analisar arquivo</>}
            </button>
          )}
        </div>
      </div>

      {/* ── ETAPA 2: Análise + Seleção ── */}
      {analise && etapa==="analise" && (
        <div className="space-y-4">

          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {val: analise.clientes.length, lbl: "No arquivo",    cor: "#4f46e5"},
              {val: selecionados,            lbl: "Selecionados",  cor: "#1a7a4a"},
              {val: semEsn.length,           lbl: "Sem ESN",       cor: "#92600a"},
              {val: ignorados,               lbl: "Ignorados",     cor: "#6b7280"},
            ].map(({val,lbl,cor}) => (
              <div key={lbl} className="bg-white border border-slate-200 rounded-xl p-3" style={{borderTop:`2px solid ${cor}`}}>
                <p className="text-xl font-bold" style={{color:cor}}>{val}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lbl}</p>
              </div>
            ))}
          </div>

          {/* Alertas */}
          {analise.alertas.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5"><AlertTriangle className="w-4 h-4 text-amber-500"/><span className="text-sm font-semibold text-amber-800">Atenção</span></div>
              {analise.alertas.map((a,i) => <p key={i} className="text-sm text-amber-700 ml-6">· {a}</p>)}
            </div>
          )}

          {/* Organização */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400"/>
              <span className="font-semibold text-slate-900 text-sm">Organização</span>
            </div>
            <div className="card-body flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">{analise.arquivo.organizacao.nome}</p>
                <p className="text-xs text-slate-400 font-mono">{analise.arquivo.organizacao.codigo}</p>
              </div>
              <span className={`badge ${analise.arquivo.organizacao.existente?"badge-gray":"badge-blue"}`}>
                {analise.arquivo.organizacao.existente?"Já cadastrada":"Nova"}
              </span>
            </div>
          </div>

          {/* Hierarquia */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400"/>
              <span className="font-semibold text-slate-900 text-sm">Hierarquia de vendas</span>
            </div>
            <div className="card-body">
              {([
                {label:`DSNs (${analise.hierarquia.dsns.length})`, items: analise.hierarquia.dsns, sel: selDsns, setFn: setSelDsns},
                {label:`GSNs (${analise.hierarquia.gsns.length})`, items: analise.hierarquia.gsns, sel: selGsns, setFn: setSelGsns},
                {label:`ESNs (${analise.hierarquia.esns.length})`, items: analise.hierarquia.esns, sel: selEsns, setFn: setSelEsns},
              ] as any[]).map(({label, items, sel, setFn}) => (
                <Secao key={label} titulo={label} todos={sel.size===items.length}
                  onChange={() => toggleAll(sel, setFn, items.map((u:any)=>u.codigo))}
                  badge={items.filter((u:any)=>u.novo).length > 0 && (
                    <span className="badge-blue text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-semibold ml-auto mr-2">
                      {items.filter((u:any)=>u.novo).length} novo(s)
                    </span>
                  )}>
                  {items.map((u:any) => (
                    <div key={u.codigo} className={`flex items-center gap-3 px-3 py-2 ${!sel.has(u.codigo)?"opacity-50 bg-slate-50":""}`}>
                      <CB checked={sel.has(u.codigo)} onChange={() => toggle(sel, setFn, u.codigo)}/>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${!sel.has(u.codigo)?"line-through text-slate-400":"text-slate-800"}`}>{u.nome}</p>
                        <p className="text-xs text-slate-400 font-mono">{u.codigo} · {u.email}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.novo?"bg-indigo-50 text-indigo-600":"bg-slate-100 text-slate-400"}`}>
                        {u.novo?"Novo":"Existente"}
                      </span>
                    </div>
                  ))}
                </Secao>
              ))}
            </div>
          </div>

          {/* Clientes */}
          <div className="card">
            <div className="card-header flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-sm">Clientes ({analise.clientes.length})</span>
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
                <input value={busca} onChange={e=>setBusca(e.target.value)}
                  placeholder="Filtrar clientes..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"/>
              </div>
            </div>

            {/* Selecionar todos */}
            <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100">
              <CB checked={selClientes.size===analise.clientes.length}
                onChange={() => {
                  if (selClientes.size===analise.clientes.length) {
                    setSelClientes(new Set()); setSelContratos(new Set());
                  } else {
                    setSelClientes(new Set(analise.clientes.map(c=>c.codigo)));
                    setSelContratos(new Set(analise.contratos.map(c=>c.numero)));
                  }
                }}/>
              <span className="text-xs text-slate-500 flex-1">Selecionar todos</span>
              <span className="text-xs text-slate-400">{selClientes.size} de {analise.clientes.length} selecionados</span>
            </div>

            <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
              {clientesFiltrados.map(c => (
                <div key={c.codigo}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                    !selClientes.has(c.codigo) ? "opacity-50 bg-slate-50" :
                    c.sem_esn ? "bg-amber-50/50" : ""
                  }`}>
                  <CB checked={selClientes.has(c.codigo)} warn={c.sem_esn && selClientes.has(c.codigo)}
                    onChange={() => toggleCliente(c.codigo)}/>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${!selClientes.has(c.codigo)?"line-through text-slate-400":"text-slate-800"}`}>
                      {c.nome}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">{c.codigo} · {formatCNPJ(c.cnpj)}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {c.municipio && <span className="text-xs text-slate-400 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5"/>{c.municipio}/{c.uf}</span>}
                      {c.sem_esn
                        ? <span className="text-xs text-amber-600 font-medium">⚠ Sem ESN</span>
                        : <span className="text-xs text-slate-400">ESN: {c.esn_nome}</span>
                      }
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    !selClientes.has(c.codigo) ? "bg-slate-100 text-slate-400" :
                    c.sem_esn ? "bg-amber-50 text-amber-600" :
                    c.novo ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    {!selClientes.has(c.codigo) ? "Ignorar" : c.sem_esn ? "Sem ESN" : c.novo ? "Novo" : "Existente"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Contratos */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span className="font-semibold text-slate-900 text-sm">Contratos ({analise.contratos.length})</span>
              <span className="text-xs text-slate-400">{selContratos.size} selecionados</span>
            </div>
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
              ℹ Contratos de clientes desmarcados são excluídos automaticamente.
            </div>
            <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
              {analise.contratos.map(ct => {
                const clienteSel = selClientes.has(ct.cliente_cod);
                const ctSel = selContratos.has(ct.numero) && clienteSel;
                return (
                  <div key={ct.numero} className={`flex items-center gap-3 px-3 py-2 ${!ctSel?"opacity-50 bg-slate-50":""}`}>
                    <CB checked={ctSel && clienteSel}
                      onChange={() => { if (!clienteSel) return; toggle(selContratos, setSelContratos, ct.numero); }}/>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${!ctSel?"line-through text-slate-400":"text-slate-800"}`}>
                        {ct.numero}
                      </p>
                      <p className="text-xs text-slate-400">{ct.cliente_nome} · {ct.status}{ct.mrr>0?` · ${formatBRL(ct.mrr)}/mês`:""}</p>
                      {!clienteSel && <p className="text-xs text-slate-400">Cliente desmarcado</p>}
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${ct.novo?"bg-indigo-50 text-indigo-600":"bg-slate-100 text-slate-400"}`}>
                      {!ctSel?"Ignorar":ct.novo?"Novo":"Existente"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Barra de confirmação */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-bold text-slate-900">Pronto para importar</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {selClientes.size} clientes · {selContratos.size} contratos ·{" "}
                {selDsns.size + selGsns.size + selEsns.size} usuários
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={resetar} className="btn-secondary btn-md">Cancelar</button>
              <button onClick={handleImportar} className="btn-primary btn-md">
                <ArrowRight className="w-4 h-4"/> Importar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ETAPA 3: Importando ── */}
      {etapa==="importando" && (
        <div className="card">
          <div className="card-body flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin"/>
            <p className="font-semibold text-slate-700">Importando dados...</p>
            <p className="text-sm text-slate-400 text-center">Aguarde. Processando hierarquia, clientes e contratos.</p>
          </div>
        </div>
      )}

      {/* ── ETAPA 4: Resultado ── */}
      {resultado && etapa==="concluido" && (
        <div className="space-y-4">
          <div className={`card border-t-2 ${resultado.sucesso?"border-t-emerald-400":"border-t-red-400"}`}>
            <div className="card-body flex items-center gap-4 py-5">
              {resultado.sucesso ? <CheckCircle className="w-10 h-10 text-emerald-500 flex-shrink-0"/> : <XCircle className="w-10 h-10 text-red-500 flex-shrink-0"/>}
              <div>
                <p className="font-bold text-slate-900">{resultado.sucesso?"Importação concluída com sucesso!":"Importação com erros"}</p>
                <p className="text-sm text-slate-500 mt-0.5">{resultado.sucesso?"Todos os dados foram processados.":"Verifique os erros abaixo."}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="font-semibold text-slate-900 text-sm">Resumo</span></div>
            <div className="card-body divide-y divide-slate-50">
              {[
                {label:"Organizações criadas", val:resultado.organizacoes_criadas},
                {label:"Usuários criados",      val:resultado.usuarios_criados},
                {label:"Vínculos criados",      val:resultado.vinculos_criados},
                {label:"Clientes criados",      val:resultado.clientes_criados},
                {label:"Contratos criados",     val:resultado.contratos_criados},
              ].map(({label,val}) => (
                <div key={label} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className={`font-bold ${val>0?"text-indigo-600":"text-slate-400"}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
          {resultado.avisos.length>0 && (
            <div className="card border-amber-100">
              <div className="card-header flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500"/><span className="font-semibold text-amber-700 text-sm">Avisos ({resultado.avisos.length})</span></div>
              <div className="card-body space-y-1 max-h-48 overflow-y-auto">
                {resultado.avisos.map((a,i) => <p key={i} className="text-xs text-amber-700">· {a}</p>)}
              </div>
            </div>
          )}
          {resultado.erros.length>0 && (
            <div className="card border-red-100">
              <div className="card-header flex items-center gap-2"><XCircle className="w-4 h-4 text-red-500"/><span className="font-semibold text-red-700 text-sm">Erros ({resultado.erros.length})</span></div>
              <div className="card-body space-y-1 max-h-48 overflow-y-auto">
                {resultado.erros.map((e,i) => <p key={i} className="text-xs text-red-700">· {e}</p>)}
              </div>
            </div>
          )}
          <button onClick={resetar} className="btn-secondary btn-md btn-full"><RefreshCw className="w-4 h-4"/>Nova importação</button>
        </div>
      )}
    </div>
  );
}
