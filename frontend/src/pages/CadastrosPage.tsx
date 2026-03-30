import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Plus, Pencil, Power, X, Check, ChevronDown, ChevronRight } from "lucide-react";

const SECOES = [
  {
    key: "objetivos_visita",
    label: "Objetivos de visita",
    descricao: "Motivos pelos quais uma visita é realizada.",
    icone: "🎯",
  },
  {
    key: "tipos_resultado_visita",
    label: "Tipos de resultado",
    descricao: "Classificação dos resultados identificados na visita.",
    icone: "📋",
    temIcone: true,
  },
  {
    key: "acoes_proximo_passo",
    label: "Ações de próximo passo",
    descricao: "Ações a serem tomadas após a visita.",
    icone: "⏭",
  },
  {
    key: "departamentos",
    label: "Departamentos",
    descricao: "Departamentos dos contatos dos clientes.",
    icone: "🏢",
  },
  {
    key: "tipos_contato",
    label: "Tipos de contato",
    descricao: "Perfil dos contatos cadastrados nos clientes.",
    icone: "👤",
  },
  {
    key: "justificativas_agenda",
    label: "Justificativas de agenda",
    descricao: "Motivos para solicitar ajuste na agenda de visitas.",
    icone: "📅",
  },
  {
    key: "motivos_cancelamento",
    label: "Motivos de cancelamento",
    descricao: "Razões para cancelamento de uma visita agendada.",
    icone: "❌",
  },
  {
    key: "feriados",
    label: "Feriados municipais",
    descricao: "Feriados municipais e pontos facultativos.",
    icone: "🗓",
    isFeriado: true,
  },
];

const listar  = (ent: string) => api.get(`/api/v1/cadastros/${ent}`, { params: { apenas_ativos: false } }).then(r => r.data);
const criar   = (ent: string, body: any) => api.post(`/api/v1/cadastros/${ent}`, body).then(r => r.data);
const editar  = (ent: string, id: string, body: any) => api.put(`/api/v1/cadastros/${ent}/${id}`, body).then(r => r.data);
const toggleAtivo = (ent: string, id: string, ativo: boolean) => api.put(`/api/v1/cadastros/${ent}/${id}`, { ativo }).then(r => r.data);

function Modal({ titulo, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-900">{titulo}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormCadastro({ secao, item, onSave, onClose }: any) {
  const [nome, setNome] = useState(item?.nome || "");
  const [icone, setIcone] = useState(item?.icone || "📋");
  const [data, setData] = useState(item?.data || "");
  const [uf, setUf] = useState(item?.uf || "");
  const [municipio, setMunicipio] = useState(item?.municipio || "");
  const [tipo, setTipo] = useState(item?.tipo || "MUNICIPAL");

  const body: any = { nome };
  if (secao.temIcone) body.icone = icone;
  if (secao.isFeriado) { body.data = data; body.uf = uf || null; body.municipio = municipio || null; body.tipo = tipo; }

  return (
    <div className="space-y-3">
      {secao.temIcone && (
        <div className="flex gap-2">
          <div>
            <label className="label mb-1 block">Ícone</label>
            <input value={icone} onChange={e => setIcone(e.target.value)}
              className="input w-16 text-center text-xl" />
          </div>
          <div className="flex-1">
            <label className="label mb-1 block">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="input" placeholder="Nome..." autoFocus />
          </div>
        </div>
      )}
      {!secao.temIcone && !secao.isFeriado && (
        <div>
          <label className="label mb-1 block">Nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            className="input" placeholder="Nome..." autoFocus />
        </div>
      )}
      {secao.isFeriado && (
        <>
          <div>
            <label className="label mb-1 block">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="input" placeholder="Nome do feriado..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1 block">Data</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label mb-1 block">UF (vazio = nacional)</label>
              <input value={uf} onChange={e => setUf(e.target.value.toUpperCase())}
                className="input" placeholder="TO" maxLength={2} />
            </div>
          </div>
          <div>
            <label className="label mb-1 block">Município (opcional)</label>
            <input value={municipio} onChange={e => setMunicipio(e.target.value)}
              className="input" placeholder="Ex: Palmas" />
          </div>
          <div>
            <label className="label mb-1 block">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} className="input">
              <option value="MUNICIPAL">Municipal</option>
              <option value="PONTO_FACULTATIVO">Ponto facultativo</option>
            </select>
          </div>
        </>
      )}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary btn-md flex-1">Cancelar</button>
        <button onClick={() => onSave(body)} disabled={!nome.trim()}
          className="btn-primary btn-md flex-1">
          <Check className="w-4 h-4" /> Salvar
        </button>
      </div>
    </div>
  );
}

function SecaoCadastro({ secao }: { secao: typeof SECOES[0] }) {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState(false);
  const [modal, setModal] = useState<"novo" | "editar" | null>(null);
  const [itemEditando, setItemEditando] = useState<any>(null);

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["cadastro", secao.key],
    queryFn: () => listar(secao.key),
    enabled: aberta,
  });

  const ativos = (itens as any[]).filter(i => i.ativo);
  const inativos = (itens as any[]).filter(i => !i.ativo);

  const mutCriar = useMutation({
    mutationFn: (body: any) => criar(secao.key, body),
    onSuccess: () => { toast.success("Criado!"); qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }); setModal(null); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao criar."),
  });

  const mutEditar = useMutation({
    mutationFn: ({ id, body }: any) => editar(secao.key, id, body),
    onSuccess: () => { toast.success("Atualizado!"); qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }); setModal(null); setItemEditando(null); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao atualizar."),
  });

  const mutToggle = useMutation({
    mutationFn: ({ id, ativo }: any) => toggleAtivo(secao.key, id, ativo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }); },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  return (
    <>
      {/* Card da seção */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {/* Header clicável */}
        <button
          onClick={() => setAberta(!aberta)}
          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-2xl">{secao.icone}</span>
          <div className="flex-1">
            <p className="font-semibold text-slate-900">{secao.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{secao.descricao}</p>
          </div>
          {aberta && ativos.length > 0 && (
            <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">
              {ativos.length} itens
            </span>
          )}
          {aberta ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        </button>

        {/* Conteúdo expandido */}
        {aberta && (
          <div className="border-t border-slate-100">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50">
              <p className="text-xs text-slate-500">{ativos.length} ativos · {inativos.length} inativos</p>
              <button onClick={() => { setItemEditando(null); setModal("novo"); }}
                className="btn-primary btn-sm">
                <Plus className="w-3.5 h-3.5" /> Novo
              </button>
            </div>

            {/* Lista */}
            {isLoading ? (
              <p className="text-center py-6 text-slate-400 text-sm">Carregando...</p>
            ) : (itens as any[]).length === 0 ? (
              <p className="text-center py-6 text-slate-400 text-sm">Nenhum item cadastrado.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {(itens as any[]).map((item: any) => (
                  <div key={item.id} className={`flex items-center gap-3 px-5 py-3 ${!item.ativo ? "opacity-50 bg-slate-50" : ""}`}>
                    {secao.temIcone && <span className="text-xl">{item.icone}</span>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{item.nome}</p>
                      {secao.isFeriado && (
                        <p className="text-xs text-slate-400">
                          {item.data ? item.data.split("-").reverse().join("/") : ""} {item.uf ? `· ${item.uf}` : "· Nacional"} {item.municipio ? `· ${item.municipio}` : ""} · {item.tipo}
                        </p>
                      )}
                    </div>
                    {!item.ativo && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">Inativo</span>}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setItemEditando(item); setModal("editar"); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => mutToggle.mutate({ id: item.id, ativo: !item.ativo })}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg ${item.ativo ? "text-slate-400 hover:bg-red-50 hover:text-red-500" : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-500"}`}
                        title={item.ativo ? "Desativar" : "Ativar"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal novo/editar */}
      {modal && (
        <Modal
          titulo={modal === "novo" ? `Novo — ${secao.label}` : `Editar — ${itemEditando?.nome}`}
          onClose={() => { setModal(null); setItemEditando(null); }}
        >
          <FormCadastro
            secao={secao}
            item={modal === "editar" ? itemEditando : null}
            onSave={(body: any) => {
              if (modal === "novo") mutCriar.mutate(body);
              else mutEditar.mutate({ id: itemEditando.id, body });
            }}
            onClose={() => { setModal(null); setItemEditando(null); }}
          />
        </Modal>
      )}
    </>
  );
}

export default function CadastrosPage() {
  return (
    <div className="p-4 md:p-6 max-w-2xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Cadastros Auxiliares</h1>
        <p className="text-sm text-slate-500 mt-0.5">Clique em uma seção para expandir e gerenciar os itens.</p>
      </div>
      <div className="space-y-3">
        {SECOES.map(s => <SecaoCadastro key={s.key} secao={s} />)}
      </div>
    </div>
  );
}
