export type Papel = "GESTOR_EMPRESA" | "DSN" | "GSN" | "ESN";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  codigo_externo?: string;
  telefone?: string;
  ativo: boolean;
  primeiro_acesso?: boolean;
}

export interface Cliente {
  id: string;
  codigo_externo: string;
  razao_social: string;
  cnpj?: string | null;
  segmento?: string | null;
  sub_segmento?: string | null;
  municipio?: string | null;
  uf?: string | null;
  lat?: number | null;
  lng?: number | null;
  setor_publico: boolean;
  status_atribuicao: "ATRIBUIDO" | "PENDENTE";
  ativo: boolean;
  vendedor_responsavel_id?: string | null;
}

export interface AgendaItem {
  id: string;
  cliente_id: string;
  ordem: number;
  horario_previsto: string | null;
  status: "PENDENTE" | "CONCLUIDO" | "CANCELADO" | "REAGENDADO";
}

export interface Agenda {
  agenda_id: string;
  data: string;
  itens: AgendaItem[];
}

export interface Visita {
  visita_id: string;
  cliente_id: string;
  checkin_em: string;
  checkout_em?: string;
  duracao_minutos?: number;
}

export interface ResultadoImportacao {
  sucesso: boolean;
  organizacoes_criadas: number;
  usuarios_criados: number;
  vinculos_criados: number;
  clientes_criados: number;
  contratos_criados: number;
  clientes_orfaos: { codigo: string; razao_social: string; municipio: string | null; uf: string | null }[];
  clientes_sem_municipio: { codigo: string; razao_social: string }[];
  avisos: string[];
  erros: string[];
}
