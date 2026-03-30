import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { Search, ChevronDown, ChevronRight, Download, FileText, FileSpreadsheet } from "lucide-react";

const getAuditoria = (params: any) =>
  api.get("/api/v1/auditoria", { params }).then(r => r.data);

const ACOES = ["", "LOGIN", "LOGIN_FALHA", "LOGOUT", "CREATE", "UPDATE", "DELETE"];
const ENTIDADES = ["", "usuarios", "clientes", "contratos", "visitas", "agenda"];

const BADGE: Record<string, string> = {
  LOGIN:       "bg-blue-50 text-blue-700",
  LOGIN_FALHA: "bg-red-50 text-red-700",
  LOGOUT:      "bg-emerald-50 text-emerald-700",
  CREATE:      "bg-emerald-50 text-emerald-700",
  UPDATE:      "bg-amber-50 text-amber-700",
  DELETE:      "bg-red-50 text-red-700",
};

function formatDT(dt: string) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

function DiffView({ antes, depois }: { antes: any; depois: any }) {
  if (!antes && !depois) return null;
  const keys = [...new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})])];
  return (
    <div className="grid grid-cols-2 gap-0 m-3 rounded-xl overflow-hidden border border-slate-100">
      <div className="bg-red-50 p-4">
        <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-3">Antes</p>
        {keys.map(k => (
          <div key={k} className="flex justify-between py-1.5 border-b border-red-100 last:border-0 text-xs">
            <span className="text-slate-500 font-medium">{k}</span>
            <span className="text-slate-800 font-semibold ml-4 text-right">{String(antes?.[k] ?? "—")}</span>
          </div>
        ))}
      </div>
      <div className="bg-emerald-50 p-4">
        <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-3">Depois</p>
        {keys.map(k => (
          <div key={k} className={`flex justify-between py-1.5 border-b border-emerald-100 last:border-0 text-xs ${
            JSON.stringify(antes?.[k]) !== JSON.stringify(depois?.[k]) ? "font-bold" : ""
          }`}>
            <span className="text-slate-500 font-medium">{k}</span>
            <span className={`ml-4 text-right font-semibold ${
              JSON.stringify(antes?.[k]) !== JSON.stringify(depois?.[k])
                ? "text-emerald-700" : "text-slate-800"
            }`}>{String(depois?.[k] ?? "—")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinhaAudit({ row }: { row: any }) {
  const [expandido, setExpandido] = useState(false);
  const temDiff = row.valor_anterior || row.valor_novo;

  return (
    <>
      <tr
        className={`border-b border-slate-50 ${temDiff ? "cursor-pointer hover:bg-slate-50" : ""}`}
        onClick={() => temDiff && setExpandido(!expandido)}
      >
        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDT(row.criado_em)}</td>
        <td className="px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">{row.usuario_nome || "—"}</p>
          <p className="text-xs text-slate-400">{row.usuario_email || "—"}</p>
        </td>
        <td className="px-4 py-3">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${BADGE[row.acao] || "bg-slate-100 text-slate-600"}`}>
            {row.acao}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">{row.entidade || "—"}</td>
        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">{row.descricao}</td>
        <td className="px-4 py-3 text-xs font-mono text-slate-400">{row.ip || "—"}</td>
        <td className="px-4 py-3 text-slate-300">
          {temDiff && (expandido ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
        </td>
      </tr>
      {expandido && temDiff && (
        <tr className="bg-slate-50/50">
          <td colSpan={7} className="p-0">
            <DiffView antes={row.valor_anterior} depois={row.valor_novo} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditoriaPage() {
  const [filtros, setFiltros] = useState({
    acao: "", entidade: "", usuario_email: "",
    data_inicio: "", data_fim: "", limit: 100,
  });
  const [aplicados, setAplicados] = useState(filtros);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["auditoria", aplicados],
    queryFn: () => getAuditoria(Object.fromEntries(
      Object.entries(aplicados).filter(([, v]) => v !== "")
    )),
  });

  function exportarCSV() {
    const cols = ["criado_em","usuario_nome","usuario_email","acao","entidade","descricao","ip","sucesso"];
    const header = cols.join(";");
    const body = (rows as any[]).map(r =>
      cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";")
    ).join("\n");
    const blob = new Blob(["\ufeff" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `auditoria_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportarExcel() {
    // Exportar como CSV com extensão .xlsx (abre no Excel)
    const cols = ["criado_em","usuario_nome","usuario_email","acao","entidade","descricao","ip","sucesso"];
    const header = cols.join("\t");
    const body = (rows as any[]).map(r =>
      cols.map(c => String(r[c] ?? "")).join("\t")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `auditoria_${new Date().toISOString().slice(0,10)}.xls`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportarPDF() {
    const cols = ["Data/Hora","Usuário","E-mail","Ação","Entidade","Descrição","IP"];
    const keys = ["criado_em","usuario_nome","usuario_email","acao","entidade","descricao","ip"];
    let html = `<html><head><meta charset="utf-8">
    <style>body{font-family:Arial,sans-serif;font-size:11px}
    h2{margin-bottom:12px;font-size:14px}
    table{width:100%;border-collapse:collapse}
    th{background:#4f46e5;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
    td{padding:5px 8px;border-bottom:1px solid #e8eaed;font-size:10px}
    tr:nth-child(even) td{background:#f8f9fb}
    </style></head><body>
    <h2>Auditoria do Sistema — TNORTEando</h2>
    <p style="font-size:10px;color:#666;margin-bottom:12px">Gerado em: ${new Date().toLocaleString("pt-BR")}</p>
    <table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>
    ${(rows as any[]).map(r => `<tr>${keys.map(k => `<td>${String(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}
    </tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Auditoria do Sistema</h1>
          <p className="text-sm text-slate-500 mt-0.5">Rastreabilidade completa de ações dos usuários.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportarCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">
            <FileText className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={exportarExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-50">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={exportarPDF}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50">
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ação</label>
          <select value={filtros.acao} onChange={e => setFiltros(f => ({...f, acao: e.target.value}))} className="input text-sm">
            {ACOES.map(a => <option key={a} value={a}>{a || "Todas"}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Entidade</label>
          <select value={filtros.entidade} onChange={e => setFiltros(f => ({...f, entidade: e.target.value}))} className="input text-sm">
            {ENTIDADES.map(e => <option key={e} value={e}>{e || "Todas"}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Usuário</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={filtros.usuario_email}
              onChange={e => setFiltros(f => ({...f, usuario_email: e.target.value}))}
              className="input pl-8 text-sm" placeholder="e-mail..." />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Data início</label>
          <input type="date" value={filtros.data_inicio}
            onChange={e => setFiltros(f => ({...f, data_inicio: e.target.value}))} className="input text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Data fim</label>
          <input type="date" value={filtros.data_fim}
            onChange={e => setFiltros(f => ({...f, data_fim: e.target.value}))} className="input text-sm" />
        </div>
        <div className="flex items-end">
          <button onClick={() => setAplicados(filtros)}
            className="btn-primary btn-md btn-full">
            Filtrar
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <p className="text-center py-12 text-slate-400 text-sm">Carregando...</p>
        ) : (rows as any[]).length === 0 ? (
          <p className="text-center py-12 text-slate-400 text-sm">Nenhum registro encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Data / Hora</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Usuário</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Ação</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Entidade</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Descrição</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">IP</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {(rows as any[]).map((row: any) => (
                  <LinhaAudit key={row.id} row={row} />
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <p className="text-xs text-slate-400">{(rows as any[]).length} registros</p>
              <select value={filtros.limit}
                onChange={e => { const l = Number(e.target.value); setFiltros(f => ({...f, limit: l})); setAplicados(f => ({...f, limit: l})); }}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1">
                <option value={50}>50 por página</option>
                <option value={100}>100 por página</option>
                <option value={500}>500 por página</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
