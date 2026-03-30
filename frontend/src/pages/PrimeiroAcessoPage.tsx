import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../store/auth";
import { KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

export default function PrimeiroAcessoPage() {
  const navigate = useNavigate();
  const { usuario, setAuth, accessToken } = useAuthStore();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrar, setMostrar] = useState(false);

  const valida = senha.length >= 6 && senha === confirma;

  const mut = useMutation({
    mutationFn: () => api.post("/api/v1/auth/trocar-senha", { senha }).then(r => r.data),
    onSuccess: () => {
      toast.success("Senha definida com sucesso!");
      // Atualizar o usuario no store sem primeiro_acesso
      if (usuario && accessToken) {
        setAuth({ ...usuario, primeiro_acesso: false }, accessToken);
      }
      navigate("/");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao trocar senha."),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200 mb-5">
            <ShieldCheck className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Primeiro acesso</h1>
          <p className="text-slate-500 text-sm mt-2">
            Olá, <strong>{usuario?.nome?.split(" ")[0]}</strong>! Por segurança, defina uma nova senha para continuar.
          </p>
        </div>

        <div className="card p-6 shadow-xl shadow-slate-100 space-y-4">
          <div>
            <label className="label mb-1.5 block">Nova senha</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={mostrar ? "text" : "password"}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                className="input pl-10 pr-10"
                placeholder="Mínimo 6 caracteres"
              />
              <button onClick={() => setMostrar(!mostrar)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label mb-1.5 block">Confirmar senha</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={mostrar ? "text" : "password"}
                value={confirma}
                onChange={e => setConfirma(e.target.value)}
                className={`input pl-10 ${confirma && !valida ? "border-red-300 focus:border-red-400" : ""}`}
                placeholder="Repita a nova senha"
              />
            </div>
            {confirma && senha !== confirma && (
              <p className="text-xs text-red-500 mt-1">As senhas não coincidem.</p>
            )}
          </div>

          <button
            onClick={() => mut.mutate()}
            disabled={!valida || mut.isPending}
            className="btn-primary btn-lg btn-full mt-2"
          >
            {mut.isPending ? "Salvando..." : "Definir senha e entrar"}
          </button>
        </div>

      </div>
    </div>
  );
}
