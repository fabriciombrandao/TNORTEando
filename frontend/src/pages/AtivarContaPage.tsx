import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../services/api";
import { ShieldCheck, Eye, EyeOff, KeyRound } from "lucide-react";

export default function AtivarContaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  const valida = senha.length >= 6 && senha === confirma;

  async function ativar() {
    setLoading(true); setErro("");
    try {
      await api.post("/api/v1/auth/ativar", { token, senha });
      setSucesso(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (e: any) {
      setErro(e.response?.data?.detail || "Erro ao ativar conta.");
    } finally { setLoading(false); }
  }

  if (!token) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <p className="text-red-500">Link inválido.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200 mb-5">
            <ShieldCheck className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Ativar conta</h1>
          <p className="text-slate-500 text-sm mt-2">Defina sua senha para acessar o sistema.</p>
        </div>

        {sucesso ? (
          <div className="card p-6 text-center">
            <p className="text-emerald-600 font-semibold">Conta ativada com sucesso!</p>
            <p className="text-slate-400 text-sm mt-1">Redirecionando para o login...</p>
          </div>
        ) : (
          <div className="card p-6 shadow-xl shadow-slate-100 space-y-4">
            {erro && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}
            <div>
              <label className="label mb-1.5 block">Nova senha</label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type={mostrar ? "text" : "password"} value={senha}
                  onChange={e => setSenha(e.target.value)}
                  className="input pl-10 pr-10" placeholder="Mínimo 6 caracteres" />
                <button onClick={() => setMostrar(!mostrar)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="label mb-1.5 block">Confirmar senha</label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type={mostrar ? "text" : "password"} value={confirma}
                  onChange={e => setConfirma(e.target.value)}
                  className={`input pl-10 ${confirma && !valida ? "border-red-300" : ""}`}
                  placeholder="Repita a senha" />
              </div>
              {confirma && senha !== confirma && <p className="text-xs text-red-500 mt-1">As senhas não coincidem.</p>}
            </div>
            <button onClick={ativar} disabled={!valida || loading} className="btn-primary btn-lg btn-full">
              {loading ? "Ativando..." : "Ativar conta"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
