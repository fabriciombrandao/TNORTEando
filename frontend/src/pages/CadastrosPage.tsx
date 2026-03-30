import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Plus, Pencil, Trash2, Check, X, GripVertical } from "lucide-react";

const ABAS = [
  { key: "objetivos_visita",       label: "Objetivos de visita" },
  { key: "tipos_resultado_visita", label: "Tipos de resultado" },
  { key: "acoes_proximo_passo",    label: "Próximo passo" },
  { key: "departamentos",          label: "Departamentos" },
  { key: "tipos_contato",          label: "Tipos de contato" },
  { key: "justificativas_agenda",  label: "Justificativas" },
  { key: "motivos_cancelamento",   label: "Cancelamento" },
  { key: "feriados",               label: "Feriados" },
];

const listar = (ent: string) =>
  api.get(`/api/v1/cadastros/${ent}`, { params: { apenas_ativos: false } }).then(r => r.data);
const criar  = (ent: string, body: any) =>
  api.post(`/api/v1/cadastros/${ent}`, body).then(r => r.data);
const editar = (ent: string, id: string, body: any) =>
  api.put(`/api/v1/cadastros/${ent}/${id}`, body).then(r => r.data);
const excluir = (ent: string, id: string) =>
  api.delete(`/api/v1/cadastros/${ent}/${id}`).then(r => r.data);

function ItemRow({ item, entidade, onEdit, onDelete }: any) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${!item.ativo ? "opacity-50" : ""}`}>
      <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
      {item.icone && <span className="text-lg">{item.icone}</span>}
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-800">{item.nome}</p>
        {entidade === "feriados" && (
          <p className="text-xs text-slate-400">{item.data} {item.uf ? `· ${item.uf}` : "· Nacional"} {item.municipio ? `· ${item.municipio}` : ""}</p>
        )}
      </div>
      {!item.ativo && <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Inativo</span>}
      <div className="flex items-center gap-1">
        <button onClick={() => onEdit(item)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(item)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function FormItem({ entidade, item, onSave, onCancel }: any) {
  const [nome, setNome] = useState(item?.nome || "");
  const [icone, setIcone] = useState(item?.icone || "📋");
  const [data, setData] = useState(item?.data || "");
  const [uf, setUf] = useState(item?.uf || "");
  const [municipio, setMunicipio] = useState(item?.municipio || "");
  const [tipo, setTipo] = useState(item?.tipo || "MUNICIPAL");

  const body: any = { nome };
  if (entidade === "tipos_resultado_visita") body.icone = icone;
  if (entidade === "feriados") { body.data = data; body.uf = uf || null; body.municipio = municipio || null; body.tipo = tipo; }

  return (
    <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
      <div className="space-y-2">
        {entidade === "tipos_resultado_visita" && (
          <div className="flex gap-2 items-center">
            <input value={icone} onChange={e => setIcone(e.target.value)}
              className="input w-16 text-center text-lg" placeholder="🔴" />
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="input flex-1" placeholder="Nome..." autoFocus />
          </div>
        )}
        {entidade === "feriados" ? (
          <div className="space-y-2">
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="input" placeholder="Nome do feriado..." autoFocus />
            <div className="grid grid-cols-3 gap-2">
              <input type="date" value={data} onChange={e => setData(e.target.value)} className="input" />
              <input value={uf} onChange={e => setUf(e.target.value.toUpperCase())}
                className="input" placeholder="UF (vazio=nacional)" maxLength={2} />
              <input value={municipio} onChange={e => setMunicipio(e.target.value)}
                className="input" placeholder="Município" />
            </div>
            <select value={tipo} onChange={e => setTipo(e.target.value)} className="input">
              <option value="MUNICIPAL">Municipal</option>
              <option value="PONTO_FACULTATIVO">Ponto facultativo</option>
            </select>
          </div>
        ) : entidade !== "tipos_resultado_visita" ? (
          <input value={nome} onChange={e => setNome(e.target.value)}
            className="input" placeholder="Nome..." autoFocus />
        ) : null}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary btn-sm">
            <X className="w-3.5 h-3.5" /> Cancelar
          </button>
          <button onClick={() => onSave(body)} disabled={!nome.trim()}
            className="btn-primary btn-sm">
            <Check className="w-3.5 h-3.5" /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function PainelCadastro({ entidade }: { entidade: string }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<any>(null);

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["cadastro", entidade],
    queryFn: () => listar(entidade),
  });

  const mutCriar = useMutation({
    mutationFn: (body: any) => criar(entidade, body),
    onSuccess: () => { toast.success("Criado com sucesso!"); qc.invalidateQueries({ queryKey: ["cadastro", entidade] }); setNovo(false); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao criar."),
  });

  const mutEditar = useMutation({
    mutationFn: ({ id, body }: any) => editar(entidade, id, body),
    onSuccess: () => { toast.success("Atualizado!"); qc.invalidateQueries({ queryKey: ["cadastro", entidade] }); setEditando(null); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atualizar."),
  });

  const mutExcluir = useMutation({
    mutationFn: (id: string) => excluir(entidade, id),
    onSuccess: () => { toast.success("Desativado!"); qc.invalidateQueries({ queryKey: ["cadastro", entidade] }); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao desativar."),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => { setNovo(true); setEditando(null); }}
          className="btn-primary btn-sm">
          <Plus className="w-3.5 h-3.5" /> Novo
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {novo && (
          <FormItem entidade={entidade}
            onSave={(body: any) => mutCriar.mutate(body)}
            onCancel={() => setNovo(false)} />
        )}

        {isLoading ? (
          <p className="text-center py-8 text-slate-400 text-sm">Carregando...</p>
        ) : (itens as any[]).length === 0 && !novo ? (
          <p className="text-center py-8 text-slate-400 text-sm">Nenhum registro cadastrado.</p>
        ) : (
          (itens as any[]).map((item: any) => (
            <div key={item.id}>
              {editando?.id === item.id ? (
                <FormItem entidade={entidade} item={item}
                  onSave={(body: any) => mutEditar.mutate({ id: item.id, body })}
                  onCancel={() => setEditando(null)} />
              ) : (
                <ItemRow item={item} entidade={entidade}
                  onEdit={(i: any) => { setEditando(i); setNovo(false); }}
                  onDelete={(i: any) => {
                    if (confirm(`Desativar "${i.nome}"?`)) mutExcluir.mutate(i.id);
                  }} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function CadastrosPage() {
  const [aba, setAba] = useState(ABAS[0].key);
  const abaAtual = ABAS.find(a => a.key === aba)!;

  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Cadastros Auxiliares</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manutenção das tabelas de apoio do sistema.</p>
      </div>

      {/* Abas — scroll horizontal no mobile */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-5 scrollbar-none">
        {ABAS.map(a => (
          <button key={a.key} onClick={() => setAba(a.key)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              aba === a.key
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      <PainelCadastro key={aba} entidade={aba} />
    </div>
  );
}
