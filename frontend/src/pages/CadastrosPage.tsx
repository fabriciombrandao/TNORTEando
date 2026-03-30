import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import toast from "react-hot-toast";
import { Plus, Pencil, Power, X, Check, ChevronDown, ChevronRight } from "lucide-react";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const SECOES = [
  { key: "objetivos_visita",       label: "Objetivos de visita",       descricao: "Motivos pelos quais uma visita é realizada.",              icone: "🎯" },
  { key: "tipos_resultado_visita", label: "Tipos de resultado",        descricao: "Classificação dos resultados identificados na visita.",     icone: "📋", temIcone: true },
  { key: "acoes_proximo_passo",    label: "Ações de próximo passo",    descricao: "Ações a serem tomadas após a visita.",                      icone: "⏭" },
  { key: "departamentos",          label: "Departamentos",             descricao: "Departamentos dos contatos dos clientes.",                  icone: "🏢" },
  { key: "tipos_contato",          label: "Tipos de contato",          descricao: "Perfil dos contatos cadastrados nos clientes.",             icone: "👤" },
  { key: "justificativas_agenda",  label: "Justificativas de agenda",  descricao: "Motivos para solicitar ajuste na agenda de visitas.",       icone: "📅" },
  { key: "motivos_cancelamento",   label: "Motivos de cancelamento",   descricao: "Razões para cancelamento de uma visita agendada.",          icone: "❌" },
  { key: "feriados",               label: "Feriados municipais",       descricao: "Feriados municipais e pontos facultativos (dia e mês).",    icone: "🗓", isFeriado: true },
] as const;

type Secao = typeof SECOES[number];

const listar      = (ent: string) => api.get(`/api/v1/cadastros/${ent}`, { params: { apenas_ativos: false } }).then(r => r.data);
const criar       = (ent: string, body: any) => api.post(`/api/v1/cadastros/${ent}`, body).then(r => r.data);
const editar      = (ent: string, id: string, body: any) => api.put(`/api/v1/cadastros/${ent}/${id}`, body).then(r => r.data);
const toggleAtivo = (ent: string, id: string, ativo: boolean) => api.put(`/api/v1/cadastros/${ent}/${id}`, { ativo }).then(r => r.data);

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
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

function FormCadastro({ secao, item, onSave, onClose }: { secao: Secao; item?: any; onSave: (b: any) => void; onClose: () => void }) {
  const [nome,      setNome]      = useState(item?.nome      || "");
  const [icone,     setIcone]     = useState(item?.icone     || "📋");
  const [dia,       setDia]       = useState(item?.dia       || "");
  const [mes,       setMes]       = useState(item?.mes       || "");
  const [ano,       setAno]       = useState(item?.ano       || "");
  const [uf,        setUf]        = useState(item?.uf        || "");
  const [municipio, setMunicipio] = useState(item?.municipio || "");
  const [tipo,      setTipo]      = useState(item?.tipo      || "MUNICIPAL");

  function buildBody() {
    const b: any = { nome };
    if ((secao as any).temIcone) b.icone = icone;
    if ((secao as any).isFeriado) {
      b.dia = dia; b.mes = mes; b.ano = ano || null;
      b.uf = uf || null; b.municipio = municipio || null; b.tipo = tipo;
    }
    return b;
  }

  const valido = nome.trim() && (!(secao as any).isFeriado || (dia && mes));

  return (
    <div className="space-y-3">
      {(secao as any).temIcone ? (
        <div className="flex gap-2">
          <div>
            <label className="label mb-1 block">Ícone</label>
            <input value={icone} onChange={e => setIcone(e.target.value)} className="input w-16 text-center text-xl" />
          </div>
          <div className="flex-1">
            <label className="label mb-1 block">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)} className="input" placeholder="Nome..." autoFocus />
          </div>
        </div>
      ) : (
        <div>
          <label className="label mb-1 block">Nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)} className="input" placeholder="Nome..." autoFocus />
        </div>
      )}

      {(secao as any).isFeriado && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label mb-1 block">Dia</label>
              <input type="number" min="1" max="31" value={dia} onChange={e => setDia(e.target.value)} className="input" placeholder="20" />
            </div>
            <div>
              <label className="label mb-1 block">Mês</label>
              <select value={mes} onChange={e => setMes(e.target.value)} className="input">
                <option value="">Mês</option>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label mb-1 block">Ano (opcional)</label>
              <input type="number" min="2024" max="2100" value={ano} onChange={e => setAno(e.target.value)} className="input" placeholder="Todos" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1 block">UF (vazio = nacional)</label>
              <input value={uf} onChange={e => setUf(e.target.value.toUpperCase())} className="input" placeholder="TO" maxLength={2} />
            </div>
            <div>
              <label className="label mb-1 block">Município (opcional)</label>
              <input value={municipio} onChange={e => setMunicipio(e.target.value)} className="input" placeholder="Ex: Palmas" />
            </div>
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
        <button onClick={() => onSave(buildBody())} disabled={!valido} className="btn-primary btn-md flex-1">
          <Check className="w-4 h-4" /> Salvar
        </button>
      </div>
    </div>
  );
}

function SecaoCadastro({ secao }: { secao: Secao }) {
  const qc = useQueryClient();
  const [aberta,       setAberta]       = useState(false);
  const [modal,        setModal]        = useState<"novo" | "editar" | null>(null);
  const [itemEditando, setItemEditando] = useState<any>(null);

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["cadastro", secao.key],
    queryFn:  () => listar(secao.key),
    enabled:  aberta,
  });

  const ativos   = (itens as any[]).filter(i => i.ativo);
  const inativos = (itens as any[]).filter(i => !i.ativo);

  const mutCriar = useMutation({
    mutationFn: (body: any) => criar(secao.key, body),
    onSuccess: () => { toast.success("Criado!"); qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }); setModal(null); },
    onError:   (e: any) => toast.error(e.response?.data?.detail || "Erro ao criar."),
  });

  const mutEditar = useMutation({
    mutationFn: ({ id, body }: any) => editar(secao.key, id, body),
    onSuccess: () => { toast.success("Atualizado!"); qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }); setModal(null); setItemEditando(null); },
    onError:   (e: any) => toast.error(e.response?.data?.detail || "Erro ao atualizar."),
  });

  const mutToggle = useMutation({
    mutationFn: ({ id, ativo }: any) => toggleAtivo(secao.key, id, ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cadastro", secao.key] }),
    onError:   (e: any) => toast.error(e.response?.data?.detail || "Erro."),
  });

  function labelFeriado(item: any) {
    const m = MESES[(item.mes || 1) - 1] || "";
    const d = item.dia;
    const a = item.ano ? `/${item.ano}` : "";
    const uf = item.uf ? ` · ${item.uf}` : " · Nacional";
    const mun = item.municipio ? ` · ${item.municipio}` : "";
    return `${d} de ${m}${a}${uf}${mun}`;
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
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
          {aberta
            ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        </button>

        {aberta && (
          <div className="border-t border-slate-100">
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50">
              <p className="text-xs text-slate-500">{ativos.length} ativos · {inativos.length} inativos</p>
              <button onClick={() => { setItemEditando(null); setModal("novo"); }} className="btn-primary btn-sm">
                <Plus className="w-3.5 h-3.5" /> Novo
              </button>
            </div>

            {isLoading ? (
              <p className="text-center py-6 text-slate-400 text-sm">Carregando...</p>
            ) : (itens as any[]).length === 0 ? (
              <p className="text-center py-6 text-slate-400 text-sm">Nenhum item cadastrado.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {(itens as any[]).map((item: any) => (
                  <div key={item.id} className={`flex items-center gap-3 px-5 py-3 ${!item.ativo ? "opacity-50 bg-slate-50" : ""}`}>
                    {(secao as any).temIcone && <span className="text-xl">{item.icone}</span>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{item.nome}</p>
                      {(secao as any).isFeriado && (
                        <p className="text-xs text-slate-400">{labelFeriado(item)}</p>
                      )}
                    </div>
                    {!item.ativo && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">Inativo</span>}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setItemEditando(item); setModal("editar"); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => mutToggle.mutate({ id: item.id, ativo: !item.ativo })}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg ${item.ativo ? "text-slate-400 hover:bg-red-50 hover:text-red-500" : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-500"}`}
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

      {modal && (
        <Modal
          titulo={modal === "novo" ? `Novo — ${secao.label}` : `Editar — ${itemEditando?.nome}`}
          onClose={() => { setModal(null); setItemEditando(null); }}
        >
          <FormCadastro
            secao={secao}
            item={modal === "editar" ? itemEditando : undefined}
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
