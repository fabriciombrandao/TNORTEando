import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { Mail, MapPin } from "lucide-react";

export default function EsqueciSenhaPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErro("");
    try {
      await api.post("/api/v1/auth/esqueci-senha", { email });
      setEnviado(true);
    } catch (err: any) {
      setErro(err.response?.data?.detail || "Erro ao enviar e-mail.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200 mb-5">
            <MapPin className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">TNORTEando</h1>
          <p className="text-slate-500 text-sm mt-1">Recuperação de senha</p>
        </div>

        {enviado ? (
          <div className="card p-6 text-center space-y-3">
            <p className="text-emerald-600 font-semibold">E-mail enviado!</p>
            <p className="text-slate-500 text-sm">
              Se o e-mail existir no sistema, você receberá as instruções em breve. Verifique sua caixa de entrada.
            </p>
            <button onClick={() => navigate("/login")} className="btn-primary btn-md btn-full mt-2">
              Voltar ao login
            </button>
          </div>
        ) : (
          <div className="card p-6 shadow-xl shadow-slate-100">
            <form onSubmit={enviar} className="space-y-4">
              {erro && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}
              <p className="text-sm text-slate-500">
                Informe seu e-mail cadastrado e enviaremos um link para redefinir sua senha.
              </p>
              <div>
                <label className="label">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required className="input pl-10" placeholder="seu@email.com" />
                </div>
              </div>
              <button type="submit" disabled={loading || !email} className="btn-primary btn-lg btn-full">
                {loading ? "Enviando..." : "Enviar instruções"}
              </button>
              <button type="button" onClick={() => navigate("/login")} className="btn-secondary btn-md btn-full">
                Voltar ao login
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
