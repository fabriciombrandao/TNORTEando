import { useState, useRef } from "react";
import { importarCSV } from "../services/api";
import type { ResultadoImportacao } from "../types";
import toast from "react-hot-toast";
import { UploadCloud, CheckCircle, AlertTriangle, XCircle, Users, Building2, FileText } from "lucide-react";

export default function ImportacaoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const processar = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast.error("Apenas arquivos .csv são aceitos.");
      return;
    }
    setLoading(true);
    setResultado(null);
    try {
      const res = await importarCSV(file);
      setResultado(res);
      toast.success("Importação concluída!");
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Erro na importação.");
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processar(file);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-white mb-2">Importação de Dados</h1>
      <p className="text-sm text-slate-400 mb-6">
        Importe o CSV de contratos para popular clientes, vendedores e hierarquia de vendas.
      </p>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-indigo-500 bg-indigo-500/10"
            : "border-slate-700 hover:border-slate-500 bg-slate-800/30"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && processar(e.target.files[0])}
        />
        <UploadCloud className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-white">
          {loading ? "Processando..." : "Arraste o CSV aqui ou clique para selecionar"}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Formato: separado por ponto e vírgula · encoding ISO-8859-1
        </p>
      </div>

      {/* Resultado */}
      {resultado && (
        <div className="mt-6 space-y-4">
          {/* Resumo */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Organizações", value: resultado.organizacoes_criadas, icon: Building2, color: "text-teal-400" },
              { label: "Usuários", value: resultado.usuarios_criados, icon: Users, color: "text-indigo-400" },
              { label: "Clientes", value: resultado.clientes_criados, icon: Users, color: "text-blue-400" },
              { label: "Contratos", value: resultado.contratos_criados, icon: FileText, color: "text-purple-400" },
              { label: "Vínculos", value: resultado.vinculos_criados, icon: CheckCircle, color: "text-emerald-400" },
              { label: "Erros", value: resultado.erros.length, icon: XCircle, color: resultado.erros.length > 0 ? "text-red-400" : "text-slate-500" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <Icon className={`w-5 h-5 ${color} mb-2`} />
                <p className="text-2xl font-semibold text-white">{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Clientes órfãos */}
          {resultado.clientes_orfaos.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <p className="text-sm font-medium text-amber-300">
                  {resultado.clientes_orfaos.length} cliente(s) sem atribuição
                </p>
              </div>
              <div className="space-y-1.5">
                {resultado.clientes_orfaos.map((c) => (
                  <div key={c.codigo} className="text-xs text-slate-300 flex gap-2">
                    <span className="text-slate-500 font-mono">{c.codigo}</span>
                    <span>{c.razao_social}</span>
                    <span className="text-slate-500">{c.municipio || "sem município"} / {c.uf}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-400/70 mt-3">
                Estes clientes foram importados com status "Pendente" e precisam ser atribuídos a um vendedor.
              </p>
            </div>
          )}

          {/* Avisos */}
          {resultado.avisos.length > 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
              <p className="text-xs font-medium text-slate-400 mb-2">Avisos ({resultado.avisos.length})</p>
              <div className="space-y-1">
                {resultado.avisos.map((a, i) => (
                  <p key={i} className="text-xs text-slate-400">• {a}</p>
                ))}
              </div>
            </div>
          )}

          {/* Erros */}
          {resultado.erros.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-xs font-medium text-red-400 mb-2">Erros ({resultado.erros.length})</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {resultado.erros.map((e, i) => (
                  <p key={i} className="text-xs text-red-300">• {e}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
